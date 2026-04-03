import Razorpay from "razorpay";
import crypto from "crypto";
import db from "../db.js";
import { validateOfferCode } from "./offers.Controller.js";

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * ✅ CREATE ORDER - Generate Razorpay order before payment
 *
 * POST /api/payment/create-order
 * Body: { show_id, seats: ["seatId1", "seatId2"] }
 * Auth: Customer required
 * Amount is calculated server-side (not trusted from frontend)
 */
export const createOrder = async (req, res) => {
    const { show_id, seats, offer_code } = req.body;
    const customer_id = req.customer.id;

    try {
        // Verify seats are still held by this customer
        const holdCheck = await db.query(`
      SELECT seat_id FROM show_booked_seats
      WHERE show_id = $1
        AND seat_id = ANY($2::text[])
        AND held_by = $3
        AND status = 'HELD'
        AND hold_expires_at > NOW()
    `, [show_id, seats, customer_id]);

        if (holdCheck.rowCount !== seats.length) {
            return res.status(400).json({
                error: "Some seats are no longer held. Please select again."
            });
        }

        // Fetch show + screen layout to calculate seat prices server-side
        const showResult = await db.query(`
      SELECT s.price_override, sc.layout
      FROM shows s
      JOIN screens sc ON sc.id = s.screen_id
      WHERE s.id = $1
    `, [show_id]);

        if (showResult.rowCount === 0) {
            return res.status(404).json({ error: "Show not found" });
        }

        const { price_override, layout } = showResult.rows[0];
        const layoutSeats = layout?.seats || [];
        const layoutPricing = layout?.pricing || {};

        const seatTotal = seats.reduce((sum, seatId) => {
            const seat = layoutSeats.find(s => s.id === seatId);
            if (!seat) return sum;
            const price = price_override?.[seat.type]
                ? parseFloat(price_override[seat.type]) || 0
                : parseFloat(layoutPricing[seat.type]) || 0;
            return sum + price;
        }, 0);

        // Fetch convenience fee and GST from settings
        const settingsResult = await db.query(
            `SELECT key, value FROM settings WHERE key IN ('convenience_fee_per_ticket', 'gst_percentage')`
        );
        const settingsMap = {};
        settingsResult.rows.forEach(({ key, value }) => {
            settingsMap[key] = parseFloat(value) || 0;
        });
        const convenienceFeePerTicket = settingsMap['convenience_fee_per_ticket'] ?? 15;
        const gstPercentage = settingsMap['gst_percentage'] ?? 18;

        const convenienceTotal = seats.length * convenienceFeePerTicket;
        const gstAmount = convenienceTotal * (gstPercentage / 100);
        const grandTotal = seatTotal + convenienceTotal + gstAmount;

        // Apply offer discount if offer_code is provided (validated server-side)
        let discountAmount = 0;
        let validatedOfferCode = null;
        if (offer_code) {
            try {
                const offerResult = await validateOfferCode({
                    offer_code,
                    show_id,
                    total_amount: grandTotal,
                    customer_id,
                });
                discountAmount = offerResult.discountAmount;
                validatedOfferCode = offerResult.offer.code;
            } catch (offerError) {
                return res.status(offerError.status || 400).json({ error: offerError.message });
            }
        }

        const finalAmount = +(grandTotal - discountAmount).toFixed(2);

        // Create Razorpay order with server-calculated amount
        let order;
        try {
            order = await razorpay.orders.create({
                amount: Math.round(finalAmount * 100), // Razorpay expects paise
                currency: "INR",
                receipt: `TKT-${Date.now()}-${customer_id.substring(0, 8)}`, // Max 40 chars
                notes: {
                    show_id,
                    customer_id,
                    seats: seats.join(",")
                }
            });
        } catch (rzpErr) {
            // SDK throws { statusCode, error } for HTTP errors, or a TypeError for network failures
            const statusCode = rzpErr?.statusCode;
            const description = rzpErr?.error?.description || rzpErr?.error?.code || rzpErr?.message;
            console.error("❌ Razorpay order creation failed:", statusCode ?? "network error", description ?? rzpErr);
            return res.status(502).json({ error: "Payment gateway error. Please try again." });
        }

        // Store order in DB for tracking (amount in rupees)
        await db.query(`
      INSERT INTO payment_orders
        (order_id, show_id, customer_id, seats, amount, convenience_fee, gst_amount, offer_code, discount_amount, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'created')
    `, [order.id, show_id, customer_id, JSON.stringify(seats), finalAmount,
        convenienceTotal, gstAmount, validatedOfferCode, discountAmount]);

        return res.status(200).json({
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            key_id: process.env.RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error("❌ Create order error:", error);
        return res.status(500).json({ error: "Failed to create order" });
    }
};


/**
 * ✅ VERIFY PAYMENT - Called after Razorpay checkout success
 * 
 * POST /api/payment/verify
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Auth: Customer required
 */
export const verifyPayment = async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const customer_id = req.customer.id;

    try {
        // Step 1: Verify signature
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ error: "Invalid payment signature" });
        }

        // Step 2: Get order details from DB
        const orderResult = await db.query(`
      SELECT * FROM payment_orders WHERE order_id = $1
    `, [razorpay_order_id]);

        if (orderResult.rowCount === 0) {
            return res.status(404).json({ error: "Order not found" });
        }

        const order = orderResult.rows[0];
        // JSONB columns are already parsed by pg driver
        const seats = Array.isArray(order.seats) ? order.seats : JSON.parse(order.seats);

        // Step 3: Confirm booking (atomic)
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            // Update seats to BOOKED
            await client.query(`
        UPDATE show_booked_seats 
        SET status = 'BOOKED', booked_at = NOW(), hold_expires_at = NULL
        WHERE show_id = $1 AND seat_id = ANY($2::text[]) AND held_by = $3
      `, [order.show_id, seats, customer_id]);

            // Create booking record (with offer info if applicable)
            const bookingResult = await client.query(`
        INSERT INTO bookings
          (show_id, customer_id, seats, total_amount, payment_status, payment_id,
           convenience_fee, gst_amount, offer_code, discount_amount)
        VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7, $8, $9)
        RETURNING *
      `, [order.show_id, customer_id, seats, order.amount, razorpay_payment_id,
                order.convenience_fee || 0, order.gst_amount || 0,
                order.offer_code || null, order.discount_amount || 0]);

            // Update payment order status
            await client.query(`
        UPDATE payment_orders
        SET status = 'paid', payment_id = $2, updated_at = NOW()
        WHERE order_id = $1
      `, [razorpay_order_id, razorpay_payment_id]);

            // Record offer redemption if an offer was applied
            if (order.offer_code) {
                const offerLookup = await db.query(
                    `SELECT id FROM offers WHERE code = $1`,
                    [order.offer_code]
                );
                if (offerLookup.rowCount > 0) {
                    await client.query(`
            INSERT INTO offer_redemptions (offer_id, customer_id, booking_id, discount_applied)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (offer_id, customer_id) DO NOTHING
          `, [offerLookup.rows[0].id, customer_id, bookingResult.rows[0].id, order.discount_amount]);
                }
            }

            await client.query('COMMIT');

            return res.status(200).json({
                success: true,
                message: "Payment verified and booking confirmed!",
                booking: bookingResult.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error("❌ Verify payment error:", error);
        return res.status(500).json({ error: "Payment verification failed" });
    }
};


