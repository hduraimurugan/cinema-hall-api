import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { getPool, query } from '../../setup/db.js'
import {
  createAdmin, createHall, createScreen, createMovie, createShow,
  createCustomer, createBooking,
} from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

import { holdSeats, confirmBooking } from '../../../controllers/booking.Controller.js'

function mockReqRes(overrides = {}) {
  const req = {
    body: {}, params: {}, query: {}, cookies: {},
    admin: { id: 'none' }, customer: { id: 'none', email: 'none@test.com' },
    currentHallId: null,
    ...overrides,
  }
  const res = {
    status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(), clearCookie: vi.fn().mockReturnThis(),
  }
  return { req, res }
}

async function createHeldSeat(showId, seatId, customerId) {
  await query(
    `INSERT INTO show_booked_seats (show_id, seat_id, seat_label, row_label, column_number, status, held_by, hold_expires_at)
     VALUES ($1, $2, $2, '', 0, 'HELD', $3, now() + interval '10 minutes')
     ON CONFLICT (show_id, seat_id) DO UPDATE
       SET status = 'HELD', held_by = $3, hold_expires_at = now() + interval '10 minutes'`,
    [showId, seatId, customerId]
  )
}

let pool, admin, hall, screen, movie, show, customerA, customerB

beforeAll(async () => {
  pool = getPool()
  admin = await createAdmin()
  hall = await createHall(admin.id, { name: 'Concurrency Hall' })
  screen = await createScreen(hall.id, {
    name: 'Concurrency Screen',
    layout: JSON.stringify({ rows: 2, cols: 3, seats: [] }),
  })
  movie = await createMovie()
  show = await createShow(screen.id, movie.id)
  customerA = await createCustomer()
  customerB = await createCustomer()
})

afterEach(async () => {
  await query('DELETE FROM show_booked_seats')
  await query('DELETE FROM bookings')
  await query('DELETE FROM refunds')
})

describe('concurrent holdSeats — same seats, different customers', () => {
  it('only one concurrent hold succeeds for the same seat', async () => {
    const seatId = 'CC1'
    await query(
      `INSERT INTO show_booked_seats (show_id, seat_id, seat_label, row_label, column_number, status)
       VALUES ($1, $2, $2, '', 0, 'AVAILABLE')
       ON CONFLICT (show_id, seat_id) DO NOTHING`,
      [show.id, seatId]
    )
    const results = await Promise.allSettled([
      (async () => {
        const { req, res } = mockReqRes({
          customer: { id: customerA.id },
          body: { show_id: show.id, seats: [seatId] },
        })
        await holdSeats(req, res)
        return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] }
      })(),
      (async () => {
        const { req, res } = mockReqRes({
          customer: { id: customerB.id },
          body: { show_id: show.id, seats: [seatId] },
        })
        await holdSeats(req, res)
        return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] }
      })(),
    ])

    const successes = results.filter(r => r.status === 'fulfilled' && r.value.status === 200)
    const failures = results.filter(r => r.status === 'fulfilled' && r.value.status === 409)

    expect(successes.length).toBe(1)
    expect(failures.length).toBe(1)

    const heldCount = await query(
      `SELECT COUNT(*) FROM show_booked_seats WHERE show_id = $1 AND seat_id = $2 AND status = 'HELD'`,
      [show.id, seatId]
    )
    expect(parseInt(heldCount.rows[0].count)).toBe(1)
  })

  it('concurrent holds for different seats both succeed', async () => {
    const results = await Promise.allSettled([
      (async () => {
        const { req, res } = mockReqRes({
          customer: { id: customerA.id },
          body: { show_id: show.id, seats: ['CC2'] },
        })
        await holdSeats(req, res)
        return res.status.mock.calls[0]?.[0]
      })(),
      (async () => {
        const { req, res } = mockReqRes({
          customer: { id: customerB.id },
          body: { show_id: show.id, seats: ['CC3'] },
        })
        await holdSeats(req, res)
        return res.status.mock.calls[0]?.[0]
      })(),
    ])

    const successCount = results.filter(r => r.status === 'fulfilled' && r.value === 200).length
    expect(successCount).toBe(2)
  })
})

describe('concurrent confirmBooking — same seats, same customer', () => {
  it('only one concurrent confirm succeeds for the same held seats', async () => {
    await createHeldSeat(show.id, 'CC4', customerA.id)
    await createHeldSeat(show.id, 'CC5', customerA.id)

    const results = await Promise.allSettled([
      (async () => {
        const { req, res } = mockReqRes({
          customer: { id: customerA.id, email: customerA.email },
          body: { show_id: show.id, seats: ['CC4', 'CC5'], total_amount: 500 },
        })
        await confirmBooking(req, res)
        return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] }
      })(),
      (async () => {
        const { req, res } = mockReqRes({
          customer: { id: customerA.id, email: customerA.email },
          body: { show_id: show.id, seats: ['CC4', 'CC5'], total_amount: 500 },
        })
        await confirmBooking(req, res)
        return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] }
      })(),
    ])

    const successes = results.filter(r => r.status === 'fulfilled' && r.value.status === 200)
    expect(successes.length).toBe(1)

    const bookingCount = await query(
      `SELECT COUNT(*) FROM bookings WHERE show_id = $1`,
      [show.id]
    )
    expect(parseInt(bookingCount.rows[0].count)).toBe(1)

    const bookedSeats = await query(
      `SELECT COUNT(*) FROM show_booked_seats WHERE show_id = $1 AND status = 'BOOKED'`,
      [show.id]
    )
    expect(parseInt(bookedSeats.rows[0].count)).toBe(2)
  })
})
