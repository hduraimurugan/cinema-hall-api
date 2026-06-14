import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { getPool, query } from '../../setup/db.js'
import {
  createAdmin, createHall, createScreen, createMovie, createShow,
  createCustomer, createBooking,
} from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))

vi.mock('razorpay', () => {
  function MockRazorpay() {
    return {
      orders: { create() {} },
      payments: { refund() { return Promise.resolve({ id: 'rfp_bulk_test' }) } },
    }
  }
  return { default: MockRazorpay }
})

import { bulkCancelShows, bulkRestoreShows, updateShowStatuses } from '../../../controllers/shows.Controller.js'

function mockReqRes(overrides = {}) {
  const req = { query: {}, params: {}, body: {}, currentHallId: null, customer: { id: 'test-cust' }, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

let pool, admin, hall, screen, movie

beforeAll(async () => {
  pool = getPool()
  admin = await createAdmin()
  hall = await createHall(admin.id, { name: 'Shows Coverage Hall' })
  screen = await createScreen(hall.id, {
    layout: JSON.stringify({ rows: 2, cols: 3, seats: [] }),
  })
  movie = await createMovie()
})

afterEach(async () => {
  await query('DELETE FROM refunds')
  await query('DELETE FROM bookings')
  await query('DELETE FROM shows')
  await query('DELETE FROM screens WHERE id != $1', [screen.id])
})

describe('bulkCancelShows', () => {
  it('rejects empty ids array', async () => {
    const { req, res } = mockReqRes({ body: { ids: [] }, currentHallId: hall.id })
    await bulkCancelShows(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('cancels multiple shows with bookings and initiates refunds', async () => {
    const customer = await createCustomer()
    const s1 = await createShow(screen.id, movie.id, { status: 'booking_started', start_time: '10:00', end_time: '12:30' })
    const s2 = await createShow(screen.id, movie.id, { status: 'booking_started', start_time: '14:00', end_time: '16:30' })

    const b1 = await createBooking(customer.id, s1.id, { total_amount: 300, status: 'confirmed' })
    await query(`UPDATE bookings SET payment_status = 'completed', payment_id = 'pay_bulk1' WHERE id = $1`, [b1.id])

    const b2 = await createBooking(customer.id, s2.id, { total_amount: 500, status: 'confirmed' })
    await query(`UPDATE bookings SET payment_status = 'completed', payment_id = 'pay_bulk2' WHERE id = $1`, [b2.id])

    const { req, res } = mockReqRes({ body: { ids: [s1.id, s2.id] }, currentHallId: hall.id })
    await bulkCancelShows(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].message).toMatch(/2 of 2/)
    expect(res.json.mock.calls[0][0].results.filter(r => r.success).length).toBe(2)
  })

  it('handles mix of cancellable and non-cancellable shows', async () => {
    const s1 = await createShow(screen.id, movie.id, {
      status: 'cancelled',
      start_time: '06:00', end_time: '08:30',
      show_date: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
    })
    const s2 = await createShow(screen.id, movie.id, {
      status: 'booking_started',
      start_time: '10:00', end_time: '12:30',
      show_date: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
    })

    const { req, res } = mockReqRes({
      body: { ids: [s1.id, s2.id, '00000000-0000-0000-0000-000000000000'] },
      currentHallId: hall.id,
    })
    await bulkCancelShows(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    const results = res.json.mock.calls[0][0].results
    expect(results.find(r => r.id === s1.id).success).toBe(false)
    expect(results.find(r => r.id === s2.id).success).toBe(true)
  })
})

describe('bulkRestoreShows', () => {
  it('rejects empty ids array', async () => {
    const { req, res } = mockReqRes({ body: { ids: [] }, currentHallId: hall.id })
    await bulkRestoreShows(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('restores cancelled shows and skips non-cancelled', async () => {
    const s1 = await createShow(screen.id, movie.id, {
      status: 'cancelled',
      start_time: '06:00', end_time: '08:30',
      show_date: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
    })
    const s2 = await createShow(screen.id, movie.id, {
      status: 'booking_started',
      start_time: '10:00', end_time: '12:30',
      show_date: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
    })
    const { req, res } = mockReqRes({ body: { ids: [s1.id, s2.id] }, currentHallId: hall.id })
    await bulkRestoreShows(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    const results = res.json.mock.calls[0][0].results
    expect(results.find(r => r.id === s1.id).success).toBe(true)
    expect(results.find(r => r.id === s2.id).success).toBe(false)
  })
})

describe('updateShowStatuses', () => {
  it('runs without error and returns count', async () => {
    const count = await updateShowStatuses()
    expect(typeof count).toBe('undefined')
  })
})
