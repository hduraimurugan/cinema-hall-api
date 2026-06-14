import db from "../db.js";
import logger from '../utils/logger.js';

const HOLD_DURATION_MINUTES = 5;

/**
 * ✅ HOLD SEATS - Atomic with row-level locking
 * 
 * POST /api/booking/hold
 * Body: { show_id, seats: ["A1", "A2", "A3"] }
 * Auth: Customer required
 */
export const holdSeats = async (req, res) => {
    const { show_id, seats } = req.body;
    const customer_id = req.customer.id;

    if (!show_id || !seats?.length) {
        return res.status(400).json({ error: "show_id and seats are required" });
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const holdExpiry = new Date(Date.now() + HOLD_DURATION_MINUTES * 60 * 1000);
        const results = [];

        for (const seat_id of seats) {
            // Step 1: Lock the row with FOR UPDATE
            const lockQuery = `
        SELECT status, held_by, hold_expires_at 
        FROM show_booked_seats 
        WHERE show_id = $1 AND seat_id = $2
        FOR UPDATE;
      `;
            const lockResult = await client.query(lockQuery, [show_id, seat_id]);

            if (lockResult.rowCount === 0) {
                // Seat doesn't exist in table yet - available
                // Insert as HELD
                const insertQuery = `
          INSERT INTO show_booked_seats 
            (show_id, seat_id, seat_label, row_label, column_number, status, held_by, hold_expires_at)
          VALUES ($1, $2, $2, '', 0, 'HELD', $3, $4)
          RETURNING *;
        `;
                await client.query(insertQuery, [show_id, seat_id, customer_id, holdExpiry]);
                results.push({ seat_id, status: 'held', expires_at: holdExpiry });

            } else {
                const row = lockResult.rows[0];
                const now = new Date();

                // Check if seat is available
                const isAvailable =
                    row.status === 'AVAILABLE' ||
                    (row.status === 'HELD' && row.hold_expires_at < now);

                if (isAvailable) {
                    // Update to HELD
                    await client.query(`
            UPDATE show_booked_seats 
            SET status = 'HELD', held_by = $3, hold_expires_at = $4
            WHERE show_id = $1 AND seat_id = $2;
          `, [show_id, seat_id, customer_id, holdExpiry]);

                    results.push({ seat_id, status: 'held', expires_at: holdExpiry });
                } else {
                    // Seat is taken
                    results.push({ seat_id, status: 'unavailable', held_by: row.held_by });
                }
            }
        }

        // If ANY seat failed, rollback everything
        const failedSeats = results.filter(r => r.status === 'unavailable');
        if (failedSeats.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: `${failedSeats.length} seat(s) are unavailable`,
                results
            });
        }

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: `${seats.length} seat(s) held successfully`,
            hold_expires_at: holdExpiry,
            results
        });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error("❌ Hold seats error:", { error });
        return res.status(500).json({ error: "Failed to hold seats" });
    } finally {
        client.release();
    }
};


/**
 * ✅ CONFIRM BOOKING - Convert HELD to BOOKED
 * 
 * POST /api/booking/confirm
 * Body: { show_id, seats: ["A1", "A2"], total_amount }
 * Auth: Customer required
 */
