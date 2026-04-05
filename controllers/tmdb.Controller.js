import logger from '../utils/logger.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'

const tmdbFetch = async (path, params = {}) => {
    const url = new URL(`${TMDB_BASE_URL}${path}`)
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.append(k, v)
    })
    const response = await fetch(url.toString(), {
        headers: {
            Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
            Accept: 'application/json',
        },
    })
    if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.status_message || `TMDB error ${response.status}`)
    }
    return response.json()
}

// 🔹 Popular movies
export const getTMDBPopular = async (req, res) => {
    try {
        const { page = 1, with_original_language } = req.query
        const data = await tmdbFetch('/movie/popular', { language: 'en-US', page, with_original_language })
        res.json(data)
    } catch (error) {
        logger.error('TMDB popular error:', { message: error.message })
        res.status(502).json({ message: error.message })
    }
}

// 🔹 Now playing
export const getTMDBNowPlaying = async (req, res) => {
    try {
        const { page = 1, with_original_language } = req.query
        const data = await tmdbFetch('/movie/now_playing', { language: 'en-US', page, with_original_language })
        res.json(data)
    } catch (error) {
        logger.error('TMDB now_playing error:', { message: error.message })
        res.status(502).json({ message: error.message })
    }
}

// 🔹 Upcoming
export const getTMDBUpcoming = async (req, res) => {
    try {
        const { page = 1, with_original_language } = req.query
        const data = await tmdbFetch('/movie/upcoming', { language: 'en-US', page, with_original_language })
        res.json(data)
    } catch (error) {
        logger.error('TMDB upcoming error:', { message: error.message })
        res.status(502).json({ message: error.message })
    }
}

// 🔹 Top rated
export const getTMDBTopRated = async (req, res) => {
    try {
        const { page = 1, with_original_language } = req.query
        const data = await tmdbFetch('/movie/top_rated', { language: 'en-US', page, with_original_language })
        res.json(data)
    } catch (error) {
        logger.error('TMDB top_rated error:', { message: error.message })
        res.status(502).json({ message: error.message })
    }
}

// 🔹 Search movies
export const searchTMDB = async (req, res) => {
    try {
        const { query, page = 1, with_original_language } = req.query
        if (!query || !query.trim()) {
            return res.status(400).json({ message: 'Search query is required' })
        }
        const data = await tmdbFetch('/search/movie', { language: 'en-US', query, page, with_original_language })
        res.json(data)
    } catch (error) {
        logger.error('TMDB search error:', { message: error.message })
        res.status(502).json({ message: error.message })
    }
}

// 🔹 In Theatres — discover movies with theatrical release window (past 30 days → today)
export const getTMDBInTheatres = async (req, res) => {
    try {
        const { page = 1, with_original_language } = req.query
        const today = new Date().toISOString().slice(0, 10)
        const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const data = await tmdbFetch('/discover/movie', {
            language: 'en-US',
            sort_by: 'popularity.desc',
            'primary_release_date.gte': from,
            'primary_release_date.lte': today,
            with_release_type: '2|3',
            page,
            with_original_language,
        })
        res.json(data)
    } catch (error) {
        logger.error('TMDB in-theatres error:', { message: error.message })
        res.status(502).json({ message: error.message })
    }
}

// 🔹 Single movie details (includes runtime, videos/trailers, and cast)
export const getTMDBMovieDetails = async (req, res) => {
    try {
        const { tmdbId } = req.params
        const data = await tmdbFetch(`/movie/${tmdbId}`, {
            language: 'en-US',
            append_to_response: 'videos,credits',
        })
        res.json(data)
    } catch (error) {
        logger.error('TMDB movie details error:', { message: error.message })
        res.status(502).json({ message: error.message })
    }
}
