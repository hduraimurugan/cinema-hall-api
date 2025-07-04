import pool from '../db.js'

// 🔸 Add a new movie (SuperAdmin only)
export const addMovie = async (req, res) => {
    const {
        title,
        description,
        poster_url,
        trailer_url,
        duration_mins,
        genre = [], // must be an array
        language = [], // must be an array
        release_date,
        status = 'upcoming' // default status
    } = req.body

    const client = await pool.connect()

    try {
        const insertQuery = `
      INSERT INTO movies (
        title,
        description,
        poster_url,
        trailer_url,
        duration_mins,
        genre,
        language,
        release_date,
        status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `
        const values = [
            title,
            description,
            poster_url,
            trailer_url,
            duration_mins,
            genre,
            language,
            release_date,
            status
        ]

        const result = await client.query(insertQuery, values)
        res.status(201).json(result.rows[0])
    } catch (error) {
        console.error('Error adding movie:', error.message)
        res.status(500).json({ message: 'Server error while adding movie' })
    } finally {
        client.release()
    }
}

// 🔸 Edit an existing movie (SuperAdmin only)
export const editMovie = async (req, res) => {
    const { movieId } = req.params
    const updateFields = req.body

    const allowedFields = [
        'title',
        'description',
        'poster_url',
        'trailer_url',
        'duration_mins',
        'genre',
        'language',
        'release_date',
        'status'
    ]

    const fieldsToUpdate = Object.keys(updateFields).filter(field =>
        allowedFields.includes(field)
    )

    if (fieldsToUpdate.length === 0) {
        return res.status(400).json({ message: 'No valid fields to update' })
    }

    const client = await pool.connect()

    try {
        let queryStr = 'UPDATE movies SET '
        const values = []

        fieldsToUpdate.forEach((field, i) => {
            queryStr += `${field} = $${i + 1}, `
            values.push(updateFields[field])
        })

        queryStr = queryStr.slice(0, -2)
        queryStr += ' WHERE id = $' + (values.length + 1) + ' RETURNING *'
        values.push(movieId)

        const result = await client.query(queryStr, values)

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Movie not found' })
        }

        res.json(result.rows[0])
    } catch (error) {
        console.error('Error editing movie:', error.message)
        res.status(500).json({ message: 'Server error while editing movie' })
    } finally {
        client.release()
    }
}

// 🔸 Delete a movie (SuperAdmin only)
export const deleteMovie = async (req, res) => {
    const { movieId } = req.params
    const client = await pool.connect()

    try {
        const deleteQuery = 'DELETE FROM movies WHERE id = $1 RETURNING *'
        const result = await client.query(deleteQuery, [movieId])

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Movie not found' })
        }

        res.json({ message: 'Movie deleted successfully', movie: result.rows[0] })
    } catch (error) {
        console.error('Error deleting movie:', error.message)
        res.status(500).json({ message: 'Server error while deleting movie' })
    } finally {
        client.release()
    }
}

// 🔸 Get all movies with filters and pagination (SuperAdmin only)
export const getAllMovies = async (req, res) => {
    const client = await pool.connect()

    try {
        let {
            page = 1,
            limit = 10,
            genre,
            language,
            status,
            release_date,
        } = req.query

        // Make sure genre & language are arrays
        genre = Array.isArray(genre) ? genre : genre ? [genre] : []
        language = Array.isArray(language) ? language : language ? [language] : []


        const offset = (page - 1) * limit

        const filters = []
        const values = []

        // Handle genre[] -> uses && for array overlap in Postgres
        if (genre.length > 0) {
            values.push(genre)
            filters.push(`genre && $${values.length}::text[]`)
        }

        // Handle language[]
        if (language.length > 0) {
            values.push(language)
            filters.push(`language && $${values.length}::text[]`)
        }

        // status
        if (status) {
            values.push(status)
            filters.push(`status = $${values.length}`)
        }

        // release date
        if (release_date) {
            values.push(release_date)
            filters.push(`release_date = $${values.length}`)
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

        res.json({
            movies: result.rows,
            page: Number(page),
            limit: Number(limit),
            total: result.rows.length,
        })
    } catch (error) {
        console.error("Error fetching movies:", error.message)
        res.status(500).json({ message: "Server error while fetching movies" })
    } finally {
        client.release()
    }
}

// 🔹 Get single movie detail by ID
export const getMovieById = async (req, res) => {
    const client = await pool.connect();

    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ message: "Movie ID is required" });
        }

        const query = `
            SELECT *
            FROM movies
            WHERE id = $1
        `;

        const result = await client.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Movie not found" });
        }

        res.status(200).json({
            movie: result.rows[0]
        });

    } catch (error) {
        console.error("Error fetching movie by ID:", error.message);
        res.status(500).json({ message: "Server error while fetching movie details" });
    } finally {
        client.release();
    }
}


// 🔸 Update movie status (SuperAdmin only)
export const updateMovieStatus = async (req, res) => {
    const { movieId } = req.params
    const { status } = req.body

    if (!status) {
        return res.status(400).json({ message: 'Status is required' })
    }

    const client = await pool.connect()

    try {
        const updateQuery = `
      UPDATE movies SET status = $1 WHERE id = $2 RETURNING *
    `
        const result = await client.query(updateQuery, [status, movieId])

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Movie not found' })
        }

        res.json(result.rows[0])
    } catch (error) {
        console.error('Error updating status:', error.message)
        res.status(500).json({ message: 'Server error while updating status' })
    } finally {
        client.release()
    }
}
