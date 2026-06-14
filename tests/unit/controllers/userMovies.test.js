import { describe, it, expect, beforeAll, vi } from 'vitest'
import { getPool } from '../../setup/db.js'
import { createAdmin, createHall, createScreen, createMovie, createShow } from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import {
  getAllMovies, getMovieById,
  getMoviesByLocation, getMoviesByState,
  getDistrictsInState, getCinemaHallsByLocation,
  getMovieDetailsWithShowtimes, getCinemaHallsWithShows,
} from '../../../controllers/userMovies.Controller.js'

function mockReqRes(overrides = {}) {
  const req = { query: {}, params: {}, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

let hall, screen, movie, show

beforeAll(async () => {
  const admin = await createAdmin()
  hall = await createHall(admin.id, { name: 'UserMovie Hall', location: 'TestCity', district: 'TestDistrict', state: 'TestState' })
  screen = await createScreen(hall.id)
  movie = await createMovie({ status: 'now_showing' })
  show = await createShow(screen.id, movie.id, { status: 'booking_started' })
})

describe('getAllMovies', () => {
  it('returns movies with filters and pagination', async () => {
    const { req, res } = mockReqRes({ query: {} })
    await getAllMovies(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.movies.length).toBeGreaterThanOrEqual(1)
    expect(data).toHaveProperty('page')
    expect(data).toHaveProperty('limit')
    expect(data).toHaveProperty('count')
  })

  it('filters by genre', async () => {
    const { req, res } = mockReqRes({ query: { genre: 'Action' } })
    await getAllMovies(req, res)
    const data = res.json.mock.calls[0][0]
    data.movies.forEach(m => {
      expect(m.genre).toContain('Action')
    })
  })
})

describe('getMovieById', () => {
  it('returns 400 if no id', async () => {
    const { req, res } = mockReqRes({ params: {} })
    await getMovieById(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns movie for valid id', async () => {
    const { req, res } = mockReqRes({ params: { id: movie.id } })
    await getMovieById(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.movie.id).toBe(movie.id)
    expect(data.success).toBe(true)
  })
})

describe('getMoviesByLocation', () => {
  it('returns 400 if district or state missing', async () => {
    const { req, res } = mockReqRes({ query: {} })
    await getMoviesByLocation(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns movies for location', async () => {
    const { req, res } = mockReqRes({ query: { district: 'TestDistrict', state: 'TestState' } })
    await getMoviesByLocation(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.success).toBe(true)
    expect(data.count).toBeGreaterThanOrEqual(1)
  })

  it('returns empty for unknown location', async () => {
    const { req, res } = mockReqRes({ query: { district: 'Nowhere', state: 'Nowhere' } })
    await getMoviesByLocation(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.count).toBe(0)
  })
})

describe('getMoviesByState', () => {
  it('returns 400 if state missing', async () => {
    const { req, res } = mockReqRes({ query: {} })
    await getMoviesByState(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns movies for state', async () => {
    const { req, res } = mockReqRes({ query: { state: 'TestState' } })
    await getMoviesByState(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.success).toBe(true)
    expect(data.count).toBeGreaterThanOrEqual(1)
  })
})

describe('getDistrictsInState', () => {
  it('returns 400 if state missing', async () => {
    const { req, res } = mockReqRes({ query: {} })
    await getDistrictsInState(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns districts for state', async () => {
    const { req, res } = mockReqRes({ query: { state: 'TestState' } })
    await getDistrictsInState(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.success).toBe(true)
    expect(data.districts.length).toBeGreaterThanOrEqual(1)
  })
})

describe('getCinemaHallsByLocation', () => {
  it('returns 400 if district or state missing', async () => {
    const { req, res } = mockReqRes({ query: {} })
    await getCinemaHallsByLocation(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns halls for location', async () => {
    const { req, res } = mockReqRes({ query: { district: 'TestDistrict', state: 'TestState' } })
    await getCinemaHallsByLocation(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.success).toBe(true)
    expect(data.cinema_halls.length).toBeGreaterThanOrEqual(1)
  })
})

describe('getMovieDetailsWithShowtimes', () => {
  it('returns 400 if movieId missing', async () => {
    const { req, res } = mockReqRes({ params: {}, query: { district: 'TestDistrict', state: 'TestState' } })
    await getMovieDetailsWithShowtimes(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns 400 if location params missing', async () => {
    const { req, res } = mockReqRes({ params: { movieId: movie.id }, query: {} })
    await getMovieDetailsWithShowtimes(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns movie with showtimes for location', async () => {
    const d = new Date(show.show_date)
    const dateStr = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
    const { req, res } = mockReqRes({ params: { movieId: movie.id }, query: { district: 'TestDistrict', state: 'TestState', date: dateStr } })
    await getMovieDetailsWithShowtimes(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.success).toBe(true)
    expect(data.movie.id).toBe(movie.id)
    expect(data.cinema_halls.length).toBeGreaterThanOrEqual(1)
  })
})

describe('getCinemaHallsWithShows', () => {
  it('returns 400 if location params missing', async () => {
    const { req, res } = mockReqRes({ query: {} })
    await getCinemaHallsWithShows(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns halls with movies and shows for location', async () => {
    const d = new Date(show.show_date)
    const dateStr = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
    const { req, res } = mockReqRes({ query: { district: 'TestDistrict', state: 'TestState', date: dateStr } })
    await getCinemaHallsWithShows(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.success).toBe(true)
    expect(data.cinema_halls.length).toBeGreaterThanOrEqual(1)
    expect(data.cinema_halls[0]).toHaveProperty('movies')
  })
})
