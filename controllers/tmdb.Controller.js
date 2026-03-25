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
        console.error('TMDB popular error:', error.message)
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
        console.error('TMDB now_playing error:', error.message)
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
        console.error('TMDB upcoming error:', error.message)
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
        console.error('TMDB top_rated error:', error.message)
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
        console.error('TMDB search error:', error.message)
        res.status(502).json({ message: error.message })
    }
}

// 🔹 Single movie details (includes runtime + videos/trailers)
export const getTMDBMovieDetails = async (req, res) => {
    try {
        const { tmdbId } = req.params
        const data = await tmdbFetch(`/movie/${tmdbId}`, {
            language: 'en-US',
            append_to_response: 'videos',
        })
        res.json(data)
    } catch (error) {
        console.error('TMDB movie details error:', error.message)
        res.status(502).json({ message: error.message })
    }
}
