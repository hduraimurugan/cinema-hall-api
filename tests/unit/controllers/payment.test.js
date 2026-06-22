import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import crypto from 'node:crypto'
import { getPool } from '../../setup/db.js'
import {
  createAdmin, createHall, createScreen, createMovie, createShow,
  createCustomer, createBooking,
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
  hall = await createHall(admin.id, { name: 'Payment Test Hall' })
  screen = await createScreen(hall.id, {
    layout: JSON.stringify({
      rows: 2, cols: 3,
      seats: [{ id: 'A1', row: 'A', column: 1, type: 'standard' }],
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

describe('createOrder', () => {
  it('creates a Razorpay order for held seats', async () => {
    await pool.query(
      `INSERT INTO show_booked_seats (show_id, seat_id, seat_label, row_label, column_number, status, held_by, hold_expires_at)
       VALUES ($1, 'A1', 'A1', 'A', 1, 'HELD', $2, $3)`,
      [show.id, customer.id, new Date(Date.now() + 600000)]
    )
    mockRazorpayOrdersCreate.mockResolvedValueOnce({
      id: 'order_create_test', amount: 21500, currency: 'INR',
    })

    const { req, res } = mockReqRes({
      body: { show_id: show.id, seats: ['A1'] },
      customer: { id: customer.id },
    })
    await createOrder(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0]).toHaveProperty('order_id')
    expect(res.json.mock.calls[0][0].order_id).toBe('order_create_test')
  })

  it('rejects when seats are not held', async () => {
    const { req, res } = mockReqRes({
      body: { show_id: show.id, seats: ['A1'] },
      customer: { id: customer.id },
    })
    await createOrder(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toMatch(/no longer held/i)
  })

  it('returns existing active order (dedup)', async () => {
    await pool.query(
      `INSERT INTO payment_orders (order_id, show_id, customer_id, seats, amount, status)
       VALUES ('order_dedup_test', $1, $2, $3::jsonb, 200, 'created')`,
      [show.id, customer.id, JSON.stringify(['A1'])]
    )

    const { req, res } = mockReqRes({
      body: { show_id: show.id, seats: ['A1'] },
      customer: { id: customer.id },
    })
    await createOrder(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0]).toHaveProperty('_idempotent', true)
  })

  it('applies offer discount when offer_code provided', async () => {
    await pool.query(
      `INSERT INTO show_booked_seats (show_id, seat_id, seat_label, row_label, column_number, status, held_by, hold_expires_at)
       VALUES ($1, 'A1', 'A1', 'A', 1, 'HELD', $2, $3)`,
      [show.id, customer.id, new Date(Date.now() + 600000)]
    )
    mockRazorpayOrdersCreate.mockResolvedValueOnce({
      id: 'order_offer_test', amount: 15000, currency: 'INR',
    })
    vi.mocked(validateOfferCode).mockResolvedValueOnce({
      discountAmount: 65,
      offer: { code: 'TEST20' },
    })

    const { req, res } = mockReqRes({
      body: { show_id: show.id, seats: ['A1'], offer_code: 'TEST20' },
      customer: { id: customer.id },
    })
    await createOrder(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(validateOfferCode).toHaveBeenCalled()
  })
})

describe('verifyPayment', () => {
  it('verifies payment and creates booking', async () => {
    await pool.query(
      `INSERT INTO show_booked_seats (show_id, seat_id, seat_label, row_label, column_number, status, held_by, hold_expires_at)
       VALUES ($1, 'A1', 'A1', 'A', 1, 'HELD', $2, $3)`,
      [show.id, customer.id, new Date(Date.now() + 600000)]
    )
    await pool.query(
      `INSERT INTO payment_orders (order_id, show_id, customer_id, seats, amount, status)
       VALUES ('order_verify_test', $1, $2, $3::jsonb, 200, 'created')`,
      [show.id, customer.id, JSON.stringify(['A1'])]
    )

    const body = 'order_verify_test|pay_verify_test'
    const signature = crypto.createHmac('sha256', 'test-razorpay-secret').update(body).digest('hex')

    const { req, res } = mockReqRes({
      body: {
        razorpay_order_id: 'order_verify_test',
        razorpay_payment_id: 'pay_verify_test',
        razorpay_signature: signature,
      },
      customer: { id: customer.id },
    })
    await verifyPayment(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0]).toHaveProperty('booking')
    expect(res.json.mock.calls[0][0].booking.show_id).toBe(show.id)
  })

  it('rejects invalid signature', async () => {
    const { req, res } = mockReqRes({
      body: {
        razorpay_order_id: 'order_fake',
        razorpay_payment_id: 'pay_fake',
        razorpay_signature: 'invalid_sig',
      },
      customer: { id: customer.id },
    })
    await verifyPayment(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toMatch(/signature/i)
  })
})

describe('getPaymentOrders', () => {
  it('returns payment orders for the cinema hall', async () => {
    await pool.query(
      `INSERT INTO payment_orders (order_id, show_id, customer_id, seats, amount, status)
       VALUES ('order_list_test', $1, $2, $3::jsonb, 200, 'created')`,
      [show.id, customer.id, JSON.stringify(['A1'])]
    )

    const { req, res } = mockReqRes({ currentHallId: hall.id, query: { page: 1 } })
    await getPaymentOrders(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0]).toHaveProperty('orders')
    expect(res.json.mock.calls[0][0].total).toBeGreaterThanOrEqual(1)
  })

  it('returns empty list when no orders', async () => {
    const { req, res } = mockReqRes({ currentHallId: '00000000-0000-0000-0000-000000000000', query: { page: 1 } })
    await getPaymentOrders(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].orders).toEqual([])
  })
})

describe('handleWebhook', () => {
  it('rejects invalid signature', async () => {
    const { req, res } = mockReqRes({
      body: Buffer.from(JSON.stringify({ event: 'payment.captured', payload: {} })),
      headers: { 'x-razorpay-signature': 'bad_sig' },
      customer: { id: customer.id },
    })
    await handleWebhook(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toMatch(/signature/i)
  })

  it('processes payment.captured event', async () => {
    await pool.query(
      `INSERT INTO payment_orders (order_id, show_id, customer_id, seats, amount, status)
       VALUES ('order_webhook_test', $1, $2, $3::jsonb, 200, 'created')`,
      [show.id, customer.id, JSON.stringify(['A1'])]
    )

    const eventPayload = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: { order_id: 'order_webhook_test', id: 'pay_webhook_test' },
        },
      },
    })
    const rawBody = Buffer.from(eventPayload)
    const sig = crypto.createHmac('sha256', 'test-webhook-secret').update(rawBody).digest('hex')

    const { req, res } = mockReqRes({
      body: rawBody,
      headers: {
        'x-razorpay-signature': sig,
        'x-razorpay-event-id': 'evt_webhook_test',
      },
      customer: { id: customer.id },
    })
    await handleWebhook(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0]).toHaveProperty('received', true)

    const orderCheck = await pool.query(`SELECT status FROM payment_orders WHERE order_id = 'order_webhook_test'`)
    expect(orderCheck.rows[0].status).toBe('paid')
  })
})
