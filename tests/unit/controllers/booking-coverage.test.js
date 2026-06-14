import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { getPool, query } from '../../setup/db.js'
import {
  createAdmin, createHall, createScreen, createMovie, createShow,
  createCustomer, createBooking,
} from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

import {
  cleanupExpiredHolds, getCinemaHallBookings, getBookingByPaymentId,
} from '../../../controllers/booking.Controller.js'

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

let pool, admin, hall, screen, movie, show, customer

beforeAll(async () => {
  pool = getPool()
  admin = await createAdmin()
  hall = await createHall(admin.id, { name: 'Booking Coverage Hall' })
  screen = await createScreen(hall.id, {
    name: 'Coverage Screen',
    layout: JSON.stringify({
      rows: 2, cols: 3, seats: [
        { id: 'C1', row: 'A', column: 1, type: 'standard' },
      ],
    }),
  })
  movie = await createMovie()
  show = await createShow(screen.id, movie.id)
  customer = await createCustomer()
})

afterEach(async () => {
  await query('DELETE FROM show_booked_seats')
  await query('DELETE FROM bookings')
  await query('DELETE FROM payment_orders')
})

describe('cleanupExpiredHolds', () => {
  it('removes expired holds and returns count', async () => {
    await query(
      `INSERT INTO show_booked_seats (show_id, seat_id, seat_label, row_label, column_number, status, held_by, hold_expires_at)
       VALUES ($1, 'EXP1', 'EXP1', '', 0, 'HELD', $2, now() - interval '1 minute')`,
      [show.id, customer.id]
    )
    const count = await cleanupExpiredHolds()
    expect(count).toBe(1)
  })

  it('handles no expired holds gracefully', async () => {
    const count = await cleanupExpiredHolds()
    expect(count).toBe(0)
  })
})

describe('getCinemaHallBookings — filters and pagination', () => {
  it('filters by status', async () => {
    const booking = await createBooking(customer.id, show.id, { status: 'confirmed' })
    await query(`UPDATE bookings SET payment_status = 'completed' WHERE id = $1`, [booking.id])

    const { req, res } = mockReqRes({
      currentHallId: hall.id,
      query: { status: 'confirmed' },
    })
    await getCinemaHallBookings(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.bookings.length).toBeGreaterThanOrEqual(1)
    expect(data).toHaveProperty('stats')
  })

  it('returns empty for non-matching filters', async () => {
    const { req, res } = mockReqRes({
      currentHallId: hall.id,
      query: { status: 'cancelled' },
    })
    await getCinemaHallBookings(req, res)
    expect(res.json.mock.calls[0][0].bookings).toEqual([])
  })
})

describe('getBookingByPaymentId', () => {
  it('returns 404 for unknown payment id', async () => {
    const { req, res } = mockReqRes({
      customer: { id: customer.id },
      params: { payment_id: 'pay_unknown' },
    })
    await getBookingByPaymentId(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })
})
