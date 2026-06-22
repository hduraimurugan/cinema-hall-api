import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import crypto from 'node:crypto'
import { getPool } from '../../setup/db.js'
import {
  createAdmin, createHall, createScreen, createMovie, createShow,
  createCustomer,
} from '../../setup/factories.js'

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }))
vi.mock('../../../utils/logger.js', () => ({ default: mockLogger }))

const mockRazorpayOrdersCreate = vi.hoisted(() => vi.fn())
vi.mock('razorpay', () => {
  function MockRazorpay() {
    return {
      orders: { create: mockRazorpayOrdersCreate },
      payments: { refund() { return Promise.resolve({ id: 'rfp_test' }) } },
    }
  }
  return { default: MockRazorpay }
})

vi.mock('../../../controllers/offers.Controller.js', () => ({
  validateOfferCode: vi.fn(),
}))

import { createOrder, verifyPayment, handleWebhook, getPaymentOrders } from '../../../controllers/payment.Controller.js'
import { validateOfferCode } from '../../../controllers/offers.Controller.js'

function mockReqRes(overrides = {}) {
  const req = {
    query: {}, params: {}, body: {}, headers: {}, currentHallId: null,
    customer: { id: '00000000-0000-0000-0000-000000000000' },
    ...overrides,
  }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

let pool, admin, hall, screen, movie, show, customer

beforeAll(async () => {
  pool = getPool()
  admin = await createAdmin()
  hall = await createHall(admin.id, { name: 'Payment Edge Hall' })
  screen = await createScreen(hall.id, {
    layout: JSON.stringify({
      rows: 2, cols: 3,
      seats: [{ id: 'P1', row: 'P', column: 1, type: 'standard' }],
      pricing: { standard: 200 },
    }),
  })
  movie = await createMovie()
  show = await createShow(screen.id, movie.id, { price: 200 })
  customer = await createCustomer()

  const orgCheck = await pool.query(`SELECT org_id FROM cinema_hall WHERE id = $1`, [hall.id])
  const orgId = orgCheck.rows[0].org_id

  await pool.query(
    `INSERT INTO organization_settings (org_id, section, value)
     VALUES ($1, 'payment', $2::jsonb)
     ON CONFLICT (org_id, section) DO UPDATE SET value = EXCLUDED.value`,
    [orgId, JSON.stringify({ convenience_fee: { model: 'per_ticket', amount: 15 }, gst_percentage: 18, gst_applies_to: 'convenience_fee', state_taxes: [] })]
  )
})

afterEach(async () => {
  await pool.query('DELETE FROM webhook_events')
  await pool.query('DELETE FROM offer_redemptions')
  await pool.query('DELETE FROM bookings')
  await pool.query('DELETE FROM payment_orders')
  await pool.query('DELETE FROM show_booked_seats')
})

describe('createOrder — edge cases', () => {
  it('rejects missing show_id', async () => {
    const { req, res } = mockReqRes({
      body: { seats: ['P1'] },
      customer: { id: customer.id },
    })
    await createOrder(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rejects expired hold', async () => {
    await pool.query(
      `INSERT INTO show_booked_seats (show_id, seat_id, seat_label, row_label, column_number, status, held_by, hold_expires_at)
       VALUES ($1, 'P1', 'P1', 'P', 1, 'HELD', $2, now() - interval '1 minute')`,
      [show.id, customer.id]
    )
    const { req, res } = mockReqRes({
      body: { show_id: show.id, seats: ['P1'] },
      customer: { id: customer.id },
    })
    await createOrder(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toMatch(/no longer held/i)
  })
})

describe('verifyPayment — edge cases', () => {
  it('rejects already verified (paid) order', async () => {
    await pool.query(
      `INSERT INTO show_booked_seats (show_id, seat_id, seat_label, row_label, column_number, status, held_by, hold_expires_at)
       VALUES ($1, 'P2', 'P2', 'P', 2, 'HELD', $2, now() + interval '10 minutes')`,
      [show.id, customer.id]
    )
    await pool.query(
      `INSERT INTO payment_orders (order_id, show_id, customer_id, seats, amount, status)
       VALUES ('order_double_pay', $1, $2, $3::jsonb, 200, 'paid')`,
      [show.id, customer.id, JSON.stringify(['P2'])]
    )

    const body = 'order_double_pay|pay_double_test'
    const sig = crypto.createHmac('sha256', 'test-razorpay-secret').update(body).digest('hex')

    const { req, res } = mockReqRes({
      body: {
        razorpay_order_id: 'order_double_pay',
        razorpay_payment_id: 'pay_double_test',
        razorpay_signature: sig,
      },
      customer: { id: customer.id },
    })
    await verifyPayment(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0]).toHaveProperty('_idempotent', true)
  })
})

describe('handleWebhook — edge cases', () => {
  it('silently accepts unknown event type', async () => {
    const eventPayload = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: { order_id: 'order_unknown', id: 'pay_unknown' },
        },
      },
    })
    const rawBody = Buffer.from(eventPayload)
    const sig = crypto.createHmac('sha256', 'test-webhook-secret').update(rawBody).digest('hex')

    const { req, res } = mockReqRes({
      body: rawBody,
      headers: {
        'x-razorpay-signature': sig,
        'x-razorpay-event-id': 'evt_unknown',
      },
    })
    await handleWebhook(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0]).toHaveProperty('received', true)
  })
})

describe('getPaymentOrders — edge cases', () => {
  it('handles pagination within bounds', async () => {
    const { req, res } = mockReqRes({ currentHallId: hall.id, query: { page: 1, limit: 5 } })
    await getPaymentOrders(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0]).toHaveProperty('orders')
  })
})
