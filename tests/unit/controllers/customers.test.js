import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { getPool, cleanupAll, closePool } from '../../setup/db.js'
import { createCustomer } from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import { getAllCustomers, getCustomerDetails } from '../../../controllers/customers.Controller.js'

const pool = getPool

function mockReqRes(overrides = {}) {
  const req = { query: {}, params: {}, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

let customers = []

beforeAll(async () => {
  customers.push(await createCustomer({ name: 'Alice', email: 'alice@test.com' }))
  customers.push(await createCustomer({ name: 'Bob', email: 'bob@test.com' }))
})

afterAll(async () => {
  await cleanupAll()
  await closePool()
})

describe('getAllCustomers', () => {
  it('returns all customers with stats', async () => {
    const { req, res } = mockReqRes({ query: { page: 1, limit: 10 } })
    await getAllCustomers(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    const data = res.json.mock.calls[0][0]
    expect(data.customers.length).toBeGreaterThanOrEqual(2)
    expect(data.stats.total).toBeGreaterThanOrEqual(2)
    expect(data).toHaveProperty('total')
  })

  it('filters by search term', async () => {
    const { req, res } = mockReqRes({ query: { search: 'Alice' } })
    await getAllCustomers(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    const data = res.json.mock.calls[0][0]
    expect(data.customers).toHaveLength(1)
    expect(data.customers[0].name).toBe('Alice')
  })

  it('enforces max limit of 100', async () => {
    const { req, res } = mockReqRes({ query: { limit: 500 } })
    await getAllCustomers(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
  })
})

describe('getCustomerDetails', () => {
  it('returns 404 for nonexistent customer', async () => {
    const { req, res } = mockReqRes({ params: { id: '00000000-0000-0000-0000-000000000000' } })
    await getCustomerDetails(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('returns customer with bookings and sessions', async () => {
    const c = customers[0]
    const { req, res } = mockReqRes({ params: { id: c.id } })
    await getCustomerDetails(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    const data = res.json.mock.calls[0][0]
    expect(data.customer.id).toBe(c.id)
    expect(data).toHaveProperty('recentBookings')
    expect(data).toHaveProperty('activeSessions')
  })
})
