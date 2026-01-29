import db from "../db.js";

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
        console.error("❌ Hold seats error:", error);
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
        console.error("❌ Confirm booking error:", error.message);
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
        console.error("❌ Release seats error:", error);
        return res.status(500).json({ error: "Failed to release seats" });
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
            console.log(`🧹 Cleaned up ${result.rowCount} expired holds`);
        }

        return result.rowCount;
    } catch (error) {
        console.error("❌ Cleanup error:", error);
        return 0;
    }
};