export const confirmBooking = async (req, res) => {
    const { show_id, seats, total_amount } = req.body;
    const customer_id = req.customer.id;
    const customer_email = req.customer.email;

    if (!show_id || !seats?.length) {
        return res.status(400).json({ error: "show_id and seats are required" });
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const now = new Date();

        // Verify all seats are HELD by this customer and not expired
        for (const seat_id of seats) {
            const checkQuery = `
        SELECT status, held_by, hold_expires_at 
        FROM show_booked_seats 
        WHERE show_id = $1 AND seat_id = $2
        FOR UPDATE;
      `;
            const result = await client.query(checkQuery, [show_id, seat_id]);

            if (result.rowCount === 0) {
                throw new Error(`Seat ${seat_id} not found`);
            }

            const seat = result.rows[0];

            if (seat.status !== 'HELD') {
                throw new Error(`Seat ${seat_id} is not held`);
            }

            if (seat.held_by !== customer_id) {
                throw new Error(`Seat ${seat_id} is held by another user`);
            }

            if (seat.hold_expires_at < now) {
                throw new Error(`Hold for seat ${seat_id} has expired`);
            }
        }

        // All validations passed - update to BOOKED
        await client.query(`
      UPDATE show_booked_seats 
      SET status = 'BOOKED', 
          booked_at = NOW(),
          hold_expires_at = NULL
      WHERE show_id = $1 AND seat_id = ANY($2::text[]) AND held_by = $3;
    `, [show_id, seats, customer_id]);

        // Create booking record
        const bookingResult = await client.query(`
      INSERT INTO bookings (show_id, user_email, seats, total_amount, status)
      VALUES ($1, $2, $3, $4, 'booked')
      RETURNING *;
    `, [show_id, customer_email, JSON.stringify(seats), total_amount || 0]);

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: "Booking confirmed!",
            booking: bookingResult.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error("❌ Confirm booking error:", { message: error.message });
        return res.status(400).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
};


/**
 * ✅ RELEASE SEATS - Customer voluntarily releases held seats
 * 
 * POST /api/booking/release
 * Body: { show_id, seats: ["A1", "A2"] }
 * Auth: Customer required
 */
export const releaseSeats = async (req, res) => {
    const { show_id, seats } = req.body;
    const customer_id = req.customer.id;

    try {
        const result = await db.query(`
      DELETE FROM show_booked_seats 
      WHERE show_id = $1 
        AND seat_id = ANY($2::text[]) 
        AND held_by = $3 
        AND status = 'HELD'
      RETURNING seat_id;
    `, [show_id, seats, customer_id]);

        return res.status(200).json({
            success: true,
            released: result.rows.map(r => r.seat_id)
        });
    } catch (error) {
        logger.error("❌ Release seats error:", { error });
        return res.status(500).json({ error: "Failed to release seats" });
    }
};


/**
 * ✅ GET BOOKING BY PAYMENT ID
 *
 * GET /api/booking/by-payment/:payment_id
 * Auth: Customer required
 */
export const getBookingByPaymentId = async (req, res) => {
    const { payment_id } = req.params;
    const customer_id = req.customer.id;

    try {
        const result = await db.query(`
      SELECT
        b.*,
        m.title AS movie_title,
        sh.show_date,
        sh.start_time,
        ARRAY(
          SELECT (seat_data->>'row') || (seat_data->>'column')
          FROM jsonb_array_elements(sc.layout->'seats') AS seat_data
          WHERE seat_data->>'id' IN (SELECT jsonb_array_elements_text(b.seats))
        ) AS seat_labels
      FROM bookings b
      JOIN shows sh ON sh.id = b.show_id
      JOIN movies m ON m.id = sh.movie_id
      JOIN screens sc ON sc.id = sh.screen_id
      WHERE b.payment_id = $1 AND b.customer_id = $2
    `, [payment_id, customer_id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Booking not found" });
        }

        return res.status(200).json({ booking: result.rows[0] });
    } catch (error) {
        logger.error("❌ Get booking by payment ID error:", { error });
        return res.status(500).json({ error: "Failed to fetch booking" });
    }
};


/**
 * ✅ GET MY BOOKINGS - List all bookings for the logged-in customer
 *
 * GET /api/booking/my-bookings
 * Auth: Customer required
 */
export const getMyBookings = async (req, res) => {
    const customer_id = req.customer.id;

    try {
        const result = await db.query(`
      SELECT
        b.*,
        m.title AS movie_title,
        sh.show_date,
        sh.start_time,
        sc.name AS screen_name,
        ch.name AS cinema_hall_name,
        ch.location AS cinema_hall_location,
        ch.latitude AS cinema_hall_latitude,
        ch.longitude AS cinema_hall_longitude,
        ARRAY(
          SELECT (seat_data->>'row') || (seat_data->>'column')
          FROM jsonb_array_elements(sc.layout->'seats') AS seat_data
          WHERE seat_data->>'id' IN (SELECT jsonb_array_elements_text(b.seats))
        ) AS seat_labels,
        r.refund_status,
        r.razorpay_refund_id,
        r.initiated_at AS refund_initiated_at,
        r.settled_at AS refund_settled_at
      FROM bookings b
      JOIN shows sh ON sh.id = b.show_id
      JOIN movies m ON m.id = sh.movie_id
      JOIN screens sc ON sc.id = sh.screen_id
      JOIN cinema_hall ch ON ch.id = sc.cinema_hall_id
      LEFT JOIN refunds r ON r.booking_id = b.id
      WHERE b.customer_id = $1
      ORDER BY sh.show_date DESC, sh.start_time DESC
    `, [customer_id]);

        return res.status(200).json({ bookings: result.rows });
    } catch (error) {
        logger.error("❌ Get my bookings error:", { error });
        return res.status(500).json({ error: "Failed to fetch bookings" });
    }
};


/**
 * ✅ GET CINEMA HALL BOOKINGS - List all bookings for admin's cinema hall
 *
 * GET /api/booking/admin/all
 * Query params: from_date, to_date, search, status, page
 * Auth: Admin + Cinema Hall required
 */
export const getCinemaHallBookings = async (req, res) => {
    const cinema_hall_id = req.currentHallId;

    const { from_date, to_date, search, status, screen_id, page = 1, limit: limitParam = 10 } = req.query;
    const limit = Math.min(Math.max(parseInt(limitParam) || 10, 1), 100);
    const offset = (parseInt(page) - 1) * limit;

    try {
        const result = await db.query(`
      SELECT
        b.*,
        m.title AS movie_title,
        sh.show_date,
        sh.start_time,
        sc.name AS screen_name,
        c.name AS customer_name,
        c.email AS customer_email,
        ARRAY(
          SELECT (seat_data->>'row') || (seat_data->>'column')
          FROM jsonb_array_elements(sc.layout->'seats') AS seat_data
          WHERE seat_data->>'id' IN (SELECT jsonb_array_elements_text(b.seats))
        ) AS seat_labels
      FROM bookings b
      JOIN shows sh ON sh.id = b.show_id
      JOIN movies m ON m.id = sh.movie_id
      JOIN screens sc ON sc.id = sh.screen_id
      JOIN customers c ON c.id = b.customer_id
      WHERE sc.cinema_hall_id = $1
        AND ($2::date IS NULL OR sh.show_date >= $2)
        AND ($3::date IS NULL OR sh.show_date <= $3)
        AND ($4::text IS NULL OR LOWER(m.title) LIKE '%' || LOWER($4) || '%')
        AND ($5::text IS NULL OR b.booking_status = $5)
        AND ($6::uuid IS NULL OR sc.id = $6)
      ORDER BY b.created_at DESC
      LIMIT $7 OFFSET $8
    `, [cinema_hall_id, from_date || null, to_date || null, search || null, status || null, screen_id || null, limit, offset]);

        const countResult = await db.query(`
      SELECT COUNT(*) AS total
      FROM bookings b
      JOIN shows sh ON sh.id = b.show_id
      JOIN movies m ON m.id = sh.movie_id
      JOIN screens sc ON sc.id = sh.screen_id
      WHERE sc.cinema_hall_id = $1
        AND ($2::date IS NULL OR sh.show_date >= $2)
        AND ($3::date IS NULL OR sh.show_date <= $3)
        AND ($4::text IS NULL OR LOWER(m.title) LIKE '%' || LOWER($4) || '%')
        AND ($5::text IS NULL OR b.booking_status = $5)
        AND ($6::uuid IS NULL OR sc.id = $6)
    `, [cinema_hall_id, from_date || null, to_date || null, search || null, status || null, screen_id || null]);

        const statsResult = await db.query(`
      SELECT
        COALESCE(SUM(b.total_amount),    0)::numeric AS total_revenue,
        COALESCE(SUM(b.convenience_fee), 0)::numeric AS total_convenience_fee,
        COALESCE(SUM(b.gst_amount),      0)::numeric AS total_gst
      FROM bookings b
      JOIN shows sh  ON sh.id = b.show_id
      JOIN movies m  ON m.id  = sh.movie_id
      JOIN screens sc ON sc.id = sh.screen_id
      WHERE sc.cinema_hall_id = $1
        AND ($2::date IS NULL OR sh.show_date >= $2)
        AND ($3::date IS NULL OR sh.show_date <= $3)
        AND ($4::text IS NULL OR LOWER(m.title) LIKE '%' || LOWER($4) || '%')
        AND ($5::text IS NULL OR b.booking_status = $5)
        AND ($6::uuid IS NULL OR sc.id = $6)
    `, [cinema_hall_id, from_date || null, to_date || null, search || null, status || null, screen_id || null]);

        const stats = statsResult.rows[0];
        return res.status(200).json({
            bookings: result.rows,
            total: parseInt(countResult.rows[0].total),
            page: parseInt(page),
            stats: {
                total_revenue: parseFloat(stats.total_revenue),
                total_convenience_fee: parseFloat(stats.total_convenience_fee),
                total_gst: parseFloat(stats.total_gst),
            },
        });
    } catch (error) {
        logger.error("❌ Get cinema hall bookings error:", { error });
        return res.status(500).json({ error: "Failed to fetch bookings" });
    }
};


/**
 * ✅ VERIFY BOOKING BY ID - Admin looks up a booking by its UUID (QR code scan)
 *
 * GET /api/booking/admin/verify/:booking_id
 * Auth: Admin + Cinema Hall required
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const verifyBookingById = async (req, res) => {
    const { booking_id } = req.params;
    const cinema_hall_id = req.currentHallId;

    if (!UUID_REGEX.test(booking_id)) {
        return res.status(400).json({ error: "Invalid booking ID format" });
    }

    try {
        const result = await db.query(`
      SELECT
        b.*,
        m.title AS movie_title,
        sh.show_date,
        sh.start_time,
        sc.name AS screen_name,
        c.name AS customer_name,
        c.email AS customer_email,
        ARRAY(
          SELECT (seat_data->>'row') || (seat_data->>'column')
          FROM jsonb_array_elements(sc.layout->'seats') AS seat_data
          WHERE seat_data->>'id' IN (SELECT jsonb_array_elements_text(b.seats))
        ) AS seat_labels,
        r.id AS refund_id,
        r.refund_status,
        r.razorpay_refund_id,
        r.amount AS refund_amount,
        r.initiated_at AS refund_initiated_at,
        r.settled_at AS refund_settled_at,
        r.failure_reason AS refund_failure_reason
      FROM bookings b
      JOIN shows sh ON sh.id = b.show_id
      JOIN movies m ON m.id = sh.movie_id
      JOIN screens sc ON sc.id = sh.screen_id
      JOIN customers c ON c.id = b.customer_id
      LEFT JOIN refunds r ON r.booking_id = b.id
      WHERE b.id = $1 AND sc.cinema_hall_id = $2
    `, [booking_id, cinema_hall_id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Booking not found" });
        }

        return res.status(200).json({ booking: result.rows[0] });
    } catch (error) {
        logger.error("❌ Verify booking error:", { error });
        return res.status(500).json({ error: "Failed to verify booking" });
    }
};


/**
 * ✅ GET BOOKING DETAILS BY ID - Customer views a single booking
 *
 * GET /api/booking/:booking_id
 * Auth: Customer required
 */
export const getBookingDetails = async (req, res) => {
    const { booking_id } = req.params;
    const customer_id = req.customer.id;

    if (!UUID_REGEX.test(booking_id)) {
        return res.status(400).json({ error: "Invalid booking ID format" });
    }

    try {
        const result = await db.query(`
      SELECT
        b.*,
        m.title AS movie_title,
        m.poster_url,
        m.duration_mins,
        m.genre,
        sh.language_version AS language,
        sh.show_date,
        sh.start_time,
        sc.name AS screen_name,
        ch.name AS cinema_hall_name,
        ch.location AS cinema_hall_location,
        ch.latitude AS cinema_hall_latitude,
        ch.longitude AS cinema_hall_longitude,
        ARRAY(
          SELECT (seat_data->>'row') || (seat_data->>'column')
          FROM jsonb_array_elements(sc.layout->'seats') AS seat_data
          WHERE seat_data->>'id' IN (SELECT jsonb_array_elements_text(b.seats))
        ) AS seat_labels,
        r.refund_status,
        r.razorpay_refund_id,
        r.amount AS refund_amount,
        r.initiated_at AS refund_initiated_at,
        r.settled_at AS refund_settled_at,
        r.failure_reason AS refund_failure_reason
      FROM bookings b
      JOIN shows sh ON sh.id = b.show_id
      JOIN movies m ON m.id = sh.movie_id
      JOIN screens sc ON sc.id = sh.screen_id
      JOIN cinema_hall ch ON ch.id = sc.cinema_hall_id
      LEFT JOIN refunds r ON r.booking_id = b.id
      WHERE b.id = $1 AND b.customer_id = $2
    `, [booking_id, customer_id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Booking not found" });
        }

        return res.status(200).json({ booking: result.rows[0] });
    } catch (error) {
        logger.error("❌ Get booking details error:", { error });
        return res.status(500).json({ error: "Failed to fetch booking" });
    }
};


/**
 * ✅ CLEANUP EXPIRED HOLDS - Called by background job
 *
 * This should be called every 30-60 seconds
 */
export const cleanupExpiredHolds = async () => {
    try {
        const result = await db.query(`
      DELETE FROM show_booked_seats 
      WHERE status = 'HELD' 
        AND hold_expires_at < NOW()
      RETURNING show_id, seat_id;
    `);

        if (result.rowCount > 0) {
            logger.info(`🧹 Cleaned up ${result.rowCount} expired holds`);
        }

        return result.rowCount;
    } catch (error) {
        const transient = ['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'];
        if (transient.includes(error.code)) {
            logger.warn(`⚠️ Cleanup skipped — DB unreachable (${error.code})`);
        } else {
            logger.error('❌ Cleanup error:', { error });
        }
        return 0;
    }
};


