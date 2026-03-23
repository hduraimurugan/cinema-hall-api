import db from "../db.js"; // assumes you have a db instance (like pg-promise or pg-pool)
import dayjs from 'dayjs';

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

  console.log("Show Date", show_date);
  // 🧠 Ensure only date part is stored (drop time & timezone)
  const formattedDate = dayjs(show_date).format("YYYY-MM-DD");

  try {
    const result = await db.query(
      `INSERT INTO shows (movie_id, screen_id, show_date, start_time, end_time, language_version, price_override)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [movie_id, screen_id, formattedDate, start_time, end_time, language_version, price_override]
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

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const createdShows = [];
    const skipped = [];

    for (const screen_id of screen_ids) {
      for (const show_date of dates) {
        for (const { start_time, end_time } of time_slots) {
          if (!start_time || !end_time) {
            skipped.push({ show_date, start_time, end_time, reason: "Missing start_time or end_time" });
            continue;
          }
          try {
            // Savepoint per insert — failures roll back only this row, not the whole batch
            await client.query("SAVEPOINT sp_show");
            const result = await client.query(
              `INSERT INTO shows (movie_id, screen_id, show_date, start_time, end_time, language_version, price_override)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING *`,
              [movie_id, screen_id, show_date, start_time, end_time, language_version, price_override]
            );
            createdShows.push(result.rows[0]);
          } catch (err) {
            await client.query("ROLLBACK TO SAVEPOINT sp_show");
            skipped.push({ show_date, start_time, end_time, reason: err.message });
          }
        }
      }
    }

    await client.query("COMMIT");

    const skippedCount = skipped.length;
    console.log(`✅ Bulk create: ${createdShows.length} created, ${skippedCount} skipped`);
    res.status(201).json({ shows: createdShows, skipped });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating multiple shows:", err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
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

  // Inside editShow
  let autoSchedule = false;

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      let value = req.body[field];

      // 🔄 Normalize date string (if field is `show_date`)
      if (field === "show_date") {
        value = dayjs(value).format("YYYY-MM-DD");
        // 📅 If new date >= today, mark for auto-scheduling
        if (!dayjs(value).isBefore(dayjs().format("YYYY-MM-DD"))) {
          autoSchedule = true;
        }
      }

      fieldsToUpdate.push(`${field} = $${values.length + 1}`);
      values.push(value);
    }
  });

  // 🗓️ Auto-reset status to 'scheduled' when show_date moves to today or future
  // (only if the caller didn't explicitly provide a status override)
  if (autoSchedule && req.body.status === undefined) {
    fieldsToUpdate.push(`status = $${values.length + 1}`);
    values.push("scheduled");
  }

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
        movie_id: movieId,
        screen_id: show.screen_id,
        screen_name: show.screen_name,
        screen_position: show.screen_position,
        total_seats: show.total_seats,
        show_date: dayjs(show.show_date).format("YYYY-MM-DD"),
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


//User side Book SHow
export const bookShow = async (req, res) => {
  const { showId } = req.params;
  const { seats } = req.body; // Array of { seat_id, row_label, column_number, seat_label }

  try {
    const results = [];
    const lockDurationMins = 10;
    const lockExpiry = new Date(Date.now() + lockDurationMins * 60000);

    for (const seat of seats) {
      const { seat_id, row_label, column_number, seat_label } = seat;

      const query = `
        INSERT INTO show_booked_seats (
          show_id, seat_id, seat_label, row_label, column_number, status, lock_expires_at
        ) VALUES ($1, $2, $3, $4, $5, 'in_booking', $6)
        ON CONFLICT (show_id, seat_id)
        DO NOTHING
        RETURNING *;
      `;

      const { rows } = await db.query(query, [
        showId,
        seat_id,
        seat_label,
        row_label,
        column_number,
        lockExpiry,
      ]);

      if (rows.length > 0) {
        results.push({ seat_id, status: "locked", seat_label });
      } else {
        results.push({ seat_id, status: "unavailable", seat_label });
      }
    }

    res.status(200).json({ success: true, data: results });
  } catch (err) {
    console.error("❌ Booking error:", err);
    res.status(500).json({ success: false, message: "Booking failed" });
  }
};

// User Side Get show layout
export const getShowById = async (req, res) => {
  const { id } = req.params;

  try {
    // 1️⃣ Fetch show + movie + screen
    const showResult = await db.query(
      `SELECT 
        s.*, 
        m.title, m.poster_url, m.duration_mins, m.genre, m.language,
        sc.name AS screen_name, sc.rows, sc.columns, sc.layout, sc.screen_position
       FROM shows s
       JOIN movies m ON s.movie_id = m.id
       JOIN screens sc ON s.screen_id = sc.id
       WHERE s.id = $1`,
      [id]
    );

    if (showResult.rowCount === 0) {
      return res.status(404).json({ error: "Show not found" });
    }

    const show = showResult.rows[0];
    show.show_date = dayjs(show.show_date).format("YYYY-MM-DD");

    // 2️⃣ Fetch booked seats for this show
    const now = new Date();
    const bookedResult = await db.query(
      `SELECT seat_id, status, hold_expires_at
       FROM show_booked_seats 
       WHERE show_id = $1`,
      [id]
    );

    const seatStatusMap = {};
    for (const seat of bookedResult.rows) {
      // Exclude expired HELD seats
      if (
        seat.status === "HELD" &&
        seat.hold_expires_at &&
        new Date(seat.hold_expires_at) < now
      ) {
        continue; // expired, treat as available
      }
      seatStatusMap[seat.seat_id] = seat.status;
    }

    // 3️⃣ Mark each seat in layout with status & seat_label
    const layout = show.layout;
    const updatedSeats = layout.seats.map((seat) => {
      if (seat.isBlocked || seat.type === "passage") {
        return {
          ...seat,
          seat_label: null,
          status: "blocked"
        };
      }

      const seatStatus = seatStatusMap[seat.id] || "available";
      const seat_label = `${seat.row}${seat.column}`;

      return {
        ...seat,
        seat_label,
        status: seatStatus
      };
    });

    // 4️⃣ Final response
    res.status(200).json({
      show_id: show.id,
      movie: {
        id: show.movie_id,
        title: show.title,
        poster_url: show.poster_url,
        duration: show.duration_mins,
        genre: show.genre,
        language: show.language,
      },
      screen: {
        id: show.screen_id,
        name: show.screen_name,
        position: show.screen_position,
        rows: show.rows,
        columns: show.columns,
        layout: {
          ...layout,
          seats: updatedSeats, // with updated status and seat_label
        },
      },
      show_details: {
        show_date: show.show_date,
        start_time: show.start_time,
        end_time: show.end_time,
        status: show.status,
        language_version: show.language_version,
        price_override: show.price_override,
      },
    });
  } catch (err) {
    console.error("❌ getShowById error:", err.message);
    res.status(500).json({ error: "Something went wrong" });
  }
};

// Background job: auto-update show statuses based on current time (IST)
export const updateShowStatuses = async () => {
  try {
    const runningResult = await db.query(`
      UPDATE shows SET status = 'running'
      WHERE status = 'scheduled'
        AND show_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
        AND start_time <= (NOW() AT TIME ZONE 'Asia/Kolkata')::time
        AND end_time > (NOW() AT TIME ZONE 'Asia/Kolkata')::time
    `);

    const completedResult = await db.query(`
      UPDATE shows SET status = 'completed'
      WHERE status IN ('scheduled', 'running')
        AND (
          show_date < (NOW() AT TIME ZONE 'Asia/Kolkata')::date
          OR (
            show_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
            AND end_time <= (NOW() AT TIME ZONE 'Asia/Kolkata')::time
          )
        )
    `);

    if (runningResult.rowCount > 0 || completedResult.rowCount > 0) {
      console.log(`🎬 Shows updated: ${runningResult.rowCount} → running, ${completedResult.rowCount} → completed`);
    }
  } catch (error) {
    console.error('❌ Show status update error:', error);
  }
};

