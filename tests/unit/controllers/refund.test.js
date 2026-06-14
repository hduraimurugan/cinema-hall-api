import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { getPool } from '../../setup/db.js'
import { createAdmin, createHall, createScreen, createMovie, createShow, createCustomer, createBooking } from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import { getRefunds, getRefundByBooking, manuallySettleRefund } from '../../../controllers/refund.Controller.js'

function mockReqRes(overrides = {}) {
  const req = { query: {}, params: {}, body: {}, currentHallId: null, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

let admin, hall, screen, movie, show, customer, booking

beforeAll(async () => {
  admin = await createAdmin()
  hall = await createHall(admin.id, { name: 'Refund Hall' })
  screen = await createScreen(hall.id)
  movie = await createMovie()
  show = await createShow(screen.id, movie.id, { price: 400, status: 'show_ended' })
  customer = await createCustomer()
  booking = await createBooking(customer.id, show.id, { total_amount: 400, status: 'cancelled' })
})

afterEach(async () => {
  const p = getPool()
  await p.query('DELETE FROM refunds')
})

describe('getRefunds', () => {
  it('returns empty refund list', async () => {
    const { req, res } = mockReqRes({ currentHallId: hall.id, query: { page: 1 } })
    await getRefunds(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0]).toHaveProperty('refunds')
    expect(res.json.mock.calls[0][0].refunds).toEqual([])
    expect(res.json.mock.calls[0][0].total).toBe(0)
  })

  it('returns refunds with filters', async () => {
    const p = getPool()
    await p.query(
      `INSERT INTO refunds (booking_id, payment_id, amount, refund_status, initiated_at)
       VALUES ($1, 'pay_test', 400, 'initiated', NOW())`,
      [booking.id]
    )

    const { req, res } = mockReqRes({ currentHallId: hall.id, query: { page: 1, status: 'initiated' } })
    await getRefunds(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].refunds.length).toBe(1)
    expect(res.json.mock.calls[0][0].total).toBe(1)
  })
})

describe('getRefundByBooking', () => {
  it('returns 404 if no refund', async () => {
    const { req, res } = mockReqRes({ currentHallId: hall.id, params: { booking_id: booking.id } })
    await getRefundByBooking(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('returns refund for booking', async () => {
    const p = getPool()
    await p.query(
      `INSERT INTO refunds (booking_id, payment_id, amount, refund_status, initiated_at)
       VALUES ($1, 'pay_test3', 400, 'initiated', NOW())`,
      [booking.id]
    )

    const { req, res } = mockReqRes({ currentHallId: hall.id, params: { booking_id: booking.id } })
    await getRefundByBooking(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].refund.amount).toBe('400.00')
  })
})

describe('manuallySettleRefund', () => {
  let refundId

  beforeEach(async () => {
    const p = getPool()
    const r = await p.query(
      `INSERT INTO refunds (booking_id, payment_id, amount, refund_status, initiated_at)
       VALUES ($1, 'pay_settle', 400, 'initiated', NOW()) RETURNING *`,
      [booking.id]
    )
    refundId = r.rows[0].id
  })

  it('returns 404 for invalid refund', async () => {
    const { req, res } = mockReqRes({ currentHallId: hall.id, params: { refund_id: '00000000-0000-0000-0000-000000000000' } })
    await manuallySettleRefund(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('settles initiated refund', async () => {
    const { req, res } = mockReqRes({ currentHallId: hall.id, params: { refund_id: refundId } })
    await manuallySettleRefund(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].message).toMatch(/settled/i)
  })

  it('rejects already settled refund', async () => {
    const p = getPool()
    await p.query(`UPDATE refunds SET refund_status = 'settled', settled_at = NOW() WHERE id = $1`, [refundId])

    const { req, res } = mockReqRes({ currentHallId: hall.id, params: { refund_id: refundId } })
    await manuallySettleRefund(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toMatch(/already settled/i)
  })
})
