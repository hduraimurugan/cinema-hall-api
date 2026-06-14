import pool from '../db.js'
import logger from '../utils/logger.js'

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
        status = 'upcoming', // default status
        tmdb_id = null,
        cast = [],
        vote_average = null,
        vote_count = null,
        backdrop_path = null
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
        status,
        tmdb_id,
        "cast",
        vote_average,
        vote_count,
        backdrop_path
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
            status,
            tmdb_id,
            JSON.stringify(cast),
            vote_average,
            vote_count,
            backdrop_path
        ]

        const result = await client.query(insertQuery, values)
        res.status(201).json(result.rows[0])
    } catch (error) {
        logger.error('Error adding movie:', { message: error.message })
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
        'status',
        'tmdb_id',
        'cast',
        'vote_average',
        'vote_count',
        'backdrop_path'
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
            const col = field === 'cast' ? '"cast"' : field
            queryStr += `${col} = $${i + 1}, `
            values.push(field === 'cast' ? JSON.stringify(updateFields[field]) : updateFields[field])
        })

        queryStr = queryStr.slice(0, -2)
        queryStr += ' WHERE id = $' + (values.length + 1) + ' RETURNING *'
        values.push(movieId)

        const result = await client.query(queryStr, values)

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Movie not found' })
        }

        res.status(200).json(result.rows[0])
    } catch (error) {
        logger.error('Error editing movie:', { message: error.message })
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

        res.status(200).json({ message: 'Movie deleted successfully', movie: result.rows[0] })
    } catch (error) {
        logger.error('Error deleting movie:', { message: error.message })
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
            search
        } = req.query

        // Make sure genre & language are arrays
        // Handles: ?genre=Action, ?genre=Action&genre=Drama, or ?genre[]=Action&genre[]=Drama
        genre = Array.isArray(genre) ? genre : genre ? [genre] : []
        language = Array.isArray(language) ? language : language ? [language] : []

        // Filter out empty strings
        genre = genre.filter(g => g && g.trim() !== '')
        language = language.filter(l => l && l.trim() !== '')


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

        // 🔍 Search filter
        if (search) {
            values.push(`%${search}%`);
            filters.push(`(
                LOWER(title) ILIKE LOWER($${values.length})
                OR LOWER(description) ILIKE LOWER($${values.length})
            )`);
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
            movies: result.rows,
            page: Number(page),
            limit: Number(limit),
            total: result.rows.length,
        })
    } catch (error) {
        logger.error("Error fetching movies:", { message: error.message })
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
        logger.error("Error fetching movie by ID:", { message: error.message });
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

        res.status(200).json(result.rows[0])
    } catch (error) {
        logger.error('Error updating status:', { message: error.message })
        res.status(500).json({ message: 'Server error while updating status' })
    } finally {
        client.release()
    }
}

// 🔹 Get all TMDB IDs of movies already in the DB (for duplicate detection)
export const getMovieTmdbIds = async (req, res) => {
    const client = await pool.connect()
    try {
        const result = await client.query(
            'SELECT tmdb_id FROM movies WHERE tmdb_id IS NOT NULL'
        )
        res.status(200).json({ tmdb_ids: result.rows.map(r => r.tmdb_id) })
    } catch (error) {
        logger.error('Error fetching tmdb ids:', { message: error.message })
        res.status(500).json({ message: 'Server error while fetching tmdb ids' })
    } finally {
        client.release()
    }
}

// 🔸 Run schema and backdrop_path backfill migration (For Serverless / Vercel deploy environments)
export const runBackdropMigration = async (req, res) => {
    const client = await pool.connect()
    try {
        // Run ALTER TABLE column check first to make sure it's there
        await client.query(`
          ALTER TABLE movies 
          ADD COLUMN IF NOT EXISTS backdrop_path TEXT;
        `);
        logger.info(`✅ Database schema check: backdrop_path column verified`);

        // Fetch movies with tmdb_id that don't have backdrop_path yet
        const { rows: moviesToUpdate } = await client.query(`
          SELECT id, tmdb_id, title 
          FROM movies 
          WHERE tmdb_id IS NOT NULL 
            AND (backdrop_path IS NULL OR backdrop_path = '');
        `);

        let updatedCount = 0;
        const skipped = [];
        const failed = [];

        if (moviesToUpdate.length > 0) {
            for (const movie of moviesToUpdate) {
                try {
                    const tmdbId = movie.tmdb_id;
                    const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}`;
                    const tmdbRes = await fetch(tmdbUrl, {
                        headers: {
                            Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
                            Accept: 'application/json',
                        },
                    });
                    if (tmdbRes.ok) {
                        const details = await tmdbRes.json();
                        if (details.backdrop_path) {
                            const backdropUrl = `https://image.tmdb.org/t/p/original${details.backdrop_path}`;
                            await client.query(
                                `UPDATE movies SET backdrop_path = $1 WHERE id = $2`,
                                [backdropUrl, movie.id]
                            );
                            updatedCount++;
                            logger.info(`✅ Updated backdrop_path for movie: "${movie.title}"`);
                        } else {
                            skipped.push(movie.title);
                            logger.warn(`⚠️ No backdrop_path found on TMDB for movie: "${movie.title}"`);
                        }
                    } else {
                        failed.push({ title: movie.title, status: tmdbRes.status });
                        logger.error(`❌ Failed to fetch TMDB details for "${movie.title}" (ID: ${tmdbId}): Status ${tmdbRes.status}`);
                    }
                } catch (err) {
                    failed.push({ title: movie.title, error: err.message });
                    logger.error(`❌ Error updating backdrop for "${movie.title}":`, { message: err.message });
                }
            }
        }

        res.status(200).json({
            success: true,
            message: `Migration run successfully. Updated: ${updatedCount}, Skipped: ${skipped.length}, Failed: ${failed.length}`,
            skipped,
            failed
        });
    } catch (error) {
        logger.error('Error running backdrop migration API:', { message: error.message })
        res.status(500).json({ success: false, message: 'Server error during migration' })
    } finally {
        client.release()
    }
}

