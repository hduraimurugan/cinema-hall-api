import pool from '../db.js'

// 🔸 Get movies showing in a specific district and state
export const getMoviesByLocation = async (req, res) => {
    const client = await pool.connect()

    try {
        const { district, state } = req.query

        if (!district || !state) {
            return res.status(400).json({
                message: "Both district and state are required"
            })
        }

        const query = `
            SELECT DISTINCT
                m.id,
                m.title,
                m.description,
                m.poster_url,
                m.trailer_url,
                m.duration_mins,
                m.genre,
                m.language,
                m.status,
                m.release_date,
                m.created_at
            FROM movies m
            INNER JOIN shows sh ON m.id = sh.movie_id
            INNER JOIN screens sc ON sh.screen_id = sc.id
            INNER JOIN cinema_hall ch ON sc.cinema_hall_id = ch.id
            WHERE ch.district = $1
                AND ch.state = $2
                AND sh.status = 'booking_started'
                AND sh.show_date >= CURRENT_DATE
                AND m.status = 'now_showing'
            ORDER BY m.release_date DESC
        `

        const result = await client.query(query, [district, state])

        res.status(200).json({
            success: true,
            count: result.rows.length,
            district,
            state,
            movies: result.rows
        })

    } catch (error) {
        logger.error("Error fetching movies by location:", { message: error.message })
        res.status(500).json({
            success: false,
            message: "Server error while fetching movies"
        })
    } finally {
        client.release()
    }
}

// 🔸 Get movies showing in a specific state (all districts)
export const getMoviesByState = async (req, res) => {
    const client = await pool.connect()

    try {
        const { state } = req.query

        if (!state) {
            return res.status(400).json({
                message: "State is required"
            })
        }

        const query = `
            SELECT DISTINCT
                m.id,
                m.title,
                m.description,
                m.poster_url,
                m.trailer_url,
                m.duration_mins,
                m.genre,
                m.language,
                m.status,
                m.release_date,
                m.created_at
            FROM movies m
            INNER JOIN shows sh ON m.id = sh.movie_id
            INNER JOIN screens sc ON sh.screen_id = sc.id
            INNER JOIN cinema_hall ch ON sc.cinema_hall_id = ch.id
            WHERE ch.state = $1
                AND sh.status = 'booking_started'
                AND sh.show_date >= CURRENT_DATE
                AND m.status = 'now_showing'
            ORDER BY m.release_date DESC
        `

        const result = await client.query(query, [state])

        res.status(200).json({
            success: true,
            count: result.rows.length,
            state,
            movies: result.rows
        })

    } catch (error) {
        logger.error("Error fetching movies by state:", { message: error.message })
        res.status(500).json({
            success: false,
            message: "Server error while fetching movies"
        })
    } finally {
        client.release()
    }
}

// 🔸 Get movie details with cinema halls and showtimes for a location
export const getMovieDetailsWithShowtimes = async (req, res) => {
    const client = await pool.connect()

    try {
        const { movieId } = req.params
        const { district, state, date } = req.query

        if (!movieId) {
            return res.status(400).json({
                message: "Movie ID is required"
            })
        }

        if (!district || !state) {
            return res.status(400).json({
                message: "Both district and state are required"
            })
        }

        // Get movie details
        const movieQuery = `
            SELECT * FROM movies WHERE id = $1
        `
        const movieResult = await client.query(movieQuery, [movieId])

        if (movieResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Movie not found"
            })
        }

        // Get cinema halls and shows for this movie in the location
        const showDate = date || new Date().toISOString().split('T')[0]

        const showsQuery = `
            SELECT
                ch.id as cinema_hall_id,
                ch.name as cinema_hall_name,
                ch.location as cinema_hall_location,
                ch.district,
                ch.state,
                sc.id as screen_id,
                sc.name as screen_name,
                sc.premium_price,
                sc.gold_price,
                sc.silver_price,
                sh.id as show_id,
                sh.show_date,
                sh.start_time,
                sh.end_time,
                sh.language_version,
                sh.status as show_status
            FROM shows sh
            INNER JOIN screens sc ON sh.screen_id = sc.id
            INNER JOIN cinema_hall ch ON sc.cinema_hall_id = ch.id
            WHERE sh.movie_id = $1
                AND ch.district = $2
                AND ch.state = $3
                AND sh.status = 'booking_started'
                AND sh.show_date = $4
            ORDER BY ch.name, sh.start_time
        `

        const showsResult = await client.query(showsQuery, [movieId, district, state, showDate])

        // Group shows by cinema hall
        const cinemaHalls = {}

        showsResult.rows.forEach(row => {
            if (!cinemaHalls[row.cinema_hall_id]) {
                cinemaHalls[row.cinema_hall_id] = {
                    cinema_hall_id: row.cinema_hall_id,
                    cinema_hall_name: row.cinema_hall_name,
                    cinema_hall_location: row.cinema_hall_location,
                    district: row.district,
                    state: row.state,
                    shows: []
                }
            }

            cinemaHalls[row.cinema_hall_id].shows.push({
                show_id: row.show_id,
                screen_id: row.screen_id,
                screen_name: row.screen_name,
                show_date: row.show_date,
                start_time: row.start_time,
                end_time: row.end_time,
                language_version: row.language_version,
                show_status: row.show_status,
                pricing: {
                    premium: row.premium_price,
                    gold: row.gold_price,
                    silver: row.silver_price
                }
            })
        })

        res.status(200).json({
            success: true,
            movie: movieResult.rows[0],
            cinema_halls: Object.values(cinemaHalls)
        })

    } catch (error) {
        logger.error("Error fetching movie details with showtimes:", { message: error.message })
        res.status(500).json({
            success: false,
            message: "Server error while fetching movie details"
        })
    } finally {
        client.release()
    }
}

