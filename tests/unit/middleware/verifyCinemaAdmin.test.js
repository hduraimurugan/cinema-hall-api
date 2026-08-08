import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

vi.mock('../../../db.js', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}))

vi.mock('../../../utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../../utils/hashToken.js', () => ({
  hashToken: vi.fn((token) => `hashed-${token}`),
}))

import {
  verifyCinemaAdminAccessToken,
  verifyCinemaAdminRefreshToken,
  verifySuperAdmin,
  verifyCinemaHall,
  verifyScreenOwnership,
  verifyCustomer,
  requireActiveHall,
  requireActiveOrg,
  verifyCustomerRefreshToken,
} from '../../../middleware/verifyCinemaAdmin.js'

import pool from '../../../db.js'

function mockReqRes(opts = {}) {
  const req = {
    cookies: {},
    headers: {},
    body: {},
    ...opts,
  }
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }
  const next = vi.fn()
  return { req, res, next }
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ====================================================
// verifyCinemaAdminAccessToken
// ====================================================
describe('verifyCinemaAdminAccessToken', () => {
  it('returns 401 if accessToken cookie missing', async () => {
    const { req, res, next } = mockReqRes()
    await verifyCinemaAdminAccessToken(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ message: 'Access token missing' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 if token is invalid', async () => {
    vi.spyOn(jwt, 'verify').mockImplementation(() => { throw new Error('jwt malformed') })
    const { req, res, next } = mockReqRes({ cookies: { accessToken: 'bad-token' } })
    await verifyCinemaAdminAccessToken(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired access token' })
  })

  it('sets req.admin and calls next for valid token', async () => {
    const payload = { id: 'admin-1', email: 'a@test.com', role: 'admin' }
    vi.spyOn(jwt, 'verify').mockReturnValue(payload)
    const { req, res, next } = mockReqRes({ cookies: { accessToken: 'valid-token' } })
    await verifyCinemaAdminAccessToken(req, res, next)
    expect(req.admin).toEqual(payload)
    expect(next).toHaveBeenCalledOnce()
  })
})

// ====================================================
// verifySuperAdmin
// ====================================================
describe('verifySuperAdmin', () => {
  it('returns 401 if token missing', async () => {
    const { req, res, next } = mockReqRes()
    await verifySuperAdmin(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('returns 403 if not superAdmin role', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ id: 'a1', role: 'admin' })
    const { req, res, next } = mockReqRes({ cookies: { accessToken: 'token' } })
    await verifySuperAdmin(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ message: 'Access denied: Super admin only' })
  })

  it('calls next for superAdmin', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ id: 'a1', role: 'superAdmin' })
    const { req, res, next } = mockReqRes({ cookies: { accessToken: 'token' } })
    await verifySuperAdmin(req, res, next)
    expect(req.admin).toEqual({ id: 'a1', role: 'superAdmin' })
    expect(next).toHaveBeenCalledOnce()
  })
})

// ====================================================
// verifyCustomer
// ====================================================
describe('verifyCustomer', () => {
  it('returns 401 if cusAccessToken missing', async () => {
    const { req, res, next } = mockReqRes()
    await verifyCustomer(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ message: 'Customer access token missing' })
  })

  it('returns 403 for invalid token', async () => {
    vi.spyOn(jwt, 'verify').mockImplementation(() => { throw new Error('invalid') })
    const { req, res, next } = mockReqRes({ cookies: { cusAccessToken: 'bad' } })
    await verifyCustomer(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('sets req.customer and calls next', async () => {
    const payload = { id: 'c1', email: 'c@test.com' }
    vi.spyOn(jwt, 'verify').mockReturnValue(payload)
    const { req, res, next } = mockReqRes({ cookies: { cusAccessToken: 'valid' } })
    await verifyCustomer(req, res, next)
    expect(req.customer).toEqual(payload)
    expect(next).toHaveBeenCalledOnce()
  })
})

// ====================================================
// verifyCinemaAdminRefreshToken
// ====================================================
describe('verifyCinemaAdminRefreshToken', () => {
  it('returns 401 if refreshToken missing', async () => {
    const { req, res, next } = mockReqRes()
    await verifyCinemaAdminRefreshToken(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ message: 'Refresh token missing' })
  })

  it('returns 403 if token is invalid', async () => {
    vi.spyOn(jwt, 'verify').mockImplementation(() => { throw new Error('bad') })
    const { req, res, next } = mockReqRes({ cookies: { refreshToken: 'bad' } })
    await verifyCinemaAdminRefreshToken(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('returns 401 if session not found', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ id: 'a1' })
    pool.query.mockResolvedValue({ rows: [] })
    const { req, res, next } = mockReqRes({ cookies: { refreshToken: 'valid-token' } })
    await verifyCinemaAdminRefreshToken(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ message: 'Session has been revoked. Please log in again.' })
  })

  it('returns 401 if session is revoked', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ id: 'a1' })
    pool.query.mockResolvedValue({ rows: [{ id: 's1', is_revoked: true }] })
    const { req, res, next } = mockReqRes({ cookies: { refreshToken: 'revoked-token' } })
    await verifyCinemaAdminRefreshToken(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('sets req.admin and calls next for valid session', async () => {
    const payload = { id: 'a1', email: 'a@test.com' }
    vi.spyOn(jwt, 'verify').mockReturnValue(payload)
    pool.query.mockResolvedValue({ rows: [{ id: 's1', is_revoked: false }] })
    const { req, res, next } = mockReqRes({ cookies: { refreshToken: 'valid-token' } })
    await verifyCinemaAdminRefreshToken(req, res, next)
    expect(req.admin).toEqual(payload)
    expect(next).toHaveBeenCalledOnce()
  })
})

