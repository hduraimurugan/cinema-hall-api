import db from "../db.js"; // assumes you have a db instance (like pg-promise or pg-pool)
import dayjs from 'dayjs';
import Razorpay from "razorpay";
import logger from '../utils/logger.js';
import { recordAuditLog } from '../utils/auditLog.js';
import { notify, cancelShowReminder } from '../services/notification/index.js';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

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

  logger.debug("Show Date", { show_date });
  // 🧠 Ensure only date part is stored (drop time & timezone)
  const formattedDate = dayjs(show_date).format("YYYY-MM-DD");

  try {
    const result = await db.query(
      `INSERT INTO shows (movie_id, screen_id, show_date, start_time, end_time, language_version, price_override)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [movie_id, screen_id, formattedDate, start_time, end_time, language_version, price_override]
    );

    await recordAuditLog(req, {
      action: 'shows.create',
      resourceType: 'show',
      resourceId: result.rows[0].id,
      resourceLabel: `${formattedDate} ${start_time}`,
      hallId: req.currentHallId,
    });

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
    logger.info(`✅ Bulk create: ${createdShows.length} created, ${skippedCount} skipped`);

    await recordAuditLog(req, {
      action: 'shows.create.bulk',
      resourceType: 'show',
      resourceLabel: `${createdShows.length} show(s)`,
      hallId: req.currentHallId,
      metadata: { created: createdShows.map(s => s.id), skipped },
    });

    res.status(201).json({ shows: createdShows, skipped });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("❌ Error creating multiple shows:", { message: err.message });
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

    await recordAuditLog(req, {
      action: 'shows.update',
      resourceType: 'show',
      resourceId: result.rows[0].id,
      resourceLabel: `${result.rows[0].show_date} ${result.rows[0].start_time}`,
      hallId: req.currentHallId,
      metadata: { fields: allowedFields.filter(f => req.body[f] !== undefined) },
    });

    res.status(200).json({ updated: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// 4. ❌ Delete Show
export const deleteShow = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(`DELETE FROM shows WHERE id = $1 RETURNING *`, [id]);

    if (result.rowCount > 0) {
      await recordAuditLog(req, {
        action: 'shows.delete',
        resourceType: 'show',
        resourceId: result.rows[0].id,
        resourceLabel: `${result.rows[0].show_date} ${result.rows[0].start_time}`,
        hallId: req.currentHallId,
      });
    }

    res.status(200).json({ message: "Show deleted successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};


// 4b. ❌ Bulk Delete Shows
export const deleteMultipleShows = async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ message: "At least one show ID is required" });

  try {
    const result = await db.query(
      `DELETE FROM shows WHERE id = ANY($1::uuid[]) RETURNING id`,
      [ids]
    );

    await recordAuditLog(req, {
      action: 'shows.delete.bulk',
      resourceType: 'show',
      resourceLabel: `${result.rowCount} show(s)`,
      hallId: req.currentHallId,
      metadata: { requested: ids, deleted: result.rows.map(r => r.id) },
    });

    res.status(200).json({ deleted: result.rowCount, message: `${result.rowCount} show(s) deleted` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};


// 5. 📆 Get Shows by Date → Group by Movie
export const getShowsByDate = async (req, res) => {
  const { date } = req.params;

  try {
    const hallId = req.currentHallId;

    // 🔍 Query only shows that belong to the active hall
    const result = await db.query(
      `SELECT 
         s.*, 
         m.title, m.poster_url, m.duration_mins, m.genre, m.language,
         sc.name AS screen_name, sc.screen_position, sc.total_seats
       FROM shows s
       JOIN movies m ON s.movie_id = m.id
       JOIN screens sc ON s.screen_id = sc.id
       WHERE s.show_date = $1 AND sc.cinema_hall_id = $2
       ORDER BY m.title, s.start_time`,
      [date, hallId]
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
    logger.error("❌ getShowsByDate error:", { message: err.message });
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
    logger.error("❌ Booking error:", { error: err });
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
    logger.error("❌ getShowById error:", { message: err.message });
    res.status(500).json({ error: "Something went wrong" });
  }
};

// Background job: auto-update show statuses based on current time (IST)
// Shows that cross midnight (e.g. 10:30 PM + 3h49m → ends 2:19 AM next day) have
// end_time < start_time. We compute the actual end timestamp by adding 1 day in that case.
export const updateShowStatuses = async () => {
  try {
    logger.info("🔄 Running scheduled show status update...", { at: new Date().toISOString() });
    const nowIst = `(NOW() AT TIME ZONE 'Asia/Kolkata')`;

    // Actual end timestamp: if end_time < start_time the show crosses midnight → end is next day
    const endTs = `
      CASE WHEN end_time < start_time
        THEN (show_date + INTERVAL '1 day')::timestamp + end_time
        ELSE show_date::timestamp + end_time
      END
    `;

    // booking_started → in_progress when show has started but not yet ended
    const inProgressResult = await db.query(`
      UPDATE shows SET status = 'in_progress'
      WHERE status = 'booking_started'
        AND (show_date::timestamp + start_time) <= ${nowIst}
        AND (${endTs}) > ${nowIst}
    `);

    // in_progress → show_ended when actual end timestamp has passed
    const endedResult = await db.query(`
      UPDATE shows SET status = 'show_ended'
      WHERE status = 'in_progress'
        AND (${endTs}) <= ${nowIst}
    `);

    // booking_started shows that passed end_time without entering in_progress → show_ended
    const missedResult = await db.query(`
      UPDATE shows SET status = 'show_ended'
      WHERE status = 'booking_started'
        AND (${endTs}) <= ${nowIst}
    `);

    // scheduled shows past actual end timestamp (never opened for booking) → show_ended
    const expiredResult = await db.query(`
      UPDATE shows SET status = 'show_ended'
      WHERE status = 'scheduled'
        AND (${endTs}) <= ${nowIst}
    `);

    const totalEnded = endedResult.rowCount + missedResult.rowCount + expiredResult.rowCount;
    if (inProgressResult.rowCount > 0 || totalEnded > 0) {
      logger.info(`🎬 Shows updated: ${inProgressResult.rowCount} → in_progress, ${totalEnded} → show_ended`);
    }
  } catch (error) {
    const transient = ['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'];
    if (transient.includes(error.code)) {
      logger.warn(`⚠️ Show status update skipped — DB unreachable (${error.code})`);
    } else {
      logger.error('❌ Show status update error:', { error });
    }
  }
};

// Admin: Cancel a show — marks bookings cancelled and initiates Razorpay refunds
export const cancelShow = async (req, res) => {
  const { id } = req.params;
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Verify show belongs to the active cinema hall
    const showResult = await client.query(
      `SELECT sh.id, sh.status FROM shows sh
       JOIN screens sc ON sc.id = sh.screen_id
       WHERE sh.id = $1 AND sc.cinema_hall_id = $2`,
      [id, req.currentHallId]
    );

    if (showResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Show not found or unauthorized' });
    }

    const show = showResult.rows[0];
    if (show.status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Show is already cancelled' });
    }
    if (show.status === 'show_ended') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot cancel a show that has already ended' });
    }

    // Cancel the show
    await client.query(`UPDATE shows SET status = 'cancelled' WHERE id = $1`, [id]);

    // Find all paid bookings for this show
    const bookingsResult = await client.query(
      `SELECT id, payment_id, total_amount, customer_id FROM bookings
       WHERE show_id = $1 AND payment_status = 'completed' AND booking_status != 'cancelled'`,
      [id]
    );

    if (bookingsResult.rowCount > 0) {
      // Mark bookings as cancelled
      await client.query(
        `UPDATE bookings SET booking_status = 'cancelled'
         WHERE show_id = $1 AND payment_status = 'completed' AND booking_status != 'cancelled'`,
        [id]
      );

      // Create a refund record for each booking (status: initiated)
      for (const booking of bookingsResult.rows) {
        if (booking.payment_id) {
          await client.query(
            `INSERT INTO refunds (booking_id, payment_id, amount, refund_status)
             VALUES ($1, $2, $3, 'initiated')`,
            [booking.id, booking.payment_id, booking.total_amount]
          );
        }
      }
    }

    await client.query('COMMIT');

    // Fetched once for the whole show (not per booking) — used by the
    // show_cancelled/refund_initiated notifications below.
    const showDetailsResult = await db.query(
      `SELECT m.title AS movie_title, sh.show_date, ch.name AS cinema_hall_name, ch.org_id, o.owner_id
       FROM shows sh
       JOIN movies m ON m.id = sh.movie_id
       JOIN screens sc ON sc.id = sh.screen_id
       JOIN cinema_hall ch ON ch.id = sc.cinema_hall_id
       JOIN organizations o ON o.id = ch.org_id
       WHERE sh.id = $1`,
      [id]
    );
    const showDetails = showDetailsResult.rows[0];

    // Initiate Razorpay refunds outside the DB transaction
    const refundResults = [];
    for (const booking of bookingsResult.rows) {
      if (booking.payment_id) {
        try {
          const refundResponse = await razorpay.payments.refund(booking.payment_id, {});
          // Store the Razorpay refund ID returned from the API
          await db.query(
            `UPDATE refunds SET razorpay_refund_id = $1 WHERE booking_id = $2`,
            [refundResponse.id, booking.id]
          );
          refundResults.push({ payment_id: booking.payment_id, status: 'refund_initiated' });
        } catch (refundErr) {
          logger.error('❌ Razorpay refund error:', { message: refundErr.message });
          await db.query(
            `UPDATE refunds SET refund_status = 'failed', failure_reason = $1 WHERE booking_id = $2`,
            [refundErr.message, booking.id]
          );
          refundResults.push({ payment_id: booking.payment_id, status: 'refund_failed', error: refundErr.message });

          if (showDetails?.owner_id) {
            try {
              await notify(
                'refund_failed',
                { type: 'admin', id: showDetails.owner_id, orgId: showDetails.org_id },
                { bookingId: booking.id, movieTitle: showDetails.movie_title, amount: booking.total_amount, reason: refundErr.message }
              );
            } catch (notifyError) {
              logger.error('[cancelShow] refund_failed notify dispatch failed (non-fatal)', { message: notifyError.message });
            }
          }
        }

        // Two separate notify() calls — they map to two independent
        // USER_DEFAULTS.notifications toggles the customer controls. Fires
        // regardless of the Razorpay outcome above: "initiated" reflects that
        // a refund attempt was made, not whether it has settled yet.
        if (showDetails) {
          const recipient = { type: 'customer', id: booking.customer_id, orgId: showDetails.org_id };
          try {
            await cancelShowReminder(booking.id);
            await notify('show_cancelled', recipient, {
              bookingId: booking.id, showId: id,
              movieTitle: showDetails.movie_title, showDate: showDetails.show_date,
              cinemaHallName: showDetails.cinema_hall_name, amount: booking.total_amount,
            });
            await notify('refund_initiated', recipient, {
              bookingId: booking.id, movieTitle: showDetails.movie_title, amount: booking.total_amount,
            });
          } catch (notifyError) {
            logger.error('[cancelShow] Notification dispatch failed (non-fatal)', { message: notifyError.message });
          }
        }
      }
    }

    await recordAuditLog(req, {
      action: 'shows.cancel',
      resourceType: 'show',
      resourceId: id,
      hallId: req.currentHallId,
      metadata: { bookings_cancelled: bookingsResult.rowCount },
    });

    res.status(200).json({
      message: 'Show cancelled successfully',
      bookings_cancelled: bookingsResult.rowCount,
      refunds: refundResults,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('❌ cancelShow error:', { message: err.message });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// Admin: Open or revert booking status
export const updateShowBookingStatus = async (req, res) => {
  const { id } = req.params;
  const { action } = req.body; // 'open' | 'revert'

  try {
    const showResult = await db.query(
      `SELECT sh.id, sh.status FROM shows sh
       JOIN screens sc ON sc.id = sh.screen_id
       WHERE sh.id = $1 AND sc.cinema_hall_id = $2`,
      [id, req.currentHallId]
    );

    if (showResult.rowCount === 0) {
      return res.status(404).json({ error: 'Show not found or unauthorized' });
    }

    const show = showResult.rows[0];

    if (action === 'open') {
      if (show.status !== 'scheduled') {
        return res.status(400).json({ error: `Cannot open bookings for a show with status '${show.status}'` });
      }
      await db.query(`UPDATE shows SET status = 'booking_started' WHERE id = $1`, [id]);
      await recordAuditLog(req, {
        action: 'shows.booking_status.update',
        resourceType: 'show',
        resourceId: id,
        hallId: req.currentHallId,
        metadata: { action: 'open', to: 'booking_started' },
      });
      return res.status(200).json({ message: 'Booking opened successfully', status: 'booking_started' });
    }

    if (action === 'revert') {
      if (show.status !== 'booking_started') {
        return res.status(400).json({ error: `Cannot revert a show with status '${show.status}'` });
      }
      const bookingCheck = await db.query(
        `SELECT COUNT(*) FROM bookings WHERE show_id = $1 AND booking_status = 'confirmed'`,
        [id]
      );
      if (parseInt(bookingCheck.rows[0].count) > 0) {
        return res.status(400).json({ error: 'Cannot revert: confirmed bookings already exist for this show' });
      }
      await db.query(`UPDATE shows SET status = 'scheduled' WHERE id = $1`, [id]);
      await recordAuditLog(req, {
        action: 'shows.booking_status.update',
        resourceType: 'show',
        resourceId: id,
        hallId: req.currentHallId,
        metadata: { action: 'revert', to: 'scheduled' },
      });
      return res.status(200).json({ message: 'Show reverted to scheduled', status: 'scheduled' });
    }

    if (action === 'restore') {
      if (show.status !== 'cancelled') {
        return res.status(400).json({ error: `Cannot restore a show with status '${show.status}'` });
      }
      await db.query(`UPDATE shows SET status = 'scheduled' WHERE id = $1`, [id]);
      await recordAuditLog(req, {
        action: 'shows.restore',
        resourceType: 'show',
        resourceId: id,
        hallId: req.currentHallId,
        metadata: { to: 'scheduled' },
      });
      return res.status(200).json({ message: 'Show restored to scheduled', status: 'scheduled' });
    }

    return res.status(400).json({ error: 'Invalid action. Use "open", "revert", or "restore"' });
  } catch (err) {
    logger.error('❌ updateShowBookingStatus error:', { message: err.message });
    res.status(500).json({ error: err.message });
  }
};

// Admin: Bulk cancel shows — cancels each show and initiates Razorpay refunds
export const bulkCancelShows = async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: 'No show IDs provided' });

  const results = [];

  for (const id of ids) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const showResult = await client.query(
        `SELECT sh.id, sh.status FROM shows sh
         JOIN screens sc ON sc.id = sh.screen_id
         WHERE sh.id = $1 AND sc.cinema_hall_id = $2`,
        [id, req.currentHallId]
      );

      if (showResult.rowCount === 0) {
        await client.query('ROLLBACK');
        results.push({ id, success: false, error: 'Not found or unauthorized' });
        continue;
      }

      const show = showResult.rows[0];
      if (show.status === 'cancelled') {
        await client.query('ROLLBACK');
        results.push({ id, success: false, error: 'Already cancelled' });
        continue;
      }
      if (show.status === 'show_ended') {
        await client.query('ROLLBACK');
        results.push({ id, success: false, error: 'Show already ended' });
        continue;
      }

      await client.query(`UPDATE shows SET status = 'cancelled' WHERE id = $1`, [id]);

      const bookingsResult = await client.query(
        `SELECT id, payment_id, total_amount, customer_id FROM bookings
         WHERE show_id = $1 AND payment_status = 'completed' AND booking_status != 'cancelled'`,
        [id]
      );

      if (bookingsResult.rowCount > 0) {
        await client.query(
          `UPDATE bookings SET booking_status = 'cancelled'
           WHERE show_id = $1 AND payment_status = 'completed' AND booking_status != 'cancelled'`,
          [id]
        );

        // Create a refund record for each booking (status: initiated)
        for (const booking of bookingsResult.rows) {
          if (booking.payment_id) {
            await client.query(
              `INSERT INTO refunds (booking_id, payment_id, amount, refund_status)
               VALUES ($1, $2, $3, 'initiated')`,
              [booking.id, booking.payment_id, booking.total_amount]
            );
          }
        }
      }

      await client.query('COMMIT');

      const showDetailsResult = await db.query(
        `SELECT m.title AS movie_title, sh.show_date, ch.name AS cinema_hall_name, ch.org_id, o.owner_id
         FROM shows sh
         JOIN movies m ON m.id = sh.movie_id
         JOIN screens sc ON sc.id = sh.screen_id
         JOIN cinema_hall ch ON ch.id = sc.cinema_hall_id
         JOIN organizations o ON o.id = ch.org_id
         WHERE sh.id = $1`,
        [id]
      );
      const showDetails = showDetailsResult.rows[0];

      // Razorpay refunds outside transaction
      for (const booking of bookingsResult.rows) {
        if (booking.payment_id) {
          try {
            const refundResponse = await razorpay.payments.refund(booking.payment_id, {});
            await db.query(
              `UPDATE refunds SET razorpay_refund_id = $1 WHERE booking_id = $2`,
              [refundResponse.id, booking.id]
            );
          } catch (refundErr) {
            logger.error('❌ Razorpay refund error:', { message: refundErr.message });
            await db.query(
              `UPDATE refunds SET refund_status = 'failed', failure_reason = $1 WHERE booking_id = $2`,
              [refundErr.message, booking.id]
            );

            if (showDetails?.owner_id) {
              try {
                await notify(
                  'refund_failed',
                  { type: 'admin', id: showDetails.owner_id, orgId: showDetails.org_id },
                  { bookingId: booking.id, movieTitle: showDetails.movie_title, amount: booking.total_amount, reason: refundErr.message }
                );
              } catch (notifyError) {
                logger.error('[bulkCancelShows] refund_failed notify dispatch failed (non-fatal)', { message: notifyError.message });
              }
            }
          }

          if (showDetails) {
            const recipient = { type: 'customer', id: booking.customer_id, orgId: showDetails.org_id };
            try {
              await cancelShowReminder(booking.id);
              await notify('show_cancelled', recipient, {
                bookingId: booking.id, showId: id,
                movieTitle: showDetails.movie_title, showDate: showDetails.show_date,
                cinemaHallName: showDetails.cinema_hall_name, amount: booking.total_amount,
              });
              await notify('refund_initiated', recipient, {
                bookingId: booking.id, movieTitle: showDetails.movie_title, amount: booking.total_amount,
              });
            } catch (notifyError) {
              logger.error('[bulkCancelShows] Notification dispatch failed (non-fatal)', { message: notifyError.message });
            }
          }
        }
      }

      results.push({ id, success: true, bookings_cancelled: bookingsResult.rowCount });
    } catch (err) {
      await client.query('ROLLBACK');
      results.push({ id, success: false, error: err.message });
    } finally {
      client.release();
    }
  }

  const succeeded = results.filter(r => r.success).length;

  await recordAuditLog(req, {
    action: 'shows.cancel.bulk',
    resourceType: 'show',
    resourceLabel: `${succeeded} show(s)`,
    hallId: req.currentHallId,
    metadata: {
      requested: ids,
      succeeded: results.filter(r => r.success).map(r => r.id),
      failed: results.filter(r => !r.success),
    },
  });

  res.status(200).json({
    message: `${succeeded} of ${ids.length} show(s) cancelled`,
    results,
  });
};

// Admin: Bulk restore cancelled shows back to scheduled
export const bulkRestoreShows = async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: 'No show IDs provided' });

  const results = [];

  for (const id of ids) {
    try {
      const showResult = await db.query(
        `SELECT sh.id, sh.status FROM shows sh
         JOIN screens sc ON sc.id = sh.screen_id
         WHERE sh.id = $1 AND sc.cinema_hall_id = $2`,
        [id, req.currentHallId]
      );

      if (showResult.rowCount === 0) {
        results.push({ id, success: false, error: 'Not found or unauthorized' });
        continue;
      }

      const show = showResult.rows[0];
      if (show.status !== 'cancelled') {
        results.push({ id, success: false, error: `Cannot restore (status: ${show.status})` });
        continue;
      }

      await db.query(`UPDATE shows SET status = 'scheduled' WHERE id = $1`, [id]);
      results.push({ id, success: true });
    } catch (err) {
      results.push({ id, success: false, error: err.message });
    }
  }

  const succeeded = results.filter(r => r.success).length;

  await recordAuditLog(req, {
    action: 'shows.restore.bulk',
    resourceType: 'show',
    resourceLabel: `${succeeded} show(s)`,
    hallId: req.currentHallId,
    metadata: {
      requested: ids,
      succeeded: results.filter(r => r.success).map(r => r.id),
      failed: results.filter(r => !r.success),
    },
  });

  res.status(200).json({
    message: `${succeeded} of ${ids.length} show(s) restored to scheduled`,
    results,
  });
};

// Admin: Bulk open booking for multiple shows
export const bulkOpenBooking = async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: 'No show IDs provided' });

  const results = [];

  for (const id of ids) {
    try {
      const showResult = await db.query(
        `SELECT sh.id, sh.status FROM shows sh
         JOIN screens sc ON sc.id = sh.screen_id
         WHERE sh.id = $1 AND sc.cinema_hall_id = $2`,
        [id, req.currentHallId]
      );

      if (showResult.rowCount === 0) {
        results.push({ id, success: false, error: 'Not found or unauthorized' });
        continue;
      }

      const show = showResult.rows[0];
      if (show.status !== 'scheduled') {
        results.push({ id, success: false, error: `Cannot open bookings (status: ${show.status})` });
        continue;
      }

      await db.query(`UPDATE shows SET status = 'booking_started' WHERE id = $1`, [id]);
      results.push({ id, success: true });
    } catch (err) {
      results.push({ id, success: false, error: err.message });
    }
  }

  const succeeded = results.filter(r => r.success).length;

  await recordAuditLog(req, {
    action: 'shows.booking_status.update.bulk',
    resourceType: 'show',
    resourceLabel: `${succeeded} show(s)`,
    hallId: req.currentHallId,
    metadata: {
      action: 'open',
      requested: ids,
      succeeded: results.filter(r => r.success).map(r => r.id),
      failed: results.filter(r => !r.success),
    },
  });

  res.status(200).json({
    message: `Booking opened for ${succeeded} of ${ids.length} show(s)`,
    results,
  });
};

// Admin: Get confirmed booking count + total refund amount for a show (used by cancel dialog)
export const getShowBookingCount = async (req, res) => {
  const { id } = req.params;
  try {
    const showResult = await db.query(
      `SELECT sh.id FROM shows sh
       JOIN screens sc ON sc.id = sh.screen_id
       WHERE sh.id = $1 AND sc.cinema_hall_id = $2`,
      [id, req.currentHallId]
    );

    if (showResult.rowCount === 0) {
      return res.status(404).json({ error: 'Show not found or unauthorized' });
    }

    const result = await db.query(
      `SELECT COUNT(*) AS booking_count, COALESCE(SUM(total_amount), 0) AS total_amount
       FROM bookings
       WHERE show_id = $1 AND payment_status = 'completed' AND booking_status != 'cancelled'`,
      [id]
    );

    res.status(200).json({
      booking_count: parseInt(result.rows[0].booking_count, 10),
      total_amount: parseFloat(result.rows[0].total_amount),
    });
  } catch (err) {
    logger.error('❌ getShowBookingCount error:', { message: err.message });
    res.status(500).json({ error: err.message });
  }
};

