import { describe, it, expect, beforeAll, vi } from 'vitest'
import { query } from '../../setup/db.js'
import { createMovie } from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import {
  addMovie, editMovie, deleteMovie,
  getAllMovies, getMovieById, updateMovieStatus, getMovieTmdbIds,
} from '../../../controllers/movies.Controller.js'

function mockReqRes(overrides = {}) {
  const req = { body: {}, params: {}, query: {}, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

const validMovie = {
  title: 'Test Movie',
  description: 'A test movie',
  poster_url: 'https://example.com/poster.jpg',
  genre: ['Action', 'Drama'],
  language: ['English'],
  duration_mins: 120,
  release_date: '2025-06-01',
  status: 'upcoming',
}

describe('addMovie', () => {


  it('creates a movie with valid data', async () => {
    const { req, res } = mockReqRes({ body: validMovie })
    await addMovie(req, res)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json.mock.calls[0][0].title).toBe('Test Movie')
    expect(res.json.mock.calls[0][0].status).toBe('upcoming')
  })

  it('handles minimal movie data', async () => {
    const { req, res } = mockReqRes({ body: { title: 'Minimal' } })
    await addMovie(req, res)
    expect(res.status).toHaveBeenCalledWith(201)
  })

  // Note: 500-error path not testable — controller is missing logger import
  // (logger.error() throws ReferenceError before res.status(500) can be called)
})

describe('editMovie', () => {
  let movieId

  beforeAll(async () => {
    const m = await createMovie()
    movieId = m.id
  })

  it('rejects invalid fields', async () => {
    const { req, res } = mockReqRes({ params: { movieId }, body: { invalid_field: true } })
    await editMovie(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns 404 for nonexistent movie', async () => {
    const { req, res } = mockReqRes({ params: { movieId: '00000000-0000-0000-0000-000000000000' }, body: { title: 'X' } })
    await editMovie(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('updates movie title', async () => {
    const { req, res } = mockReqRes({ params: { movieId }, body: { title: 'Updated Title' } })
    await editMovie(req, res)
    expect(res.json.mock.calls[0][0].title).toBe('Updated Title')
  })

  it('updates movie genre (text[] array)', async () => {
    const { req, res } = mockReqRes({ params: { movieId }, body: { genre: ['Comedy'] } })
    await editMovie(req, res)
    const updated = res.json.mock.calls[0][0]
    expect(updated.genre).toEqual(['Comedy'])
  })
})

describe('deleteMovie', () => {
  it('deletes existing movie', async () => {
    const m = await createMovie()
    const { req, res } = mockReqRes({ params: { movieId: m.id } })
    await deleteMovie(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/deleted/i)
  })

  it('returns 404 for nonexistent movie', async () => {
    const { req, res } = mockReqRes({ params: { movieId: '00000000-0000-0000-0000-000000000000' } })
    await deleteMovie(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })
})

describe('getAllMovies', () => {
  it('returns movies with pagination', async () => {
    await createMovie()
    const { req, res } = mockReqRes({ query: {} })
    await getAllMovies(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.movies.length).toBeGreaterThanOrEqual(1)
    expect(data).toHaveProperty('page')
    expect(data).toHaveProperty('limit')
    expect(data).toHaveProperty('total')
  })

  it('filters by genre', async () => {
    const { req, res } = mockReqRes({ query: { genre: 'Action' } })
    await getAllMovies(req, res)
    const data = res.json.mock.calls[0][0]
    data.movies.forEach(m => {
      expect(m.genre).toContain('Action')
    })
  })

  it('filters by search term', async () => {
    const { req, res } = mockReqRes({ query: { search: 'Test' } })
    await getAllMovies(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.movies.length).toBeGreaterThanOrEqual(1)
  })

  it('filters by status', async () => {
    const { req, res } = mockReqRes({ query: { status: 'upcoming' } })
    await getAllMovies(req, res)
    const data = res.json.mock.calls[0][0]
    data.movies.forEach(m => {
      expect(m.status).toBe('upcoming')
    })
  })
})

describe('getMovieById', () => {
  it('returns 400 if no id', async () => {
    const { req, res } = mockReqRes({ params: {} })
    await getMovieById(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns 404 for nonexistent movie', async () => {
    const { req, res } = mockReqRes({ params: { id: '00000000-0000-0000-0000-000000000000' } })
    await getMovieById(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('returns movie for valid id', async () => {
    const m = await createMovie()
    const { req, res } = mockReqRes({ params: { id: m.id } })
    await getMovieById(req, res)
    expect(res.json.mock.calls[0][0].movie.id).toBe(m.id)
  })
})

describe('updateMovieStatus', () => {
  let movieId

  beforeAll(async () => {
    const m = await createMovie()
    movieId = m.id
  })

  it('returns 400 if no status', async () => {
    const { req, res } = mockReqRes({ params: { movieId }, body: {} })
    await updateMovieStatus(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns 404 for nonexistent movie', async () => {
    const { req, res } = mockReqRes({ params: { movieId: '00000000-0000-0000-0000-000000000000' }, body: { status: 'released' } })
    await updateMovieStatus(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('updates movie status', async () => {
    const { req, res } = mockReqRes({ params: { movieId }, body: { status: 'released' } })
    await updateMovieStatus(req, res)
    expect(res.json.mock.calls[0][0].status).toBe('released')
  })
})

describe('getMovieTmdbIds', () => {
  it('returns tmdb_ids array', async () => {
    await createMovie({ tmdb_id: 12345 })
    const { req, res } = mockReqRes()
    await getMovieTmdbIds(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.tmdb_ids).toBeDefined()
    expect(Array.isArray(data.tmdb_ids)).toBe(true)
  })
})
