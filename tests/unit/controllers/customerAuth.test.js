import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import crypto from 'crypto'
import bcrypt from 'bcrypt'
import { getPool, query } from '../../setup/db.js'
import { createCustomer } from '../../setup/factories.js'

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('jsonwebtoken', () => ({
  default: { sign: vi.fn(() => 'mock-jwt-token') },
}))

vi.mock('../../../utils/generateTokenAndSetCookie.js', () => ({
  generateCustomerTokenAndSetCookie: vi.fn(() =>
    Promise.resolve({ accessToken: 'mock-cus-at', refreshToken: 'mock-cus-rt' })
  ),
}))

vi.mock('../../../utils/oauthProviders.js', () => ({
  verifyGoogleToken: vi.fn(),
}))

vi.mock('../../../utils/oauthRateLimit.js', () => ({
  checkOAuthRateLimit: vi.fn(() => ({ allowed: true })),
}))

vi.mock('../../../mail/emails.js', () => ({
  sendCustomerOtpEmail: vi.fn(() => Promise.resolve()),
  sendCustomerAccountLockedEmail: vi.fn(() => Promise.resolve()),
  sendCustomerPasswordChangedEmail: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../../utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import {
  registerCustomer, loginCustomer, logoutCustomer, updateCustomerProfile,
  changePasswordCustomer, forgotPasswordCustomer, resetPasswordCustomer,
  refreshCustomerToken, getCustomerMe, googleLoginCustomer, setPasswordCustomer,
} from '../../../controllers/customerAuth.Controller.js'

import { generateCustomerTokenAndSetCookie } from '../../../utils/generateTokenAndSetCookie.js'
import { verifyGoogleToken } from '../../../utils/oauthProviders.js'

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function mockReqRes(overrides = {}) {
  const req = {
    body: {}, params: {}, query: {}, cookies: {},
    admin: { id: 'none' }, customer: { id: 'none' },
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

let pool, sharedCustomer, sharedCustomerPassword

beforeAll(async () => {
  pool = getPool()
  sharedCustomerPassword = 'CustomerPass123!'
  const hashed = await bcrypt.hash(sharedCustomerPassword, 12)
  const result = await query(
    `INSERT INTO customers (name, email, password, phone, is_verified, is_active)
     VALUES ($1, $2, $3, $4, TRUE, TRUE)
     RETURNING *`,
    ['Shared Customer', `shared_cust_${Date.now()}@test.com`, hashed, '9876543210']
  )
  sharedCustomer = result.rows[0]
})

afterEach(async () => {
  await query('DELETE FROM otp_verifications')
  await query('DELETE FROM customer_sessions')
  await query('DELETE FROM customers WHERE id != $1', [sharedCustomer.id])
})

// ═══════════════════════════════════════════════════════════════════════════════
// registerCustomer
// ═══════════════════════════════════════════════════════════════════════════════

describe('registerCustomer', () => {
  const prefix = `reg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

  it('registers a new customer', async () => {
    const email = `${prefix}_create@test.com`
    const { req, res } = mockReqRes({
      body: { name: 'New Customer', email, password: 'StrongPass1!', phone: '9876543210' },
    })
    await registerCustomer(req, res)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json.mock.calls[0][0].customer.email).toBe(email)
  })

  it('rejects missing required fields', async () => {
    const { req, res } = mockReqRes({ body: { name: 'No Email' } })
    await registerCustomer(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rejects duplicate email', async () => {
    const email = `${prefix}_dup@test.com`
    await createCustomer({ email })
    const { req, res } = mockReqRes({
      body: { name: 'Dup', email, password: 'StrongPass1!' },
    })
    await registerCustomer(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toMatch(/already registered/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// loginCustomer
// ═══════════════════════════════════════════════════════════════════════════════

describe('loginCustomer', () => {
  it('logs in with valid credentials', async () => {
    const { req, res } = mockReqRes({
      body: { email: sharedCustomer.email, password: sharedCustomerPassword },
    })
    await loginCustomer(req, res)
    expect(res.json.mock.calls[0][0].message).toBe('Login successful')
    expect(generateCustomerTokenAndSetCookie).toHaveBeenCalled()
  })

  it('rejects wrong password', async () => {
    const { req, res } = mockReqRes({
      body: { email: sharedCustomer.email, password: 'WrongPass123!' },
    })
    await loginCustomer(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toMatch(/invalid password/i)
  })

  it('rejects login when account is locked', async () => {
    const cust = await createCustomer()
    await query(
      `UPDATE customers SET account_locked_until = $1 WHERE id = $2`,
      [new Date(Date.now() + 60 * 60 * 1000), cust.id]
    )
    const { req, res } = mockReqRes({
      body: { email: cust.email, password: 'CustomerPass123!' },
    })
    await loginCustomer(req, res)
    expect(res.status).toHaveBeenCalledWith(423)
    expect(res.json.mock.calls[0][0].code).toBe('ACCOUNT_LOCKED')
  })

  it('rejects unverified email', async () => {
    const cust = await createCustomer()
    const { req, res } = mockReqRes({
      body: { email: cust.email, password: 'CustomerPass123!' },
    })
    await loginCustomer(req, res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json.mock.calls[0][0].error).toMatch(/verify/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// logoutCustomer
// ═══════════════════════════════════════════════════════════════════════════════

describe('logoutCustomer', () => {
  it('logs out successfully', async () => {
    const { req, res } = mockReqRes({
      customer: { id: sharedCustomer.id },
      cookies: { cusRefreshToken: 'some-token' },
    })
    await logoutCustomer(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/logged out/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// updateCustomerProfile
// ═══════════════════════════════════════════════════════════════════════════════

describe('updateCustomerProfile', () => {
  it('updates name and phone', async () => {
    const { req, res } = mockReqRes({
      customer: { id: sharedCustomer.id },
      body: { name: 'Updated Name', phone: '1111111111' },
    })
    await updateCustomerProfile(req, res)
    expect(res.json.mock.calls[0][0].customer.name).toBe('Updated Name')
  })

  it('rejects unauthorized request', async () => {
    const { req, res } = mockReqRes({ customer: { id: undefined } })
    await updateCustomerProfile(req, res)
    expect(res.status).toHaveBeenCalledWith(401)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// changePasswordCustomer
// ═══════════════════════════════════════════════════════════════════════════════

describe('changePasswordCustomer', () => {
  it('changes password successfully', async () => {
    const { req, res } = mockReqRes({
      customer: { id: sharedCustomer.id },
      cookies: { cusRefreshToken: 'current-session' },
      body: { currentPassword: sharedCustomerPassword, newPassword: 'NewStr0ngPass!' },
    })
    await changePasswordCustomer(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/changed/i)
  })

  it('rejects wrong current password', async () => {
    const { req, res } = mockReqRes({
      customer: { id: sharedCustomer.id },
      body: { currentPassword: 'WrongPass123!', newPassword: 'NewStr0ngPass!' },
    })
    await changePasswordCustomer(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rejects missing fields', async () => {
    const { req, res } = mockReqRes({
      customer: { id: sharedCustomer.id },
      body: {},
    })
    await changePasswordCustomer(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// forgotPasswordCustomer
// ═══════════════════════════════════════════════════════════════════════════════

describe('forgotPasswordCustomer', () => {
  it('stores OTP for known customer', async () => {
    const { req, res } = mockReqRes({ body: { email: sharedCustomer.email } })
    await forgotPasswordCustomer(req, res)
    expect(res.json.mock.calls[0][0].message).toBeDefined()

    const otps = await query(
      `SELECT * FROM otp_verifications WHERE email = $1 AND type = 'password_reset'`,
      [sharedCustomer.email]
    )
    expect(otps.rows.length).toBe(1)
  })

  it('returns generic response for unknown email', async () => {
    const { req, res } = mockReqRes({ body: { email: 'unknown@test.com' } })
    await forgotPasswordCustomer(req, res)
    expect(res.json.mock.calls[0][0].message).toBeDefined()

    const otps = await query(
      `SELECT * FROM otp_verifications WHERE email = $1 AND type = 'password_reset'`,
      ['unknown@test.com']
    )
    expect(otps.rows.length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// resetPasswordCustomer
// ═══════════════════════════════════════════════════════════════════════════════

describe('resetPasswordCustomer', () => {
  const testOtp = '123456'
  const otpHash = sha256(testOtp)

  it('resets password with valid OTP', async () => {
    await query(
      `INSERT INTO otp_verifications (email, type, otp, expires_at, is_verified, otp_attempts)
       VALUES ($1, 'password_reset', $2, now() + interval '10 minutes', FALSE, 0)`,
      [sharedCustomer.email, otpHash]
    )
    const { req, res } = mockReqRes({
      body: { email: sharedCustomer.email, otp: testOtp, newPassword: 'NewResetPass1!' },
    })
    await resetPasswordCustomer(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/reset/i)
  })

  it('rejects invalid OTP', async () => {
    await query(
      `INSERT INTO otp_verifications (email, type, otp, expires_at, is_verified, otp_attempts)
       VALUES ($1, 'password_reset', $2, now() + interval '10 minutes', FALSE, 0)`,
      [sharedCustomer.email, otpHash]
    )
    const { req, res } = mockReqRes({
      body: { email: sharedCustomer.email, otp: '000000', newPassword: 'NewResetPass1!' },
    })
    await resetPasswordCustomer(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rejects missing fields', async () => {
    const { req, res } = mockReqRes({ body: {} })
    await resetPasswordCustomer(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// refreshCustomerToken
// ═══════════════════════════════════════════════════════════════════════════════

describe('refreshCustomerToken', () => {
  it('issues a new access token', async () => {
    const { req, res } = mockReqRes({ customer: { id: sharedCustomer.id } })
    await refreshCustomerToken(req, res)
    expect(res.json.mock.calls[0][0].success).toBe(true)
    expect(res.cookie).toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// getCustomerMe
// ═══════════════════════════════════════════════════════════════════════════════

describe('getCustomerMe', () => {
  it('returns customer profile', async () => {
    const { req, res } = mockReqRes({ customer: { id: sharedCustomer.id } })
    await getCustomerMe(req, res)
    expect(res.json.mock.calls[0][0].customer.email).toBe(sharedCustomer.email)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// googleLoginCustomer
// ═══════════════════════════════════════════════════════════════════════════════

describe('googleLoginCustomer', () => {
  it('creates new customer via Google', async () => {
    const email = `google_cust_${Date.now()}@example.com`
    vi.mocked(verifyGoogleToken).mockResolvedValueOnce({
      googleId: 'gid-cust', email, name: 'Google Cust', picture: 'https://example.com/pic.jpg',
    })
    const { req, res } = mockReqRes({ body: { idToken: 'mock-token' } })
    await googleLoginCustomer(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/created/i)
    expect(generateCustomerTokenAndSetCookie).toHaveBeenCalled()
  })

  it('rejects missing idToken', async () => {
    const { req, res } = mockReqRes({ body: {} })
    await googleLoginCustomer(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// setPasswordCustomer
// ═══════════════════════════════════════════════════════════════════════════════

describe('setPasswordCustomer', () => {
  it('sets password for OAuth-only customer', async () => {
    const cust = await createCustomer({ auth_providers: ['google'], password: null })
    // Factory doesn't include auth_providers in INSERT, so update manually
    await query(
      `UPDATE customers SET auth_providers = ARRAY['google'], password = NULL WHERE id = $1`,
      [cust.id]
    )
    const { req, res } = mockReqRes({
      customer: { id: cust.id },
      body: { newPassword: 'NewStrongPass1!' },
    })
    await setPasswordCustomer(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/set/i)
  })
})