/**
 * ✅ WEBHOOK HANDLER - Razorpay sends events here
 * 
 * POST /api/payment/webhook
 * No auth - verified by signature
 */
export const handleWebhook = async (req, res) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];

    // Step 1: Verify webhook signature
    const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(JSON.stringify(req.body))
        .digest("hex");

    if (expectedSignature !== signature) {
        console.error("❌ Invalid webhook signature");
        return res.status(400).json({ error: "Invalid signature" });
    }

    const event = req.body.event;
    const payload = req.body.payload;

    console.log(`📥 Webhook received: ${event}`);

    try {
        switch (event) {
            case "payment.captured":
                await handlePaymentCaptured(payload.payment.entity);
                break;

            case "payment.failed":
                await handlePaymentFailed(payload.payment.entity);
                break;

            case "order.paid":
                // Order fully paid - backup confirmation
                await handleOrderPaid(payload.order.entity);
                break;

            case "refund.processed":
                // Razorpay confirmed the refund was settled
                await db.query(
                    `UPDATE refunds SET refund_status = 'settled', settled_at = NOW()
                     WHERE razorpay_refund_id = $1`,
                    [payload.refund.entity.id]
                );
                console.log(`✅ Refund settled: ${payload.refund.entity.id}`);
                break;

            case "refund.failed":
                await db.query(
                    `UPDATE refunds SET refund_status = 'failed', failure_reason = $1
                     WHERE razorpay_refund_id = $2`,
                    [payload.refund.entity.description || 'Refund failed', payload.refund.entity.id]
                );
                console.log(`❌ Refund failed: ${payload.refund.entity.id}`);
                break;

            default:
                console.log(`Unhandled event: ${event}`);
        }

        return res.status(200).json({ received: true });

    } catch (error) {
        console.error("❌ Webhook processing error:", error);
        return res.status(500).json({ error: "Webhook processing failed" });
    }
};

