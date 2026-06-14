import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { getPool, query } from '../../setup/db.js'
import {
  createAdmin, createHall, createScreen, createMovie, createShow,
  createCustomer,
} from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

import {
  holdSeats, confirmBooking, releaseSeats,
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
  hall = await createHall(admin.id, { name: 'Edge Hall' })
  screen = await createScreen(hall.id, {
    name: 'Edge Screen',
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
})

describe('holdSeats — edge cases', () => {
  it('rejects empty seats array', async () => {
    const { req, res } = mockReqRes({
      customer: { id: customer.id },
      body: { show_id: show.id, seats: [] },
    })
    await holdSeats(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rolls back when any one seat in a batch is unavailable', async () => {
    await createHeldSeat(show.id, 'E1', customer.id)
    const otherCust = await createCustomer()
    const { req, res } = mockReqRes({
      customer: { id: otherCust.id },
      body: { show_id: show.id, seats: ['E2', 'E1'] },
    })
    await holdSeats(req, res)
    expect(res.status).toHaveBeenCalledWith(409)

    const e2Status = await query(
      `SELECT status FROM show_booked_seats WHERE show_id = $1 AND seat_id = 'E2'`,
      [show.id]
    )
    expect(e2Status.rowCount).toBe(0)
  })
})

describe('confirmBooking — edge cases', () => {
  it('rejects nonexistent seat', async () => {
    const { req, res } = mockReqRes({
      customer: { id: customer.id, email: customer.email },
      body: { show_id: show.id, seats: ['NE1'], total_amount: 100 },
    })
    await confirmBooking(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toMatch(/not found/i)
  })

  it('rejects seat not held', async () => {
    await query(
      `INSERT INTO show_booked_seats (show_id, seat_id, seat_label, row_label, column_number, status, held_by, hold_expires_at)
       VALUES ($1, 'NH1', 'NH1', '', 0, 'AVAILABLE', NULL, NULL)`,
      [show.id]
    )
    const { req, res } = mockReqRes({
      customer: { id: customer.id, email: customer.email },
      body: { show_id: show.id, seats: ['NH1'], total_amount: 100 },
    })
    await confirmBooking(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toMatch(/not held/i)
  })
})

describe('releaseSeats — edge cases', () => {
  it('releasing seats that are not held returns empty release array', async () => {
    const { req, res } = mockReqRes({
      customer: { id: customer.id },
      body: { show_id: show.id, seats: ['NE1'] },
    })
    await releaseSeats(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].released).toEqual([])
  })

  it('releases only seats owned by the requesting customer', async () => {
    await createHeldSeat(show.id, 'RO1', customer.id)
    const otherCust = await createCustomer()
    const { req, res } = mockReqRes({
      customer: { id: otherCust.id },
      body: { show_id: show.id, seats: ['RO1'] },
    })
    await releaseSeats(req, res)
    expect(res.json.mock.calls[0][0].released).toEqual([])

    const stillHeld = await query(
      `SELECT COUNT(*) FROM show_booked_seats WHERE show_id = $1 AND seat_id = 'RO1' AND status = 'HELD'`,
      [show.id]
    )
    expect(parseInt(stillHeld.rows[0].count)).toBe(1)
  })

  it('duplicate release is idempotent', async () => {
    await createHeldSeat(show.id, 'ID1', customer.id)

    const { req: req1, res: res1 } = mockReqRes({
      customer: { id: customer.id },
      body: { show_id: show.id, seats: ['ID1'] },
    })
    await releaseSeats(req1, res1)
    expect(res1.json.mock.calls[0][0].released).toContain('ID1')

    const { req: req2, res: res2 } = mockReqRes({
      customer: { id: customer.id },
      body: { show_id: show.id, seats: ['ID1'] },
    })
    await releaseSeats(req2, res2)
    expect(res2.json.mock.calls[0][0].released).toEqual([])
  })
})
