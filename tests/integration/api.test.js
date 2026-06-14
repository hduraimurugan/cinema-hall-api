import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import { getPool } from '../setup/db.js'
import { createAdmin, createHall, createScreen, createMovie } from '../setup/factories.js'

vi.mock('../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))

vi.mock('razorpay', () => {
  function MockRazorpay() {
    return {
      orders: { create() { return Promise.resolve({ id: 'order_test', amount: 50000, currency: 'INR' }) } },
      payments: { refund() { return Promise.resolve({ id: 'rfp_test' }) } },
    }
  }
  return { default: MockRazorpay }
})

let currentAdminId = null
let currentHallId = null

vi.mock('../../middleware/verifyCinemaAdmin.js', () => ({
  verifyCinemaAdminAccessToken: (req, res, next) => {
    req.admin = { id: currentAdminId || '00000000-0000-0000-0000-000000000000', role: 'admin' }
    next()
  },
  verifyCinemaAdminRefreshToken: (req, res, next) => {
    req.admin = { id: currentAdminId || '00000000-0000-0000-0000-000000000000' }
    next()
  },
  verifySuperAdmin: (req, res, next) => {
    req.admin.role = 'superAdmin'
    next()
  },
  verifyCustomer: (req, res, next) => {
    req.customer = { id: '00000000-0000-0000-0000-000000000000' }
    next()
  },
  verifyCustomerRefreshToken: (req, res, next) => {
    req.customer = { id: '00000000-0000-0000-0000-000000000000' }
    next()
  },
  requireActiveHall: (req, res, next) => {
    req.currentHallId = currentHallId || '00000000-0000-0000-0000-000000000000'
    next()
  },
  verifyCinemaHall: (req, res, next) => next(),
  verifyScreenOwnership: (req, res, next) => next(),
}))

import app from '../../server.js'

let pool

beforeAll(async () => {
  pool = getPool()
  const admin = await createAdmin()
  currentAdminId = admin.id
  const hall = await createHall(admin.id, { name: 'Integration Test Hall' })
  currentHallId = hall.id
})

afterEach(async () => {
  await pool.query('DELETE FROM cinema_hall WHERE name = $1', ['Integration Test Hall'])
})

describe('Public Routes', () => {
  it('GET /ping returns pong', async () => {
    const res = await request(app).get('/ping')
    expect(res.status).toBe(200)
    expect(res.text).toBe('pong')
  })

  it('GET / returns API info', async () => {
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('postgres')
    expect(res.body).toHaveProperty('server')
  })

  it('GET /nonexistent returns 404', async () => {
    const res = await request(app).get('/nonexistent-route')
    expect(res.status).toBe(404)
  })
})

describe('Protected Routes (mocked auth)', () => {
  it('GET /api/halls returns halls for admin', async () => {
    currentAdminId = null
    const admin = await createAdmin()
    currentAdminId = admin.id
    await createHall(admin.id, { name: 'Hall A' })
    await createHall(admin.id, { name: 'Hall B' })

    const res = await request(app).get('/api/halls')
    expect(res.status).toBe(200)
    expect(res.body.halls.length).toBeGreaterThanOrEqual(2)

    await pool.query('DELETE FROM cinema_hall WHERE admin_id = $1', [admin.id])
    const orig = await createAdmin()
    currentAdminId = orig.id
    await createHall(orig.id, { name: 'Integration Test Hall' })
  })

  it('GET /api/auth/me returns admin profile', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('admin')
  })

  it('GET /api/settings returns pricing settings', async () => {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('convenience_fee_per_ticket', '20')
       ON CONFLICT (key) DO UPDATE SET value = '20'`
    )
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('gst_percentage', '12')
       ON CONFLICT (key) DO UPDATE SET value = '12'`
    )
    const res = await request(app).get('/api/settings')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('convenience_fee_per_ticket')
    expect(res.body).toHaveProperty('gst_percentage')
  })
})

describe('Error Handling', () => {
  it('returns 500 on unhandled error in route', async () => {
    const res = await request(app).get('/debug-sentry')
    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/something went wrong/i)
  })
})
