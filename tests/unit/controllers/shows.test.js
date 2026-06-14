import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { getPool } from '../../setup/db.js'
import {
  createAdmin, createHall, createScreen, createMovie, createShow,
  createCustomer, createBooking,
} from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))

vi.mock('razorpay', () => {
  function MockRazorpay() {
    return {
      orders: { create() {} },
      payments: { refund() { return Promise.resolve({ id: 'rfp_test123' }) } },
    }
  }
  return { default: MockRazorpay }
})

import {
  createShow as createShowFn,
  createMultipleShows,
  editShow,
  deleteShow,
  deleteMultipleShows,
  getShowsByDate,
  getShowById,
  cancelShow,
  updateShowBookingStatus,
  bulkCancelShows,
  bulkRestoreShows,
  bulkOpenBooking,
  getShowBookingCount,
} from '../../../controllers/shows.Controller.js'

function mockReqRes(overrides = {}) {
  const req = { query: {}, params: {}, body: {}, currentHallId: null, customer: { id: 'test-cust' }, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

let admin, hall, screen, movie, show, pool

beforeAll(async () => {
  pool = getPool()
  admin = await createAdmin()
  hall = await createHall(admin.id, { name: 'Shows Test Hall' })
  screen = await createScreen(hall.id, {
    layout: JSON.stringify({
      rows: 2, cols: 3, seats: [
        { id: 'A1', row: 'A', column: 1, type: 'standard' },
        { id: 'A2', row: 'A', column: 2, type: 'standard' },
      ],
    }),
  })
  movie = await createMovie()
  show = await createShow(screen.id, movie.id, { show_date: new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0] })
})

afterEach(async () => {
  await pool.query('DELETE FROM shows WHERE id NOT IN ($1)', [show ? show.id : '00000000-0000-0000-0000-000000000000'])
})

describe('createShow', () => {
  it('creates a new show', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    const { req, res } = mockReqRes({
      body: {
        movie_id: movie.id,
        screen_id: screen.id,
        show_date: tomorrow,
        start_time: '14:00',
        end_time: '16:30',
        language_version: 'English',
      },
    })
    await createShowFn(req, res)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json.mock.calls[0][0].show).toHaveProperty('id')
    expect(res.json.mock.calls[0][0].show.movie_id).toBe(movie.id)
  })

  it('rejects missing movie_id', async () => {
    const { req, res } = mockReqRes({
      body: {
        screen_id: screen.id,
        show_date: '2025-12-25',
        start_time: '14:00',
        end_time: '16:30',
      },
    })
    await createShowFn(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

describe('createMultipleShows', () => {
  it('creates shows for multiple screens/dates/times', async () => {
    const dates = ['2025-12-25', '2025-12-26']
    const time_slots = [{ start_time: '10:00', end_time: '12:30' }, { start_time: '14:00', end_time: '16:30' }]
    const { req, res } = mockReqRes({
      body: { movie_id: movie.id, screen_ids: [screen.id], dates, time_slots },
    })
    await createMultipleShows(req, res)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json.mock.calls[0][0].shows.length).toBe(4)
  })

  it('rejects missing screen_ids', async () => {
    const { req, res } = mockReqRes({
      body: { movie_id: movie.id, dates: ['2025-12-25'], time_slots: [{ start_time: '10:00', end_time: '12:30' }] },
    })
    await createMultipleShows(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

describe('editShow', () => {
  it('updates show fields', async () => {
    const { req, res } = mockReqRes({
      params: { id: show.id },
      body: { price_override: 350, language_version: 'Tamil' },
    })
    await editShow(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(Number(res.json.mock.calls[0][0].updated.price_override)).toBe(350)
    expect(res.json.mock.calls[0][0].updated.language_version).toBe('Tamil')
  })

  it('rejects empty update body', async () => {
    const { req, res } = mockReqRes({
      params: { id: show.id },
      body: {},
    })
    await editShow(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

describe('deleteShow', () => {
  it('deletes a show', async () => {
    const s = await createShow(screen.id, movie.id)
    const { req, res } = mockReqRes({ params: { id: s.id } })
    await deleteShow(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
  })
})

describe('deleteMultipleShows', () => {
  it('deletes multiple shows', async () => {
    const s1 = await createShow(screen.id, movie.id, { start_time: '10:00', end_time: '12:30' })
    const s2 = await createShow(screen.id, movie.id, { start_time: '14:00', end_time: '16:30' })
    const { req, res } = mockReqRes({ body: { ids: [s1.id, s2.id] } })
    await deleteMultipleShows(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].deleted).toBe(2)
  })

  it('rejects empty ids array', async () => {
    const { req, res } = mockReqRes({ body: { ids: [] } })
    await deleteMultipleShows(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

describe('getShowsByDate', () => {
  it('returns shows grouped by movie', async () => {
    const date = show.show_date
    const { req, res } = mockReqRes({ params: { date }, currentHallId: hall.id })
    await getShowsByDate(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0]).toHaveProperty('grouped')
    expect(res.json.mock.calls[0][0].grouped.length).toBeGreaterThanOrEqual(1)
    expect(res.json.mock.calls[0][0].grouped[0]).toHaveProperty('shows')
  })
})

describe('getShowById', () => {
  it('returns show with seat statuses', async () => {
    const { req, res } = mockReqRes({ params: { id: show.id } })
    await getShowById(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0]).toHaveProperty('movie')
    expect(res.json.mock.calls[0][0]).toHaveProperty('screen')
    expect(res.json.mock.calls[0][0].screen.layout.seats).toBeInstanceOf(Array)
  })

  it('returns 404 for nonexistent show', async () => {
    const { req, res } = mockReqRes({ params: { id: '00000000-0000-0000-0000-000000000000' } })
    await getShowById(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })
})

describe('updateShowBookingStatus', () => {
  it('opens booking for scheduled show', async () => {
    const s = await createShow(screen.id, movie.id)
    const { req, res } = mockReqRes({ params: { id: s.id }, body: { action: 'open' }, currentHallId: hall.id })
    await updateShowBookingStatus(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].status).toBe('booking_started')
  })

  it('reverts booking_started show', async () => {
    const s = await createShow(screen.id, movie.id)
    await pool.query(`UPDATE shows SET status = 'booking_started' WHERE id = $1`, [s.id])
    const { req, res } = mockReqRes({ params: { id: s.id }, body: { action: 'revert' }, currentHallId: hall.id })
    await updateShowBookingStatus(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].status).toBe('scheduled')
  })

  it('restores cancelled show', async () => {
    const s = await createShow(screen.id, movie.id)
    await pool.query(`UPDATE shows SET status = 'cancelled' WHERE id = $1`, [s.id])
    const { req, res } = mockReqRes({ params: { id: s.id }, body: { action: 'restore' }, currentHallId: hall.id })
    await updateShowBookingStatus(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].status).toBe('scheduled')
  })
})

describe('cancelShow', () => {
  it('cancels show and initiates refunds', async () => {
    const customer = await createCustomer()
    const s = await createShow(screen.id, movie.id, { status: 'booking_started' })
    const booking = await createBooking(customer.id, s.id, {
      total_amount: 500,
      status: 'confirmed',
    })
    await pool.query(
      `UPDATE bookings SET payment_status = 'completed', payment_id = 'pay_cancel_test' WHERE id = $1`,
      [booking.id]
    )

    const { req, res } = mockReqRes({ params: { id: s.id }, currentHallId: hall.id })
    await cancelShow(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].bookings_cancelled).toBe(1)

    const refundCheck = await pool.query(`SELECT * FROM refunds WHERE booking_id = $1`, [booking.id])
    expect(refundCheck.rows.length).toBe(1)
    expect(refundCheck.rows[0].refund_status).toBe('initiated')
  })

  it('rejects already cancelled show', async () => {
    const s = await createShow(screen.id, movie.id, { status: 'cancelled' })
    const { req, res } = mockReqRes({ params: { id: s.id }, currentHallId: hall.id })
    await cancelShow(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

describe('bulkOpenBooking', () => {
  it('opens booking for multiple scheduled shows', async () => {
    const s1 = await createShow(screen.id, movie.id, { start_time: '10:00', end_time: '12:30' })
    const s2 = await createShow(screen.id, movie.id, { start_time: '14:00', end_time: '16:30' })
    const { req, res } = mockReqRes({ body: { ids: [s1.id, s2.id] }, currentHallId: hall.id })
    await bulkOpenBooking(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].message).toMatch(/2 of 2/)
  })
})

describe('getShowBookingCount', () => {
  it('returns count and total amount', async () => {
    const customer = await createCustomer()
    const s = await createShow(screen.id, movie.id)
    await createBooking(customer.id, s.id, { total_amount: 400, status: 'confirmed' })
    await pool.query(
      `UPDATE bookings SET payment_status = 'completed' WHERE show_id = $1`,
      [s.id]
    )

    const { req, res } = mockReqRes({ params: { id: s.id }, currentHallId: hall.id })
    await getShowBookingCount(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].booking_count).toBeGreaterThanOrEqual(1)
  })
})
