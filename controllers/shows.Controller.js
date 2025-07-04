import db from "../db.js"; // assumes you have a db instance (like pg-promise or pg-pool)

// 1. ✅ Create Single Show
export const createShow = async (req, res) => {
  const {
    movie_id,
    screen_id,
    show_date,
    start_time,
    end_time,
    language_version = "Original",
    price_override = null,
  } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO shows (movie_id, screen_id, show_date, start_time, end_time, language_version, price_override)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [movie_id, screen_id, show_date, start_time, end_time, language_version, price_override]
    );

    res.status(201).json({ show: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};


// 2. ✅ Create Multiple Shows (e.g., same time for multiple days)
export const createMultipleShows = async (req, res) => {
  const {
    movie_id,
    screen_ids,
    dates,
    time_slots,
    language_version = "Original",
    price_override = null,
  } = req.body;

  // 🧠 1. Validate input
  if (!movie_id) return res.status(400).json({ message: "Movie ID is required" });
  if (!Array.isArray(screen_ids) || screen_ids.length === 0)
    return res.status(400).json({ message: "At least one Screen ID is required" });
  if (!Array.isArray(dates) || dates.length === 0)
    return res.status(400).json({ message: "At least one date is required" });
  if (!Array.isArray(time_slots) || time_slots.length === 0)
    return res.status(400).json({ message: "At least one time slot is required" });

  try {
    const createdShows = [];

    for (const screen_id of screen_ids) {
      for (const show_date of dates) {
        for (const { start_time, end_time } of time_slots) {
          if (!start_time || !end_time) {
            return res.status(400).json({ message: "Each time slot must include start_time and end_time" });
          }

          const result = await db.query(
            `INSERT INTO shows (movie_id, screen_id, show_date, start_time, end_time, language_version, price_override)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
              movie_id,
              screen_id,
              show_date,
              start_time,
              end_time,
              language_version,
              price_override,
            ]
          );

          createdShows.push(result.rows[0]);
        }
      }
    }

    res.status(201).json({ shows: createdShows });
  } catch (err) {
    console.error("❌ Error creating multiple shows:", err.message);
    res.status(400).json({ error: err.message });
  }
};


// 3. ✏️ Edit Show
export const editShow = async (req, res) => {
  const { id } = req.params;
  const allowedFields = [
    "movie_id",
    "screen_id",
    "show_date",
    "start_time",
    "end_time",
    "language_version",
    "price_override",
    "status",
  ];

  const fieldsToUpdate = [];
  const values = [];

  // Dynamically build SET clause
  allowedFields.forEach((field, index) => {
    if (req.body[field] !== undefined) {
      fieldsToUpdate.push(`${field} = $${values.length + 1}`);
      values.push(req.body[field]);
    }
  });

  if (fieldsToUpdate.length === 0) {
    return res.status(400).json({ error: "No valid fields provided to update." });
  }

  // Add the id as the last value
  values.push(id);
  const query = `
    UPDATE shows
    SET ${fieldsToUpdate.join(", ")}
    WHERE id = $${values.length}
    RETURNING *;
  `;

  try {
    const result = await db.query(query, values);
    res.status(200).json({ updated: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// 4. ❌ Delete Show
export const deleteShow = async (req, res) => {
  const { id } = req.params;

  try {
    await db.query(`DELETE FROM shows WHERE id = $1`, [id]);
    res.status(200).json({ message: "Show deleted successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};



// 5. 📆 Get Shows by Date → Group by Movie
export const getShowsByDate = async (req, res) => {
  const { date } = req.params;

  try {
    // 🧠 Extract allowed cinema_hall_ids from verified admin
    const allowedHallIds = Array.isArray(req.my_cinema_hall)
      ? req.my_cinema_hall.map(hall => hall.id)
      : [req.my_cinema_hall.id];

    // 🔍 Query only shows that belong to screens in allowed halls
    const result = await db.query(
      `SELECT 
         s.*, 
         m.title, m.poster_url, m.duration_mins, m.genre, m.language,
         sc.name AS screen_name, sc.screen_position, sc.total_seats
       FROM shows s
       JOIN movies m ON s.movie_id = m.id
       JOIN screens sc ON s.screen_id = sc.id
       WHERE s.show_date = $1 AND sc.cinema_hall_id = ANY($2::uuid[])
       ORDER BY m.title, s.start_time`,
      [date, allowedHallIds]
    );

    const shows = result.rows;

    // Group by movie_id
    const grouped = {};
    for (const show of shows) {
      const movieId = show.movie_id;
      if (!grouped[movieId]) {
        grouped[movieId] = {
          movie_id: movieId,
          title: show.title,
          poster_url: show.poster_url,
          duration: show.duration_mins,
          genre: show.genre,
          language: show.language,
          shows: [],
        };
      }

      grouped[movieId].shows.push({
        id: show.id,
        screen_id: show.screen_id,
        screen_name: show.screen_name,
        screen_position: show.screen_position,
        total_seats: show.total_seats,
        show_date: show.show_date,
        start_time: show.start_time,
        end_time: show.end_time,
        language_version: show.language_version,
        price_override: show.price_override,
        status: show.status,
      });
    }

    res.status(200).json({ date, grouped: Object.values(grouped) });
  } catch (err) {
    console.error("❌ getShowsByDate error:", err.message);
    res.status(500).json({ error: err.message });
  }
};


