import { describe, it, expect, beforeAll, vi } from 'vitest'
import { getPool } from '../../setup/db.js'
import { createAdmin, createHall, createScreen, createMovie, createShow, createCustomer, createBooking } from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import { getDashboardStats } from '../../../controllers/dashboard.Controller.js'

function mockReqRes(overrides = {}) {
  const req = { currentHallId: null, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

let hall, screen, movie, show, customer, booking

beforeAll(async () => {
  const admin = await createAdmin()
  hall = await createHall(admin.id, { name: 'Dashboard Hall' })
  screen = await createScreen(hall.id)
  movie = await createMovie()
  show = await createShow(screen.id, movie.id, { price: 250 })
  customer = await createCustomer()
  booking = await createBooking(customer.id, show.id, { total_amount: 250, status: 'confirmed' })
})

describe('getDashboardStats', () => {
  it('returns dashboard stats structure', async () => {
    const { req, res } = mockReqRes({ currentHallId: hall.id })
    await getDashboardStats(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data).toHaveProperty('today')
    expect(data).toHaveProperty('allTime')
    expect(data).toHaveProperty('customers')
    expect(data).toHaveProperty('activeOffers')
    expect(data).toHaveProperty('screens')
    expect(data).toHaveProperty('revenueTrend')
    expect(data).toHaveProperty('recentBookings')
    expect(data).toHaveProperty('todayShows')
  })

  it('today stats include bookings and revenue', async () => {
    const { req, res } = mockReqRes({ currentHallId: hall.id })
    await getDashboardStats(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.today).toHaveProperty('bookings')
    expect(data.today).toHaveProperty('revenue')
    expect(data.today).toHaveProperty('convenience_fee')
    expect(data.today).toHaveProperty('gst')
  })

  it('allTime stats include total bookings and revenue', async () => {
    const { req, res } = mockReqRes({ currentHallId: hall.id })
    await getDashboardStats(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.allTime).toHaveProperty('bookings')
    expect(data.allTime).toHaveProperty('revenue')
  })

  it('returns 7-day revenue trend', async () => {
    const { req, res } = mockReqRes({ currentHallId: hall.id })
    await getDashboardStats(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.revenueTrend.length).toBe(7)
    data.revenueTrend.forEach(day => {
      expect(day).toHaveProperty('date')
      expect(day).toHaveProperty('revenue')
      expect(day).toHaveProperty('bookings_count')
    })
  })

  it('screens count matches expected', async () => {
    const { req, res } = mockReqRes({ currentHallId: hall.id })
    await getDashboardStats(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.screens).toBeGreaterThanOrEqual(1)
  })

  it('recentBookings returns array', async () => {
    const { req, res } = mockReqRes({ currentHallId: hall.id })
    await getDashboardStats(req, res)
    const data = res.json.mock.calls[0][0]
    expect(Array.isArray(data.recentBookings)).toBe(true)
  })

  it('todayShows returns array', async () => {
    const { req, res } = mockReqRes({ currentHallId: hall.id })
    await getDashboardStats(req, res)
    const data = res.json.mock.calls[0][0]
    expect(Array.isArray(data.todayShows)).toBe(true)
  })
})