// 🔸 Get all available districts in a state where movies are showing
export const getDistrictsInState = async (req, res) => {
    const client = await pool.connect()

    try {
        const { state } = req.query

        if (!state) {
            return res.status(400).json({
                message: "State is required"
            })
        }

        const query = `
            SELECT DISTINCT ch.district
            FROM cinema_hall ch
            INNER JOIN screens sc ON ch.id = sc.cinema_hall_id
            INNER JOIN shows sh ON sc.id = sh.screen_id
            WHERE ch.state = $1
                AND sh.status = 'booking_started'
                AND sh.show_date >= CURRENT_DATE
            ORDER BY ch.district
        `

        const result = await client.query(query, [state])

        res.status(200).json({
            success: true,
            state,
            districts: result.rows.map(row => row.district)
        })

    } catch (error) {
        logger.error("Error fetching districts:", { message: error.message })
        res.status(500).json({
            success: false,
            message: "Server error while fetching districts"
        })
    } finally {
        client.release()
    }
}

// 🔸 Get all cinema halls in a location
export const getCinemaHallsByLocation = async (req, res) => {
    const client = await pool.connect()

    try {
        const { district, state } = req.query

        if (!district || !state) {
            return res.status(400).json({
                message: "Both district and state are required"
            })
        }

        const query = `
            SELECT DISTINCT
                ch.id,
                ch.name,
                ch.location,
                ch.district,
                ch.state
            FROM cinema_hall ch
            INNER JOIN screens sc ON ch.id = sc.cinema_hall_id
            INNER JOIN shows sh ON sc.id = sh.screen_id
            WHERE ch.district = $1
                AND ch.state = $2
                AND sh.status = 'booking_started'
                AND sh.show_date >= CURRENT_DATE
            ORDER BY ch.name
        `

        const result = await client.query(query, [district, state])

        res.status(200).json({
            success: true,
            count: result.rows.length,
            district,
            state,
            cinema_halls: result.rows
        })

    } catch (error) {
        logger.error("Error fetching cinema halls:", { message: error.message })
        res.status(500).json({
            success: false,
            message: "Server error while fetching cinema halls"
        })
    } finally {
        client.release()
    }
}

// 🔸 Get all movies (for browsing without location filter)
export const getAllMovies = async (req, res) => {
    const client = await pool.connect()

    try {
        let {
            page = 1,
            limit = 10,
            genre,
            language,
            status,
            search
        } = req.query

        // Handle genre and language arrays
        genre = Array.isArray(genre) ? genre : genre ? [genre] : []
        language = Array.isArray(language) ? language : language ? [language] : []

        genre = genre.filter(g => g && g.trim() !== '')
        language = language.filter(l => l && l.trim() !== '')

        const offset = (page - 1) * limit

        const filters = []
        const values = []

        if (genre.length > 0) {
            values.push(genre)
            filters.push(`genre && $${values.length}::text[]`)
        }

        if (language.length > 0) {
            values.push(language)
            filters.push(`language && $${values.length}::text[]`)
        }

        if (status) {
            values.push(status)
            filters.push(`status = $${values.length}`)
        }

        if (search) {
            values.push(`%${search}%`)
            filters.push(`(
                LOWER(title) ILIKE LOWER($${values.length})
                OR LOWER(description) ILIKE LOWER($${values.length})
            )`)
        }

        const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""

        const query = `
            SELECT *
            FROM movies
            ${whereClause}
            ORDER BY release_date DESC
            LIMIT $${values.length + 1} OFFSET $${values.length + 2}
        `

        values.push(limit)
        values.push(offset)

        const result = await client.query(query, values)

        res.status(200).json({
            success: true,
            movies: result.rows,
            page: Number(page),
            limit: Number(limit),
            count: result.rows.length
        })
    } catch (error) {
        logger.error("Error fetching movies:", { message: error.message })
        res.status(500).json({
            success: false,
            message: "Server error while fetching movies"
        })
    } finally {
        client.release()
    }
}