// Helper: Handle successful payment
async function handlePaymentCaptured(payment) {
    const orderId = payment.order_id;

    // Check if already processed
    const existing = await db.query(`
    SELECT status FROM payment_orders WHERE order_id = $1
  `, [orderId]);

    if (existing.rows[0]?.status === 'paid') {
        console.log(`Order ${orderId} already processed`);
        return;
    }

    // Get order and confirm booking
    const orderResult = await db.query(`
    SELECT * FROM payment_orders WHERE order_id = $1
  `, [orderId]);

    if (orderResult.rowCount === 0) return;

    const order = orderResult.rows[0];
    const seats = JSON.parse(order.seats);

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        await client.query(`
      UPDATE show_booked_seats 
      SET status = 'BOOKED', booked_at = NOW(), hold_expires_at = NULL
      WHERE show_id = $1 AND seat_id = ANY($2::text[])
    `, [order.show_id, seats]);

        await client.query(`
      UPDATE payment_orders 
      SET status = 'paid', payment_id = $2, updated_at = NOW()
      WHERE order_id = $1
    `, [orderId, payment.id]);

        await client.query('COMMIT');
        console.log(`✅ Webhook: Order ${orderId} confirmed via webhook`);

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Helper: Handle failed payment
async function handlePaymentFailed(payment) {
    const orderId = payment.order_id;

    await db.query(`
    UPDATE payment_orders 
    SET status = 'failed', updated_at = NOW()
    WHERE order_id = $1
  `, [orderId]);

    // Release held seats
    const orderResult = await db.query(`
    SELECT show_id, seats FROM payment_orders WHERE order_id = $1
  `, [orderId]);

    if (orderResult.rowCount > 0) {
        const order = orderResult.rows[0];
        const seats = JSON.parse(order.seats);

        await db.query(`
      DELETE FROM show_booked_seats 
      WHERE show_id = $1 AND seat_id = ANY($2::text[]) AND status = 'HELD'
    `, [order.show_id, seats]);

        console.log(`🔓 Webhook: Released seats for failed order ${orderId}`);
    }
}

// Helper: Handle order paid (backup)
async function handleOrderPaid(order) {
    // Same as handlePaymentCaptured - acts as backup
    console.log(`📦 Order ${order.id} marked as paid`);
}


/**
 * ✅ GET PAYMENT ORDERS (Admin) - List all payment orders for the cinema hall
 *
 * GET /api/payment/admin/orders
 * Query: date, status, customer, movie, page
 * Auth: Admin + CinemaHall required
 */
export const getPaymentOrders = async (req, res) => {
    const cinema_hall_id = req.my_cinema_hall?.id || req.my_cinema_hall?.[0]?.id;
    const { date, status, customer, movie, page = 1 } = req.query;
    const limit = 50;
    const offset = (parseInt(page) - 1) * limit;

    try {
        const params = [
            cinema_hall_id,
            date || null,
            status || null,
            customer || null,
            movie || null,
            offset,
        ];

        const ordersResult = await db.query(`
            SELECT
                po.*,
                c.name AS customer_name,
                c.email AS customer_email,
                m.title AS movie_title,
                sh.show_date,
                sh.start_time,
                sc.name AS screen_name,
                ARRAY(
                    SELECT (seat_data->>'row') || (seat_data->>'column')
                    FROM jsonb_array_elements(sc.layout->'seats') AS seat_data
                    WHERE seat_data->>'id' = ANY(ARRAY(SELECT jsonb_array_elements_text(po.seats)))
                ) AS seat_labels
            FROM payment_orders po
            JOIN customers c ON c.id = po.customer_id
            JOIN shows sh ON sh.id = po.show_id
            JOIN movies m ON m.id = sh.movie_id
            JOIN screens sc ON sc.id = sh.screen_id
            WHERE sc.cinema_hall_id = $1
                AND ($2::date IS NULL OR po.created_at::date = $2::date)
                AND ($3::text IS NULL OR po.status = $3)
                AND ($4::text IS NULL OR LOWER(c.name) LIKE '%' || LOWER($4) || '%' OR LOWER(c.email) LIKE '%' || LOWER($4) || '%')
                AND ($5::text IS NULL OR LOWER(m.title) LIKE '%' || LOWER($5) || '%')
            ORDER BY po.created_at DESC
            LIMIT ${limit} OFFSET $6
        `, params);

        const countResult = await db.query(`
            SELECT COUNT(*) AS total
            FROM payment_orders po
            JOIN customers c ON c.id = po.customer_id
            JOIN shows sh ON sh.id = po.show_id
            JOIN movies m ON m.id = sh.movie_id
            JOIN screens sc ON sc.id = sh.screen_id
            WHERE sc.cinema_hall_id = $1
                AND ($2::date IS NULL OR po.created_at::date = $2::date)
                AND ($3::text IS NULL OR po.status = $3)
                AND ($4::text IS NULL OR LOWER(c.name) LIKE '%' || LOWER($4) || '%' OR LOWER(c.email) LIKE '%' || LOWER($4) || '%')
                AND ($5::text IS NULL OR LOWER(m.title) LIKE '%' || LOWER($5) || '%')
        `, params.slice(0, 5));

        return res.status(200).json({
            orders: ordersResult.rows,
            total: parseInt(countResult.rows[0].total),
            page: parseInt(page),
        });

    } catch (error) {
        console.error("❌ Get payment orders error:", error);
        return res.status(500).json({ error: "Failed to fetch payment orders" });
    }
};