// ====================================================
// verifyCustomerRefreshToken
// ====================================================
describe('verifyCustomerRefreshToken', () => {
  it('returns 401 if cusRefreshToken missing', async () => {
    const { req, res, next } = mockReqRes()
    await verifyCustomerRefreshToken(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('returns 403 for invalid token', async () => {
    vi.spyOn(jwt, 'verify').mockImplementation(() => { throw new Error('bad') })
    const { req, res, next } = mockReqRes({ cookies: { cusRefreshToken: 'bad' } })
    await verifyCustomerRefreshToken(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('returns 401 if customer session revoked', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ id: 'c1' })
    pool.query.mockResolvedValue({ rows: [{ id: 's1', is_revoked: true }] })
    const { req, res, next } = mockReqRes({ cookies: { cusRefreshToken: 'revoked' } })
    await verifyCustomerRefreshToken(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('sets req.customer and calls next for valid session', async () => {
    const payload = { id: 'c1', email: 'c@test.com' }
    vi.spyOn(jwt, 'verify').mockReturnValue(payload)
    pool.query.mockResolvedValue({ rows: [{ id: 's1', is_revoked: false }] })
    const { req, res, next } = mockReqRes({ cookies: { cusRefreshToken: 'valid' } })
    await verifyCustomerRefreshToken(req, res, next)
    expect(req.customer).toEqual(payload)
    expect(next).toHaveBeenCalledOnce()
  })
})

// ====================================================
// verifyCinemaHall
// ====================================================
describe('verifyCinemaHall', () => {
  it('returns 401 if accessToken missing', async () => {
    const { req, res, next } = mockReqRes()
    await verifyCinemaHall(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('returns 404 if admin has no halls', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ id: 'a1' })
    const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
    pool.connect.mockResolvedValue(mockClient)
    const { req, res, next } = mockReqRes({ cookies: { accessToken: 'token' } })
    await verifyCinemaHall(req, res, next)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ message: 'Cinema hall not found for admin' })
  })

  it('sets req.my_cinema_hall as object for single hall', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ id: 'a1' })
    const hall = { id: 'h1', name: 'Hall 1' }
    const mockClient = { query: vi.fn().mockResolvedValue({ rows: [hall] }), release: vi.fn() }
    pool.connect.mockResolvedValue(mockClient)
    const { req, res, next } = mockReqRes({ cookies: { accessToken: 'token' } })
    await verifyCinemaHall(req, res, next)
    expect(req.my_cinema_hall).toEqual(hall)
    expect(next).toHaveBeenCalledOnce()
  })

  it('sets req.my_cinema_hall as array for multiple halls', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ id: 'a1' })
    const halls = [{ id: 'h1' }, { id: 'h2' }]
    const mockClient = { query: vi.fn().mockResolvedValue({ rows: halls }), release: vi.fn() }
    pool.connect.mockResolvedValue(mockClient)
    const { req, res, next } = mockReqRes({ cookies: { accessToken: 'token' } })
    await verifyCinemaHall(req, res, next)
    expect(req.my_cinema_hall).toEqual(halls)
    expect(Array.isArray(req.my_cinema_hall)).toBe(true)
    expect(next).toHaveBeenCalledOnce()
  })
})

