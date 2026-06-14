import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockJson = vi.fn()
const mockFetch = vi.fn()

vi.stubGlobal('fetch', mockFetch)
vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import {
  getTMDBPopular, getTMDBNowPlaying, getTMDBUpcoming,
  getTMDBTopRated, searchTMDB, getTMDBInTheatres, getTMDBMovieDetails,
} from '../../../controllers/tmdb.Controller.js'

function mockReqRes(overrides = {}) {
  const req = { query: {}, params: {}, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

function mockFetchSuccess(data) {
  mockJson.mockResolvedValue(data)
  mockFetch.mockResolvedValue({ ok: true, json: mockJson })
}

function mockFetchError(status, statusMessage) {
  mockJson.mockResolvedValue({ status_message: statusMessage })
  mockFetch.mockResolvedValue({ ok: false, status, json: mockJson })
}

beforeEach(() => {
  mockFetch.mockReset()
  mockJson.mockReset()
})

describe('getTMDBPopular', () => {
  it('returns popular movies data', async () => {
    mockFetchSuccess({ results: [{ id: 1, title: 'Popular Movie' }] })
    const { req, res } = mockReqRes()
    await getTMDBPopular(req, res)
    expect(res.json.mock.calls[0][0].results).toHaveLength(1)
    expect(res.json.mock.calls[0][0].results[0].title).toBe('Popular Movie')
  })

  it('returns 502 on TMDB error', async () => {
    mockFetchError(401, 'Invalid API key')
    const { req, res } = mockReqRes()
    await getTMDBPopular(req, res)
    expect(res.status).toHaveBeenCalledWith(502)
  })
})

describe('searchTMDB', () => {
  it('returns 400 if query missing', async () => {
    const { req, res } = mockReqRes({ query: {} })
    await searchTMDB(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns search results', async () => {
    mockFetchSuccess({ results: [{ id: 2, title: 'Search Result' }] })
    const { req, res } = mockReqRes({ query: { query: 'test' } })
    await searchTMDB(req, res)
    expect(res.json.mock.calls[0][0].results).toHaveLength(1)
  })
})

describe('getTMDBMovieDetails', () => {
  it('returns movie details with videos and credits', async () => {
    mockFetchSuccess({ id: 123, title: 'Detail Movie', videos: { results: [] }, credits: { cast: [] } })
    const { req, res } = mockReqRes({ params: { tmdbId: '123' } })
    await getTMDBMovieDetails(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.id).toBe(123)
    expect(data.videos).toBeDefined()
    expect(data.credits).toBeDefined()
  })
})

describe('remaining TMDB endpoints', () => {
  it('now-playing returns data', async () => {
    mockFetchSuccess({ results: [] })
    const { req, res } = mockReqRes()
    await getTMDBNowPlaying(req, res)
    expect(res.json).toHaveBeenCalled()
  })

  it('upcoming returns data', async () => {
    mockFetchSuccess({ results: [] })
    const { req, res } = mockReqRes()
    await getTMDBUpcoming(req, res)
    expect(res.json).toHaveBeenCalled()
  })

  it('top-rated returns data', async () => {
    mockFetchSuccess({ results: [] })
    const { req, res } = mockReqRes()
    await getTMDBTopRated(req, res)
    expect(res.json).toHaveBeenCalled()
  })

  it('in-theatres returns data', async () => {
    mockFetchSuccess({ results: [] })
    const { req, res } = mockReqRes()
    await getTMDBInTheatres(req, res)
    expect(res.json).toHaveBeenCalled()
  })

  it('handles TMDB error with 502', async () => {
    mockFetchError(500, 'Server error')
    const { req, res } = mockReqRes()
    await getTMDBNowPlaying(req, res)
    expect(res.status).toHaveBeenCalledWith(502)
  })
})
