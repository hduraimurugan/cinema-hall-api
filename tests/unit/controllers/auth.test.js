import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import crypto from 'crypto'
import { getPool, query } from '../../setup/db.js'
import { createAdmin, createHall } from '../../setup/factories.js'

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('jsonwebtoken', () => ({
  default: { sign: vi.fn(() => 'mock-jwt-token') },
}))

vi.mock('../../../utils/generateTokenAndSetCookie.js', () => ({
  generateTokenAndSetCookie: vi.fn(() =>
    Promise.resolve({ accessToken: 'mock-at', refreshToken: 'mock-rt' })
  ),
  // refreshCinemaAdminToken re-reads org context on every refresh instead of
  // copying it out of the expiring token, so the mock must provide it too.
  resolveOrgContext: vi.fn(() =>
    Promise.resolve({ orgId: null, roleKey: null, permissionsVersion: null })
  ),
}))

vi.mock('../../../utils/oauthProviders.js', () => ({
  verifyGoogleToken: vi.fn(),
  exchangeGithubCode: vi.fn(),
  getGithubUser: vi.fn(),
}))

vi.mock('../../../utils/oauthRateLimit.js', () => ({
  checkOAuthRateLimit: vi.fn(() => ({ allowed: true })),
}))

vi.mock('../../../mail/emails.js', () => ({
  sendAdminVerificationEmail: vi.fn(() => Promise.resolve()),
  sendAdminPasswordResetEmail: vi.fn(() => Promise.resolve()),
  sendAdminPasswordChangedEmail: vi.fn(() => Promise.resolve()),
  sendAdminAccountLockedEmail: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../../utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import {
  registerCinemaAdmin, loginCinemaAdmin, logoutCinemaAdmin, logoutAllDevices,
  refreshCinemaAdminToken, getCinemaAdminMe, forgotPassword, resetPassword,
  changePassword, verifyAdminEmail, resendVerificationEmail, getAdminSecurity,
  getAllAdmins, updateCinemaHall, googleLoginAdmin, githubLoginAdmin,
  linkProviderAdmin, unlinkProviderAdmin, setPasswordAdmin,
} from '../../../controllers/auth.Controller.js'

import { generateTokenAndSetCookie } from '../../../utils/generateTokenAndSetCookie.js'
import { verifyGoogleToken, exchangeGithubCode, getGithubUser } from '../../../utils/oauthProviders.js'

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

let pool, sharedAdmin, sharedHall

beforeAll(async () => {
  pool = getPool()
  sharedAdmin = await createAdmin({ email_verified: true })
  sharedHall = await createHall(sharedAdmin.id, { name: 'Auth Test Hall' })
})

afterEach(async () => {
  await query('DELETE FROM admin_security_logs')
  await query('DELETE FROM admin_password_reset_tokens')
  await query('DELETE FROM admin_verification_tokens')
  await query('DELETE FROM admin_sessions')
  await query('DELETE FROM hall_settings WHERE hall_id != $1', [sharedHall.id])
  await query('DELETE FROM organization_settings WHERE org_id != $1', [sharedHall.org_id])
  await query('DELETE FROM organization_members WHERE org_id != $1', [sharedHall.org_id])
  await query('DELETE FROM roles WHERE org_id != $1', [sharedHall.org_id])
  await query('DELETE FROM cinema_hall WHERE id != $1', [sharedHall.id])
  await query('DELETE FROM organizations WHERE id != $1', [sharedHall.org_id])
  await query('DELETE FROM cinema_admin_user WHERE id != $1', [sharedAdmin.id])
  await query('UPDATE cinema_admin_user SET password = $2 WHERE id = $1', [sharedAdmin.id, sharedAdmin.password])
})

// ═══════════════════════════════════════════════════════════════════════════════
// registerCinemaAdmin
// ═══════════════════════════════════════════════════════════════════════════════

describe('registerCinemaAdmin', () => {
  const prefix = `reg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

  it('creates admin with unverified email', async () => {
    const email = `${prefix}_create@test.com`
    const { req, res } = mockReqRes({
      body: { name: 'New Admin', email, password: 'StrongPass1!', phone: '9876543210' },
    })
    await registerCinemaAdmin(req, res)
    expect(res.status).toHaveBeenCalledWith(201)
    const data = res.json.mock.calls[0][0]
    expect(data.admin).toHaveProperty('id')
    expect(data.admin.email).toBe(email)
    expect(data.message).toMatch(/check your email/i)

    const rows = await query('SELECT email_verified FROM cinema_admin_user WHERE id = $1', [data.admin.id])
    expect(rows.rows[0].email_verified).toBe(false)
  })

  it('rejects missing required fields', async () => {
    const { req, res } = mockReqRes({ body: { name: 'No Email' } })
    await registerCinemaAdmin(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rejects duplicate email', async () => {
    const email = `${prefix}_dup@test.com`
    await createAdmin({ email, email_verified: false })
    const { req, res } = mockReqRes({
      body: { name: 'Dup Admin', email, password: 'StrongPass1!', phone: '9876543210' },
    })
    await registerCinemaAdmin(req, res)
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json.mock.calls[0][0].error).toMatch(/already exists/i)
  })

  it('rejects weak password', async () => {
    const { req, res } = mockReqRes({
      body: { name: 'Weak', email: `${prefix}_weak@test.com`, password: 'short', phone: '9876543210' },
    })
    await registerCinemaAdmin(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// verifyAdminEmail
// ═══════════════════════════════════════════════════════════════════════════════

describe('verifyAdminEmail', () => {
  const rawToken = 'verify-test-token'
  const tokenHash = sha256(rawToken)

  it('verifies email with valid token', async () => {
    const admin = await createAdmin({ email_verified: false })
    await query(
      `INSERT INTO admin_verification_tokens (admin_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 day')`,
      [admin.id, tokenHash]
    )
    const { req, res } = mockReqRes({ query: { token: rawToken } })
    await verifyAdminEmail(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/verified/i)

    const rows = await query('SELECT email_verified FROM cinema_admin_user WHERE id = $1', [admin.id])
    expect(rows.rows[0].email_verified).toBe(true)
  })

  it('rejects invalid token', async () => {
    const { req, res } = mockReqRes({ query: { token: 'invalid-token' } })
    await verifyAdminEmail(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_TOKEN')
  })

  it('rejects expired token', async () => {
    const admin = await createAdmin({ email_verified: false })
    await query(
      `INSERT INTO admin_verification_tokens (admin_id, token_hash, expires_at)
       VALUES ($1, $2, now() - interval '1 hour')`,
      [admin.id, tokenHash]
    )
    const { req, res } = mockReqRes({ query: { token: rawToken } })
    await verifyAdminEmail(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].code).toBe('TOKEN_EXPIRED')
  })

  it('rejects missing token', async () => {
    const { req, res } = mockReqRes({ query: {} })
    await verifyAdminEmail(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// resendVerificationEmail
// ═══════════════════════════════════════════════════════════════════════════════

describe('resendVerificationEmail', () => {
  const prefix = `rsnd_${Date.now()}`

  it('sends new verification email for unverified admin', async () => {
    const email = `${prefix}_unverified@test.com`
    await createAdmin({ email, email_verified: false })
    const { req, res } = mockReqRes({ body: { email } })
    await resendVerificationEmail(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/sent/i)
  })

  it('returns generic message for unknown email', async () => {
    const { req, res } = mockReqRes({ body: { email: 'doesnotexist@test.com' } })
    await resendVerificationEmail(req, res)
    expect(res.json.mock.calls[0][0].message).toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// loginCinemaAdmin
// ═══════════════════════════════════════════════════════════════════════════════

describe('loginCinemaAdmin', () => {
  it('logs in with valid credentials', async () => {
    const { req, res } = mockReqRes({
      body: { email: sharedAdmin.email, password: 'TestPass123!' },
    })
    await loginCinemaAdmin(req, res)
    expect(res.json.mock.calls[0][0].message).toBe('Login successful')
    expect(res.json.mock.calls[0][0].admin.email).toBe(sharedAdmin.email)
    expect(generateTokenAndSetCookie).toHaveBeenCalled()
  })

  it('rejects wrong password', async () => {
    const { req, res } = mockReqRes({
      body: { email: sharedAdmin.email, password: 'WrongPass123!' },
    })
    await loginCinemaAdmin(req, res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json.mock.calls[0][0].error).toMatch(/invalid credentials/i)
  })

  it('rejects login when account is locked', async () => {
    const admin = await createAdmin({
      email_verified: true,
      account_locked_until: new Date(Date.now() + 60 * 60 * 1000),
    })
    const { req, res } = mockReqRes({
      body: { email: admin.email, password: 'TestPass123!' },
    })
    await loginCinemaAdmin(req, res)
    expect(res.status).toHaveBeenCalledWith(423)
    expect(res.json.mock.calls[0][0].code).toBe('ACCOUNT_LOCKED')
  })

  it('rejects unverified email', async () => {
    const admin = await createAdmin({ email_verified: false })
    const { req, res } = mockReqRes({
      body: { email: admin.email, password: 'TestPass123!' },
    })
    await loginCinemaAdmin(req, res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json.mock.calls[0][0].code).toBe('EMAIL_NOT_VERIFIED')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// refreshCinemaAdminToken
// ═══════════════════════════════════════════════════════════════════════════════

describe('refreshCinemaAdminToken', () => {
  it('issues a new access token', async () => {
    const { req, res } = mockReqRes({ admin: { id: sharedAdmin.id } })
    await refreshCinemaAdminToken(req, res)
    expect(res.json.mock.calls[0][0].success).toBe(true)
    expect(res.cookie).toHaveBeenCalled()
  })

  it('returns 404 when admin not found', async () => {
    const { req, res } = mockReqRes({
      admin: { id: '00000000-0000-0000-0000-000000000000' },
    })
    await refreshCinemaAdminToken(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// getCinemaAdminMe
// ═══════════════════════════════════════════════════════════════════════════════

describe('getCinemaAdminMe', () => {
  it('returns admin profile', async () => {
    const { req, res } = mockReqRes({ admin: { id: sharedAdmin.id } })
    await getCinemaAdminMe(req, res)
    expect(res.json.mock.calls[0][0].admin.email).toBe(sharedAdmin.email)
    expect(res.json.mock.calls[0][0].hall).toBeDefined()
  })

  it('returns 404 for unknown admin', async () => {
    const { req, res } = mockReqRes({
      admin: { id: '00000000-0000-0000-0000-000000000000' },
    })
    await getCinemaAdminMe(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// forgotPassword
// ═══════════════════════════════════════════════════════════════════════════════

describe('forgotPassword', () => {
  it('sends reset email for verified admin', async () => {
    const { req, res } = mockReqRes({ body: { email: sharedAdmin.email } })
    await forgotPassword(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/sent/i)
  })

  it('returns generic message for unknown email', async () => {
    const { req, res } = mockReqRes({ body: { email: 'unknown@test.com' } })
    await forgotPassword(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/sent/i)
  })

  it('rejects missing email', async () => {
    const { req, res } = mockReqRes({ body: {} })
    await forgotPassword(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// resetPassword
// ═══════════════════════════════════════════════════════════════════════════════

describe('resetPassword', () => {
  const rawToken = 'reset-test-token'
  const tokenHash = sha256(rawToken)

  it('resets password with valid token', async () => {
    const admin = await createAdmin()
    await query(
      `INSERT INTO admin_password_reset_tokens (admin_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 hour')`,
      [admin.id, tokenHash]
    )
    const { req, res } = mockReqRes({
      body: { token: rawToken, newPassword: 'NewStrongPass1!' },
    })
    await resetPassword(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/reset/i)
  })

  it('rejects invalid token', async () => {
    const { req, res } = mockReqRes({
      body: { token: 'invalid-token', newPassword: 'NewStrongPass1!' },
    })
    await resetPassword(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_TOKEN')
  })

  it('rejects missing fields', async () => {
    const { req, res } = mockReqRes({ body: {} })
    await resetPassword(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// changePassword
// ═══════════════════════════════════════════════════════════════════════════════

describe('changePassword', () => {
  it('changes password successfully', async () => {
    const { req, res } = mockReqRes({
      admin: { id: sharedAdmin.id },
      cookies: { refreshToken: 'current-session-token' },
      body: { currentPassword: 'TestPass123!', newPassword: 'NewStr0ngPass!' },
    })
    await changePassword(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/changed/i)
  })

  it('rejects wrong current password', async () => {
    const { req, res } = mockReqRes({
      admin: { id: sharedAdmin.id },
      body: { currentPassword: 'WrongPass123!', newPassword: 'NewStr0ngPass!' },
    })
    await changePassword(req, res)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('rejects missing fields', async () => {
    const { req, res } = mockReqRes({
      admin: { id: sharedAdmin.id },
      body: {},
    })
    await changePassword(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// logoutCinemaAdmin
// ═══════════════════════════════════════════════════════════════════════════════

describe('logoutCinemaAdmin', () => {
  it('logs out successfully', async () => {
    const { req, res } = mockReqRes({
      admin: { id: sharedAdmin.id },
      cookies: { refreshToken: 'some-refresh-token' },
    })
    await logoutCinemaAdmin(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/logged out/i)
  })

  it('logs out without cookies gracefully', async () => {
    const { req, res } = mockReqRes({ admin: { id: sharedAdmin.id } })
    await logoutCinemaAdmin(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/logged out/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// logoutAllDevices
// ═══════════════════════════════════════════════════════════════════════════════

describe('logoutAllDevices', () => {
  it('revokes all sessions', async () => {
    const { req, res } = mockReqRes({ admin: { id: sharedAdmin.id } })
    await logoutAllDevices(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/all devices/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// getAdminSecurity
// ═══════════════════════════════════════════════════════════════════════════════

describe('getAdminSecurity', () => {
  it('returns security info', async () => {
    const { req, res } = mockReqRes({ admin: { id: sharedAdmin.id } })
    await getAdminSecurity(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data).toHaveProperty('emailVerified')
    expect(data).toHaveProperty('activeSessions')
    expect(data).toHaveProperty('recentLogs')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// getAllAdmins
// ═══════════════════════════════════════════════════════════════════════════════

describe('getAllAdmins', () => {
  it('returns paginated admin list', async () => {
    const { req, res } = mockReqRes({ query: {} })
    await getAllAdmins(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.admins.length).toBeGreaterThanOrEqual(1)
    expect(data).toHaveProperty('total')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// updateCinemaHall
// ═══════════════════════════════════════════════════════════════════════════════

describe('updateCinemaHall', () => {
  it('updates hall details', async () => {
    const { req, res } = mockReqRes({
      admin: { id: sharedAdmin.id },
      body: {
        hall_name: 'Updated Hall',
        hall_location: 'Updated City',
        hall_district: 'Updated District',
        hall_state: 'Updated State',
      },
    })
    await updateCinemaHall(req, res)
    expect(res.json.mock.calls[0][0].hall.name).toBe('Updated Hall')
  })

  it('rejects missing required fields', async () => {
    const { req, res } = mockReqRes({
      admin: { id: sharedAdmin.id },
      body: { hall_name: 'Only Name' },
    })
    await updateCinemaHall(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// googleLoginAdmin
// ═══════════════════════════════════════════════════════════════════════════════

describe('googleLoginAdmin', () => {
  it('creates new admin account via Google', async () => {
    const email = `google_new_${Date.now()}@example.com`
    vi.mocked(verifyGoogleToken).mockResolvedValueOnce({
      googleId: 'gid-new', email, name: 'Google New', picture: 'https://example.com/pic.jpg',
    })
    const { req, res } = mockReqRes({ body: { idToken: 'mock-id-token' } })
    await googleLoginAdmin(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/created/i)
    expect(res.json.mock.calls[0][0].admin.email).toBe(email)
    expect(generateTokenAndSetCookie).toHaveBeenCalled()
  })

  it('logs in existing Google-linked admin', async () => {
    const email = `google_existing_${Date.now()}@example.com`
    await createAdmin({ email, email_verified: true, auth_providers: ['google'] })
    vi.mocked(verifyGoogleToken).mockResolvedValueOnce({
      googleId: 'gid-existing', email, name: 'Google Existing', picture: 'https://example.com/pic.jpg',
    })
    const { req, res } = mockReqRes({ body: { idToken: 'mock-id-token' } })
    await googleLoginAdmin(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/successful/i)
  })

  it('rejects missing idToken', async () => {
    const { req, res } = mockReqRes({ body: {} })
    await googleLoginAdmin(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// githubLoginAdmin
// ═══════════════════════════════════════════════════════════════════════════════

describe('githubLoginAdmin', () => {
  it('creates new admin account via GitHub', async () => {
    const email = `gh_new_${Date.now()}@example.com`
    vi.mocked(exchangeGithubCode).mockResolvedValueOnce('mock-gh-token')
    vi.mocked(getGithubUser).mockResolvedValueOnce({
      githubId: 'ghid-new', email, name: 'GH New', picture: 'https://example.com/pic.jpg', emailVerified: true,
    })
    const { req, res } = mockReqRes({ body: { code: 'mock-code' } })
    await githubLoginAdmin(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/created/i)
    expect(generateTokenAndSetCookie).toHaveBeenCalled()
  })

  it('rejects missing code', async () => {
    const { req, res } = mockReqRes({ body: {} })
    await githubLoginAdmin(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// linkProviderAdmin
// ═══════════════════════════════════════════════════════════════════════════════

describe('linkProviderAdmin', () => {
  it('links Google provider', async () => {
    vi.mocked(verifyGoogleToken).mockResolvedValueOnce({
      googleId: 'link-gid', email: sharedAdmin.email, name: 'Link Google', picture: 'https://example.com/pic.jpg',
    })
    const { req, res } = mockReqRes({
      admin: { id: sharedAdmin.id },
      body: { provider: 'google', idToken: 'mock-token' },
    })
    await linkProviderAdmin(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/linked/i)
  })

  it('rejects invalid provider', async () => {
    const { req, res } = mockReqRes({
      admin: { id: sharedAdmin.id },
      body: { provider: 'twitter', idToken: 'mock-token' },
    })
    await linkProviderAdmin(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// unlinkProviderAdmin
// ═══════════════════════════════════════════════════════════════════════════════

describe('unlinkProviderAdmin', () => {
  it('unlinks Google provider when password exists', async () => {
    // Create admin with google provider and password
    const admin = await createAdmin({ auth_providers: ['local', 'google'] })
    const { req, res } = mockReqRes({
      admin: { id: admin.id },
      body: { provider: 'google' },
    })
    await unlinkProviderAdmin(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/unlinked/i)
  })

  it('rejects invalid provider', async () => {
    const { req, res } = mockReqRes({
      admin: { id: sharedAdmin.id },
      body: { provider: 'twitter' },
    })
    await unlinkProviderAdmin(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// setPasswordAdmin
// ═══════════════════════════════════════════════════════════════════════════════

describe('setPasswordAdmin', () => {
  it('sets password for OAuth-only admin', async () => {
    const admin = await createAdmin({ auth_providers: ['google'], password: null })
    const { req, res } = mockReqRes({
      admin: { id: admin.id },
      body: { newPassword: 'NewStrongPass1!' },
    })
    await setPasswordAdmin(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/set/i)
  })

  it('rejects when password already set', async () => {
    const { req, res } = mockReqRes({
      admin: { id: sharedAdmin.id },
      body: { newPassword: 'NewStrongPass1!' },
    })
    await setPasswordAdmin(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})