// 🔸 Get cinema halls with movies and shows for a location and date
export const getCinemaHallsWithShows = async (req, res) => {
    const client = await pool.connect()

    try {
        const { district, state, date } = req.query

        if (!district || !state) {
            return res.status(400).json({
                message: "Both district and state are required"
            })
        }

        const showDate = date || new Date().toISOString().split('T')[0]

        const query = `
            SELECT
                ch.id AS hall_id, ch.name AS hall_name, ch.location, ch.district, ch.state, ch.latitude, ch.longitude,
                m.id AS movie_id, m.title, m.poster_url, m.duration_mins, m.genre, m.language,
                sc.id AS screen_id, sc.name AS screen_name,
                sc.premium_price, sc.gold_price, sc.silver_price,
                sh.id AS show_id, sh.start_time, sh.end_time,
                sh.language_version, sh.show_date
            FROM cinema_hall ch
            INNER JOIN screens sc ON ch.id = sc.cinema_hall_id
            INNER JOIN shows sh ON sc.id = sh.screen_id
            INNER JOIN movies m ON sh.movie_id = m.id
            WHERE ch.district = $1
                AND ch.state = $2
                AND sh.show_date = $3
                AND sh.status = 'booking_started'
                AND m.status = 'now_showing'
            ORDER BY ch.name, m.title, sh.start_time
        `

        const result = await client.query(query, [district, state, showDate])

        // Group by hall → movie → shows
        const hallsMap = {}

        result.rows.forEach(row => {
            if (!hallsMap[row.hall_id]) {
                hallsMap[row.hall_id] = {
                    hall_id: row.hall_id,
                    hall_name: row.hall_name,
                    location: row.location,
                    district: row.district,
                    state: row.state,
                    latitude: row.latitude ? parseFloat(row.latitude) : null,
                    longitude: row.longitude ? parseFloat(row.longitude) : null,
                    movies: {}
                }
            }

            const hall = hallsMap[row.hall_id]

            if (!hall.movies[row.movie_id]) {
                hall.movies[row.movie_id] = {
                    movie_id: row.movie_id,
                    title: row.title,
                    poster_url: row.poster_url,
                    duration_mins: row.duration_mins,
                    genre: row.genre,
                    language: row.language,
                    shows: []
                }
            }

            hall.movies[row.movie_id].shows.push({
                show_id: row.show_id,
                screen_id: row.screen_id,
                screen_name: row.screen_name,
                start_time: row.start_time,
                end_time: row.end_time,
                show_date: row.show_date,
                language_version: row.language_version,
                pricing: {
                    premium: row.premium_price,
                    gold: row.gold_price,
                    silver: row.silver_price
                }
            })
        })

        const cinema_halls = Object.values(hallsMap).map(hall => ({
            ...hall,
            movies: Object.values(hall.movies)
        }))

        res.status(200).json({
            success: true,
            count: cinema_halls.length,
            district,
            state,
            date: showDate,
            cinema_halls
        })

    } catch (error) {
        logger.error("Error fetching cinema halls with shows:", { message: error.message })
        res.status(500).json({
            success: false,
            message: "Server error while fetching theatres"
        })
    } finally {
        client.release()
    }
}

// 🔸 Get single movie detail by ID
export const getMovieById = async (req, res) => {
    const client = await pool.connect()

    try {
        const { id } = req.params

        if (!id) {
            return res.status(400).json({
                message: "Movie ID is required"
            })
        }

        const query = `
            SELECT *
            FROM movies
            WHERE id = $1
        `

        const result = await client.query(query, [id])

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Movie not found"
            })
        }

        res.status(200).json({
            success: true,
            movie: result.rows[0]
        })

    } catch (error) {
        logger.error("Error fetching movie by ID:", { message: error.message })
        res.status(500).json({
            success: false,
            message: "Server error while fetching movie details"
        })
    } finally {
        client.release()
    }
}
