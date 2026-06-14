import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { getPool, query } from '../../setup/db.js'
import {
  createAdmin, createHall, createScreen, createMovie, createShow,
  createCustomer, createBooking,
} from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

import {
  holdSeats, confirmBooking, releaseSeats,
  getMyBookings, getCinemaHallBookings, verifyBookingById, getBookingDetails,
} from '../../../controllers/booking.Controller.js'

function mockReqRes(overrides = {}) {
  const req = {
    body: {}, params: {}, query: {}, cookies: {},
    admin: { id: 'none' }, customer: { id: 'none' },
    currentHallId: null,
    ip: '127.0.0.1', headers: { 'user-agent': 'test-agent' },
    ...overrides,
  }
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
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

let pool, admin, hall, screen, movie, show, customer

beforeAll(async () => {
  pool = getPool()
  admin = await createAdmin()
  hall = await createHall(admin.id, { name: 'Booking Hall' })
  screen = await createScreen(hall.id, {
    name: 'Booking Screen',
    layout: JSON.stringify({ rows: 2, cols: 3, seats: [] }),
  })
  movie = await createMovie()
  show = await createShow(screen.id, movie.id)
  customer = await createCustomer()
})

afterEach(async () => {
  await query('DELETE FROM show_booked_seats')
  await query('DELETE FROM bookings')
  await query('DELETE FROM refunds')
  await query('DELETE FROM customers WHERE id != $1', [customer.id])
})

// ═══════════════════════════════════════════════════════════════════════════════
// holdSeats
// ═══════════════════════════════════════════════════════════════════════════════

describe('holdSeats', () => {
  it('holds available seats for customer', async () => {
    const { req, res } = mockReqRes({
      customer: { id: customer.id },
      body: { show_id: show.id, seats: ['X1', 'X2'] },
    })
    await holdSeats(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].success).toBe(true)
  })

  it('rejects missing show_id or seats', async () => {
    const { req, res } = mockReqRes({
      customer: { id: customer.id },
      body: {},
    })
    await holdSeats(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rolls back when a seat is already held by someone else', async () => {
    await createHeldSeat(show.id, 'Y1', customer.id)
    const otherCust = await createCustomer()
    const { req, res } = mockReqRes({
      customer: { id: otherCust.id },
      body: { show_id: show.id, seats: ['Y1'] },
    })
    await holdSeats(req, res)
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json.mock.calls[0][0].success).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// confirmBooking
// ═══════════════════════════════════════════════════════════════════════════════

describe('confirmBooking', () => {
  it('confirms held seats into a booking', async () => {
    await createHeldSeat(show.id, 'B1', customer.id)
    const { req, res } = mockReqRes({
      customer: { id: customer.id, email: customer.email },
      body: { show_id: show.id, seats: ['B1'], total_amount: 250 },
    })
    await confirmBooking(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(Number(res.json.mock.calls[0][0].booking.total_amount)).toBe(250)
  })

  it('rejects seats held by another customer', async () => {
    const otherCust = await createCustomer()
    await createHeldSeat(show.id, 'B2', otherCust.id)
    const { req, res } = mockReqRes({
      customer: { id: customer.id, email: customer.email },
      body: { show_id: show.id, seats: ['B2'], total_amount: 100 },
    })
    await confirmBooking(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toMatch(/held by another/i)
  })

  it('rejects expired hold', async () => {
    await query(
      `INSERT INTO show_booked_seats (show_id, seat_id, seat_label, row_label, column_number, status, held_by, hold_expires_at)
       VALUES ($1, 'B3', 'B3', '', 0, 'HELD', $2, now() - interval '1 minute')`,
      [show.id, customer.id]
    )
    const { req, res } = mockReqRes({
      customer: { id: customer.id, email: customer.email },
      body: { show_id: show.id, seats: ['B3'], total_amount: 100 },
    })
    await confirmBooking(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toMatch(/expired/i)
  })

  it('rejects missing fields', async () => {
    const { req, res } = mockReqRes({
      customer: { id: customer.id },
      body: {},
    })
    await confirmBooking(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// releaseSeats
// ═══════════════════════════════════════════════════════════════════════════════

describe('releaseSeats', () => {
  it('releases held seats', async () => {
    await createHeldSeat(show.id, 'R1', customer.id)
    const { req, res } = mockReqRes({
      customer: { id: customer.id },
      body: { show_id: show.id, seats: ['R1'] },
    })
    await releaseSeats(req, res)
    expect(res.json.mock.calls[0][0].released).toContain('R1')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// getMyBookings
// ═══════════════════════════════════════════════════════════════════════════════

describe('getMyBookings', () => {
  it('returns bookings for the customer', async () => {
    await createBooking(customer.id, show.id)
    const { req, res } = mockReqRes({ customer: { id: customer.id } })
    await getMyBookings(req, res)
    expect(res.json.mock.calls[0][0].bookings.length).toBeGreaterThanOrEqual(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// getCinemaHallBookings
// ═══════════════════════════════════════════════════════════════════════════════

describe('getCinemaHallBookings', () => {
  it('returns paginated bookings with stats', async () => {
    await createBooking(customer.id, show.id, { total_amount: 500 })
    const { req, res } = mockReqRes({
      currentHallId: hall.id,
      query: {},
    })
    await getCinemaHallBookings(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.bookings.length).toBeGreaterThanOrEqual(1)
    expect(data).toHaveProperty('total')
    expect(data).toHaveProperty('stats')
    expect(data.stats).toHaveProperty('total_revenue')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// verifyBookingById  (admin)
// ═══════════════════════════════════════════════════════════════════════════════

describe('verifyBookingById', () => {
  it('returns booking for valid UUID', async () => {
    const booking = await createBooking(customer.id, show.id)
    const { req, res } = mockReqRes({
      currentHallId: hall.id,
      params: { booking_id: booking.id },
    })
    await verifyBookingById(req, res)
    expect(res.json.mock.calls[0][0].booking.id).toBe(booking.id)
  })

  it('rejects invalid UUID format', async () => {
    const { req, res } = mockReqRes({
      currentHallId: hall.id,
      params: { booking_id: 'not-a-uuid' },
    })
    await verifyBookingById(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns 404 when booking belongs to another hall', async () => {
    const booking = await createBooking(customer.id, show.id)
    const { req, res } = mockReqRes({
      currentHallId: '00000000-0000-0000-0000-000000000000',
      params: { booking_id: booking.id },
    })
    await verifyBookingById(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// getBookingDetails  (customer)
// ═══════════════════════════════════════════════════════════════════════════════

describe('getBookingDetails', () => {
  it('returns booking for the owning customer', async () => {
    const booking = await createBooking(customer.id, show.id)
    const { req, res } = mockReqRes({
      customer: { id: customer.id },
      params: { booking_id: booking.id },
    })
    await getBookingDetails(req, res)
    expect(res.json.mock.calls[0][0].booking.id).toBe(booking.id)
  })

  it('rejects invalid UUID format', async () => {
    const { req, res } = mockReqRes({
      customer: { id: customer.id },
      params: { booking_id: 'bad-uuid' },
    })
    await getBookingDetails(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns 404 for another customers booking', async () => {
    const otherCust = await createCustomer()
    const booking = await createBooking(otherCust.id, show.id)
    const { req, res } = mockReqRes({
      customer: { id: customer.id },
      params: { booking_id: booking.id },
    })
    await getBookingDetails(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })
})
