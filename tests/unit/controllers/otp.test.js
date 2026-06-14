import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { getPool } from '../../setup/db.js'
import { createCustomer } from '../../setup/factories.js'

const { sendOtpEmailMock } = vi.hoisted(() => ({
  sendOtpEmailMock: vi.fn(),
}))
vi.mock('../../../mail/emails.js', () => ({
  sendCustomerOtpEmail: sendOtpEmailMock,
}))
vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import { sendOtp, verifyOtp } from '../../../controllers/otp.Controller.js'

function mockReqRes(overrides = {}) {
  const req = { body: {}, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

let customer

beforeAll(async () => {
  customer = await createCustomer({ email: 'otp-test@example.com', is_verified: false })
})

beforeEach(() => {
  sendOtpEmailMock.mockReset()
})

describe('sendOtp', () => {
  it('returns 400 if email missing', async () => {
    const { req, res } = mockReqRes({ body: {} })
    await sendOtp(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns 400 for invalid type', async () => {
    const { req, res } = mockReqRes({ body: { email: 'test@test.com', type: 'invalid' } })
    await sendOtp(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns 404 for unknown email (signup type)', async () => {
    const { req, res } = mockReqRes({ body: { email: 'unknown@example.com', type: 'signup' } })
    await sendOtp(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('returns generic message for unknown email (password_reset)', async () => {
    const { req, res } = mockReqRes({ body: { email: 'unknown@example.com', type: 'password_reset' } })
    await sendOtp(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.message).toMatch(/OTP has been sent/i)
  })

  it('sends OTP for known customer (signup)', async () => {
    const { req, res } = mockReqRes({ body: { email: customer.email, type: 'signup' } })
    await sendOtp(req, res)
    expect(sendOtpEmailMock).toHaveBeenCalledWith(customer.email, customer.name, expect.any(String), 'signup')
    expect(res.json.mock.calls[0][0].message).toMatch(/OTP sent/i)
  })
})

describe('verifyOtp', () => {
  it('returns 400 if email or otp missing', async () => {
    const { req, res } = mockReqRes({ body: {} })
    await verifyOtp(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns 404 if OTP not found', async () => {
    const { req, res } = mockReqRes({ body: { email: 'nonexistent@test.com', otp: '123456' } })
    await verifyOtp(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('returns 400 for wrong OTP', async () => {
    const { req: reqSend, res: resSend } = mockReqRes({ body: { email: customer.email, type: 'signup' } })
    await sendOtp(reqSend, resSend)

    const { req, res } = mockReqRes({ body: { email: customer.email, otp: '000000', type: 'signup' } })
    await verifyOtp(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toMatch(/attempt/i)
  })

  it('verifies correct OTP', async () => {
    const { req: reqSend, res: resSend } = mockReqRes({ body: { email: customer.email, type: 'signup' } })
    await sendOtp(reqSend, resSend)

    const capturedOtp = sendOtpEmailMock.mock.calls[0][2]

    const { req, res } = mockReqRes({ body: { email: customer.email, otp: capturedOtp, type: 'signup' } })
    await verifyOtp(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/verified/i)

    const p = getPool()
    const custResult = await p.query('SELECT is_verified FROM customers WHERE id = $1', [customer.id])
    expect(custResult.rows[0].is_verified).toBe(true)
  })
})
