import db from "../db.js";

/**
 * GET /api/refunds
 * Admin: list all refunds for the cinema hall with filters
 * Query: status, page
 */
export const getRefunds = async (req, res) => {
  const cinema_hall_id = req.my_cinema_hall?.id || req.my_cinema_hall?.[0]?.id;
  if (!cinema_hall_id) return res.status(400).json({ error: "Cinema hall not found" });

  const { status, page = 1 } = req.query;
  const limit = 50;
  const offset = (parseInt(page, 10) - 1) * limit;

  const conditions = ["ch.id = $1"];
  const params = [cinema_hall_id];
  let idx = 2;

  if (status && status !== "all") {
    conditions.push(`r.refund_status = $${idx++}`);
    params.push(status);
  }

  const where = conditions.join(" AND ");

  try {
    const [dataResult, countResult] = await Promise.all([
      db.query(
        `SELECT
           r.id AS refund_id,
           r.booking_id,
           r.payment_id,
           r.razorpay_refund_id,
           r.amount,
           r.refund_status,
           r.initiated_at,
           r.settled_at,
           r.failure_reason,
           b.seats,
           m.title AS movie_title,
           sh.show_date,
           sh.start_time,
           sc.name AS screen_name,
           c.name AS customer_name,
           c.email AS customer_email,
           ARRAY(
             SELECT (seat_data->>'row') || (seat_data->>'column')
             FROM jsonb_array_elements(sc.layout->'seats') AS seat_data
             WHERE seat_data->>'id' = ANY(b.seats)
           ) AS seat_labels
         FROM refunds r
         JOIN bookings b ON b.id = r.booking_id
         JOIN shows sh ON sh.id = b.show_id
         JOIN movies m ON m.id = sh.movie_id
         JOIN screens sc ON sc.id = sh.screen_id
         JOIN cinema_hall ch ON ch.id = sc.cinema_hall_id
         JOIN customers c ON c.id = b.customer_id
         WHERE ${where}
         ORDER BY r.initiated_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
      db.query(
        `SELECT COUNT(*) FROM refunds r
         JOIN bookings b ON b.id = r.booking_id
         JOIN shows sh ON sh.id = b.show_id
         JOIN screens sc ON sc.id = sh.screen_id
         JOIN cinema_hall ch ON ch.id = sc.cinema_hall_id
         WHERE ${where}`,
        params
      ),
    ]);

    res.status(200).json({
      refunds: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
    });
  } catch (err) {
    console.error("❌ getRefunds error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/refunds/booking/:booking_id
 * Admin: get refund record for a specific booking
 */
export const getRefundByBooking = async (req, res) => {
  const cinema_hall_id = req.my_cinema_hall?.id || req.my_cinema_hall?.[0]?.id;
  const { booking_id } = req.params;

  try {
    const result = await db.query(
      `SELECT r.*
       FROM refunds r
       JOIN bookings b ON b.id = r.booking_id
       JOIN shows sh ON sh.id = b.show_id
       JOIN screens sc ON sc.id = sh.screen_id
       WHERE r.booking_id = $1 AND sc.cinema_hall_id = $2`,
      [booking_id, cinema_hall_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "No refund found for this booking" });
    }

    res.status(200).json({ refund: result.rows[0] });
  } catch (err) {
    console.error("❌ getRefundByBooking error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/refunds/:refund_id/settle
 * Admin: manually mark a refund as settled
 * Use when Razorpay webhook was missed or in test/offline scenarios
 */
export const manuallySettleRefund = async (req, res) => {
  const cinema_hall_id = req.my_cinema_hall?.id || req.my_cinema_hall?.[0]?.id;
  const { refund_id } = req.params;

  try {
    // Verify the refund belongs to this cinema hall
    const check = await db.query(
      `SELECT r.id, r.refund_status FROM refunds r
       JOIN bookings b ON b.id = r.booking_id
       JOIN shows sh ON sh.id = b.show_id
       JOIN screens sc ON sc.id = sh.screen_id
       WHERE r.id = $1 AND sc.cinema_hall_id = $2`,
      [refund_id, cinema_hall_id]
    );

    if (check.rowCount === 0) {
      return res.status(404).json({ error: "Refund not found or unauthorized" });
    }

    if (check.rows[0].refund_status === "settled") {
      return res.status(400).json({ error: "Refund is already settled" });
    }

    await db.query(
      `UPDATE refunds SET refund_status = 'settled', settled_at = NOW() WHERE id = $1`,
      [refund_id]
    );

    res.status(200).json({ message: "Refund marked as settled" });
  } catch (err) {
    console.error("❌ manuallySettleRefund error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
