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
      payments: { refund() { return Promise.resolve({ id: 'rfp_test' }) } },
    }
  }
  return { default: MockRazorpay }
})

import {
  createShow as createShowFn,
  createMultipleShows,
  deleteShow, deleteMultipleShows,
  cancelShow, updateShowBookingStatus,
  getShowById, getShowBookingCount,
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
  hall = await createHall(admin.id, { name: 'Shows Edge Hall' })
  screen = await createScreen(hall.id, {
    layout: JSON.stringify({ rows: 2, cols: 3, seats: [] }),
  })
  movie = await createMovie()
  show = await createShow(screen.id, movie.id, {
    show_date: new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0],
  })
})

afterEach(async () => {
  await pool.query('DELETE FROM refunds')
  await pool.query('DELETE FROM bookings')
  await pool.query('DELETE FROM shows WHERE id NOT IN ($1)', [show ? show.id : '00000000-0000-0000-0000-000000000000'])
})

describe('createShow — edge cases', () => {
  it('rejects invalid UUID for movie_id', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    const { req, res } = mockReqRes({
      body: {
        movie_id: 'not-a-uuid',
        screen_id: screen.id,
        show_date: tomorrow,
        start_time: '10:00',
        end_time: '12:30',
      },
    })
    await createShowFn(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rejects missing screen_id', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    const { req, res } = mockReqRes({
      body: {
        movie_id: movie.id,
        show_date: tomorrow,
        start_time: '10:00',
        end_time: '12:30',
      },
    })
    await createShowFn(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

describe('createMultipleShows — edge cases', () => {
  it('skips time slots with missing start or end time', async () => {
    const { req, res } = mockReqRes({
      body: {
        movie_id: movie.id,
        screen_ids: [screen.id],
        dates: ['2025-12-25'],
        time_slots: [{ start_time: '10:00', end_time: '12:30' }, { start_time: '', end_time: '' }],
      },
    })
    await createMultipleShows(req, res)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json.mock.calls[0][0].shows.length).toBe(1)
    expect(res.json.mock.calls[0][0].skipped.length).toBe(1)
  })
})

describe('deleteShow — edge cases', () => {
  it('deleting nonexistent show is idempotent', async () => {
    const { req, res } = mockReqRes({
      params: { id: '00000000-0000-0000-0000-000000000000' },
    })
    await deleteShow(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
  })
})

describe('deleteMultipleShows — edge cases', () => {
  it('handles mix of existing and nonexistent IDs', async () => {
    const s = await createShow(screen.id, movie.id)
    const { req, res } = mockReqRes({
      body: { ids: [s.id, '00000000-0000-0000-0000-000000000000'] },
    })
    await deleteMultipleShows(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].deleted).toBe(1)
  })
})

describe('cancelShow — edge cases', () => {
  it('rejects cancelling a show_ended show', async () => {
    const s = await createShow(screen.id, movie.id, { status: 'show_ended' })
    const { req, res } = mockReqRes({ params: { id: s.id }, currentHallId: hall.id })
    await cancelShow(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toMatch(/ended/i)
  })

  it('returns 404 for nonexistent show', async () => {
    const { req, res } = mockReqRes({
      params: { id: '00000000-0000-0000-0000-000000000000' },
      currentHallId: hall.id,
    })
    await cancelShow(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })
})

describe('updateShowBookingStatus — edge cases', () => {
  it('rejects invalid action string', async () => {
    const { req, res } = mockReqRes({
      params: { id: show.id },
      body: { action: 'invalid_action' },
      currentHallId: hall.id,
    })
    await updateShowBookingStatus(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toMatch(/invalid action/i)
  })

  it('rejects opening booking for already-opened show', async () => {
    const s = await createShow(screen.id, movie.id)
    await pool.query(`UPDATE shows SET status = 'booking_started' WHERE id = $1`, [s.id])
    const { req, res } = mockReqRes({
      params: { id: s.id },
      body: { action: 'open' },
      currentHallId: hall.id,
    })
    await updateShowBookingStatus(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('reverts cancelled show restoration if already scheduled', async () => {
    const s = await createShow(screen.id, movie.id)
    await pool.query(`UPDATE shows SET status = 'cancelled' WHERE id = $1`, [s.id])
    await pool.query(`UPDATE shows SET status = 'scheduled' WHERE id = $1`, [s.id])

    const { req: reqRevert, res: resRevert } = mockReqRes({
      params: { id: s.id },
      body: { action: 'revert' },
      currentHallId: hall.id,
    })
    await updateShowBookingStatus(reqRevert, resRevert)
    expect(resRevert.status).toHaveBeenCalledWith(400)
  })

  it('rejects restoring a non-cancelled show', async () => {
    const s = await createShow(screen.id, movie.id, { status: 'booking_started' })
    const { req, res } = mockReqRes({
      params: { id: s.id },
      body: { action: 'restore' },
      currentHallId: hall.id,
    })
    await updateShowBookingStatus(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toMatch(/cannot restore/i)
  })
})

describe('getShowById — edge cases', () => {
  it('returns expired held seats as available', async () => {
    const cust = await createCustomer()
    const edgeScreen = await createScreen(hall.id, {
      name: 'Expiry Screen',
      layout: JSON.stringify({
        rows: 2, cols: 3, seats: [
          { id: 'EX1', row: 'A', column: 1, type: 'standard' },
        ],
      }),
    })
    const s = await createShow(edgeScreen.id, movie.id)
    await query(
      `INSERT INTO show_booked_seats (show_id, seat_id, seat_label, row_label, column_number, status, held_by, hold_expires_at)
       VALUES ($1, 'EX1', 'EX1', '', 0, 'HELD', $2, now() - interval '1 minute')`,
      [s.id, cust.id]
    )
    const { req, res } = mockReqRes({ params: { id: s.id } })
    await getShowById(req, res)
    const seats = res.json.mock.calls[0][0].screen.layout.seats
    const expiredSeat = seats.find(s => s.id === 'EX1')
    expect(expiredSeat.status).toBe('available')
  })
})

describe('getShowBookingCount — edge cases', () => {
  it('returns 404 for show not in admin hall', async () => {
    const { req, res } = mockReqRes({
      params: { id: '00000000-0000-0000-0000-000000000000' },
      currentHallId: hall.id,
    })
    await getShowBookingCount(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('returns zero counts for show with no bookings', async () => {
    const s = await createShow(screen.id, movie.id)
    const { req, res } = mockReqRes({ params: { id: s.id }, currentHallId: hall.id })
    await getShowBookingCount(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].booking_count).toBe(0)
    expect(Number(res.json.mock.calls[0][0].total_amount)).toBe(0)
  })
})