// ====================================================
// requireActiveHall
// ====================================================
describe('requireActiveHall', () => {
  beforeEach(() => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ id: 'a1' })
  })

  it('returns 400 if X-Hall-Id header missing', async () => {
    const { req, res, next } = mockReqRes({ admin: { id: 'a1' } })
    await requireActiveHall(req, res, next)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ message: 'X-Hall-Id header is required' })
  })

  it('returns 403 if hall not found or caller is not a member of its org', async () => {
    pool.query.mockResolvedValue({ rows: [] })
    const { req, res, next } = mockReqRes({
      admin: { id: 'a1' },
      headers: { 'x-hall-id': 'h1' },
    })
    await requireActiveHall(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('returns 403 for an org member with no claim on the hall', async () => {
    // Member of the hall's org, but a scoped role and no hall assignment.
    pool.query.mockResolvedValue({
      rows: [{ id: 'h1', org_id: 'o1', is_creator: false, role_key: 'sales', assignment_scope: null }],
    })
    const { req, res, next } = mockReqRes({
      admin: { id: 'a1' },
      headers: { 'x-hall-id': 'h1' },
    })
    await requireActiveHall(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('grants full scope to an org owner who did not create the hall', async () => {
    pool.query.mockResolvedValue({
      rows: [{ id: 'h1', org_id: 'o1', is_creator: false, role_key: 'owner', assignment_scope: null }],
    })
    const { req, res, next } = mockReqRes({
      admin: { id: 'a1' },
      headers: { 'x-hall-id': 'h1' },
    })
    await requireActiveHall(req, res, next)
    expect(req.currentHallId).toBe('h1')
    expect(req.orgId).toBe('o1')
    expect(req.hallScope).toBe('full')
    expect(next).toHaveBeenCalledOnce()
  })

  it('honours an explicit read_only hall assignment', async () => {
    pool.query.mockResolvedValue({
      rows: [{ id: 'h1', org_id: 'o1', is_creator: false, role_key: 'manager', assignment_scope: 'read_only' }],
    })
    const { req, res, next } = mockReqRes({
      admin: { id: 'a1' },
      headers: { 'x-hall-id': 'h1' },
    })
    await requireActiveHall(req, res, next)
    expect(req.hallScope).toBe('read_only')
    expect(next).toHaveBeenCalledOnce()
  })

  it('sets req.currentHallId for valid hall', async () => {
    pool.query.mockResolvedValue({
      rows: [{ id: 'h1', org_id: 'o1', is_creator: true, role_key: 'manager', assignment_scope: null }],
    })
    const { req, res, next } = mockReqRes({
      admin: { id: 'a1' },
      headers: { 'x-hall-id': 'h1' },
    })
    await requireActiveHall(req, res, next)
    expect(req.currentHallId).toBe('h1')
    expect(next).toHaveBeenCalledOnce()
  })
})

// ====================================================
// requireActiveOrg
// ====================================================
describe('requireActiveOrg', () => {
  it('returns 400 when no org can be determined', async () => {
    const { req, res, next } = mockReqRes({ admin: { id: 'a1' } })
    await requireActiveOrg(req, res, next)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ message: 'X-Org-Id header is required' })
  })

  it('returns 403 when the caller is not an active member of the org', async () => {
    pool.query.mockResolvedValue({ rows: [] })
    const { req, res, next } = mockReqRes({
      admin: { id: 'a1' },
      headers: { 'x-org-id': 'o1' },
    })
    await requireActiveOrg(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('sets req.orgId and req.orgRole for an active member', async () => {
    pool.query.mockResolvedValue({ rows: [{ org_id: 'o1', role_key: 'manager' }] })
    const { req, res, next } = mockReqRes({
      admin: { id: 'a1' },
      headers: { 'x-org-id': 'o1' },
    })
    await requireActiveOrg(req, res, next)
    expect(req.orgId).toBe('o1')
    expect(req.orgRole).toBe('manager')
    expect(next).toHaveBeenCalledOnce()
  })

  it('falls back to the org baked into the JWT', async () => {
    pool.query.mockResolvedValue({ rows: [{ org_id: 'o9', role_key: 'owner' }] })
    const { req, res, next } = mockReqRes({ admin: { id: 'a1', orgId: 'o9' } })
    await requireActiveOrg(req, res, next)
    expect(req.orgId).toBe('o9')
    expect(next).toHaveBeenCalledOnce()
  })
})

// ====================================================
// verifyScreenOwnership
// ====================================================
describe('verifyScreenOwnership', () => {
  it('returns 400 if no screen IDs in body', async () => {
    const { req, res, next } = mockReqRes({ my_cinema_hall: { id: 'h1' } })
    await verifyScreenOwnership(req, res, next)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ message: 'Screen ID(s) are required' })
  })

  it('returns 404 if some screens not found', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 's1', cinema_hall_id: 'h1' }] })
    const { req, res, next } = mockReqRes({
      body: { screen_ids: ['s1', 's2'] },
      my_cinema_hall: { id: 'h1' },
    })
    await verifyScreenOwnership(req, res, next)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ message: 'Some screens were not found' })
  })

  it('returns 403 if screen not owned by admin', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 's1', cinema_hall_id: 'h2' }] })
    const { req, res, next } = mockReqRes({
      body: { screen_ids: ['s1'] },
      my_cinema_hall: { id: 'h1' },
    })
    await verifyScreenOwnership(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('calls next if all screens valid (single hall)', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 's1', cinema_hall_id: 'h1' }] })
    const { req, res, next } = mockReqRes({
      body: { screen_ids: ['s1'] },
      my_cinema_hall: { id: 'h1' },
    })
    await verifyScreenOwnership(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('calls next if all screens valid (currentHallId)', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 's1', cinema_hall_id: 'h1' }] })
    const { req, res, next } = mockReqRes({
      body: { screen_ids: ['s1'] },
      currentHallId: 'h1',
    })
    await verifyScreenOwnership(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })
})
