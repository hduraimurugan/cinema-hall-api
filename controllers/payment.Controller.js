import Razorpay from "razorpay";
import crypto from "crypto";
import db from "../db.js";
import { validateOfferCode } from "./offers.Controller.js";
import logger from '../utils/logger.js';
import { notify, scheduleShowReminder } from '../services/notification/index.js';

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * ✅ CREATE ORDER — Generate Razorpay order before payment
 *
 * POST /api/payment/create-order
 * Body: { show_id, seats: ["seatId1", "seatId2"], offer_code? }
 * Auth: Customer required
 *
 * Idempotency: If an active 'created' order exists for the same
 * customer + show within the last 10 minutes, returns it instead
 * of creating a new Razorpay order. This handles network retries
 * and tab refreshes safely.
 */
export const createOrder = async (req, res) => {
    const { show_id, seats, offer_code } = req.body;
    const customer_id = req.customer.id;

    try {
        // ── Dedup check: return existing active order ───────────
        // Protects against: slow network retry, tab refresh,
        // double-click on "Proceed to Pay" before Razorpay modal opens.
        const existingOrder = await db.query(`
            SELECT *
            FROM payment_orders
            WHERE customer_id = $1
              AND show_id     = $2
              AND status      = 'created'
              AND created_at  > NOW() - INTERVAL '10 minutes'
            ORDER BY created_at DESC
            LIMIT 1
        `, [customer_id, show_id]);

        if (existingOrder.rowCount > 0) {
            const existing = existingOrder.rows[0];
            logger.info(`[createOrder] Returning existing order ${existing.order_id} for customer ${customer_id}`);
            return res.status(200).json({
                order_id:  existing.order_id,
                amount:    Math.round(parseFloat(existing.amount) * 100), // paise
                currency:  "INR",
                key_id:    process.env.RAZORPAY_KEY_ID,
                _idempotent: true, // flag for debugging
            });
        }

        // ── Verify seats are still HELD by this customer ────────
        const holdCheck = await db.query(`
            SELECT seat_id FROM show_booked_seats
            WHERE show_id = $1
              AND seat_id = ANY($2::text[])
              AND held_by = $3
              AND status  = 'HELD'
              AND hold_expires_at > NOW()
        `, [show_id, seats, customer_id]);

        if (holdCheck.rowCount !== seats.length) {
            logger.warn(`[createOrder] Seat hold mismatch for customer ${customer_id}, show ${show_id}. Held: ${holdCheck.rowCount}/${seats.length}`);
            return res.status(400).json({
                error: "Some seats are no longer held. Please select again."
            });
        }

        // ── Fetch show + screen layout for server-side pricing ──
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
        const layoutSeats   = layout?.seats   || [];
        const layoutPricing = layout?.pricing || {};

        const seatTotal = seats.reduce((sum, seatId) => {
            const seat = layoutSeats.find(s => s.id === seatId);
            if (!seat) return sum;
            const price = price_override?.[seat.type]
                ? parseFloat(price_override[seat.type]) || 0
                : parseFloat(layoutPricing[seat.type])  || 0;
            return sum + price;
        }, 0);

        // ── Fetch convenience fee and GST from organization settings ─────────
        let paymentVal = {};
        try {
            const orgResult = await db.query(`
                SELECT ch.org_id
                FROM shows s
                JOIN screens sc ON sc.id = s.screen_id
                JOIN cinema_hall ch ON ch.id = sc.cinema_hall_id
                WHERE s.id = $1
            `, [show_id]);

            let orgId = orgResult.rows[0]?.org_id;
            let settingsResult;

            if (orgId) {
                settingsResult = await db.query(
                    `SELECT value FROM organization_settings WHERE org_id = $1 AND section = 'payment'`,
                    [orgId]
                );
            }

            if (settingsResult && settingsResult.rows.length > 0) {
                paymentVal = settingsResult.rows[0].value || {};
            } else {
                const fallbackResult = await db.query(
                    `SELECT value FROM organization_settings WHERE section = 'payment' LIMIT 1`
                );
                paymentVal = fallbackResult.rows[0]?.value || {};
            }
        } catch (settingsErr) {
            logger.error('Failed to resolve organization settings, using defaults:', { error: settingsErr.message });
        }

        const convenienceFeePerTicket = parseFloat(paymentVal.convenience_fee?.amount ?? 15);
        const gstPercentage           = parseFloat(paymentVal.gst_percentage ?? 18);

        const convenienceTotal = seats.length * convenienceFeePerTicket;
        const gstAmount        = convenienceTotal * (gstPercentage / 100);
        const grandTotal       = seatTotal + convenienceTotal + gstAmount;

        // ── Apply offer discount (server-side validated) ────────
        let discountAmount    = 0;
        let validatedOfferCode = null;
        if (offer_code) {
            try {
                const offerResult = await validateOfferCode({
                    offer_code,
                    show_id,
                    total_amount: grandTotal,
                    customer_id,
                });
                discountAmount     = offerResult.discountAmount;
                validatedOfferCode = offerResult.offer.code;
            } catch (offerError) {
                return res.status(offerError.status || 400).json({ error: offerError.message });
            }
        }

        const finalAmount = +(grandTotal - discountAmount).toFixed(2);

        // ── Create Razorpay order ────────────────────────────────
        let order;
        try {
            order = await razorpay.orders.create({
                amount:   Math.round(finalAmount * 100), // Razorpay expects paise
                currency: "INR",
                receipt:  `TKT-${Date.now()}-${customer_id.substring(0, 8)}`, // Max 40 chars
                notes: {
                    show_id,
                    customer_id,
                    seats: seats.join(",")
                }
            });
        } catch (rzpErr) {
            const statusCode  = rzpErr?.statusCode;
            const description = rzpErr?.error?.description || rzpErr?.error?.code || rzpErr?.message;
            logger.error("❌ Razorpay order creation failed:", { statusCode: statusCode ?? "network error", description: description ?? rzpErr });
            return res.status(502).json({ error: "Payment gateway error. Please try again." });
        }

        // ── Persist order in DB (amount in rupees) ──────────────
        await db.query(`
            INSERT INTO payment_orders
              (order_id, show_id, customer_id, seats, amount, convenience_fee, gst_amount, offer_code, discount_amount, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'created')
        `, [order.id, show_id, customer_id, JSON.stringify(seats), finalAmount,
            convenienceTotal, gstAmount, validatedOfferCode, discountAmount]);

        return res.status(200).json({
            order_id: order.id,
            amount:   order.amount,
            currency: order.currency,
            key_id:   process.env.RAZORPAY_KEY_ID,
        });

    } catch (error) {
        logger.error("❌ Create order error:", { error: error.message || error });
        return res.status(500).json({ error: "Failed to create order" });
    }
};


/**
 * ✅ VERIFY PAYMENT — Called after Razorpay checkout success
 *
 * POST /api/payment/verify
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Auth: Customer required
 *
 * Idempotency:
 *   - If the order is already 'paid', return the existing booking immediately.
 *   - The bookings INSERT uses ON CONFLICT (payment_id) DO NOTHING, so a
 *     concurrent duplicate call that races past the pre-check is still safe.
 *   - DB-level UNIQUE(payment_id) on bookings is the final backstop.
 */
export const verifyPayment = async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const customer_id = req.customer.id;
    let isRecreatedIdempotent = false;

    try {
        // ── Step 1: Verify Razorpay signature (cryptographic) ───
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            logger.warn(`[verifyPayment] Invalid signature for order ${razorpay_order_id}`);
            return res.status(400).json({ error: "Invalid payment signature" });
        }

        // ── Step 2: Fetch order from DB ──────────────────────────
        const orderResult = await db.query(`
            SELECT * FROM payment_orders WHERE order_id = $1
        `, [razorpay_order_id]);

        if (orderResult.rowCount === 0) {
            return res.status(404).json({ error: "Order not found" });
        }

        const order = orderResult.rows[0];
        const seats = Array.isArray(order.seats) ? order.seats : JSON.parse(order.seats);

        // ── Step 3: Idempotency pre-check ───────────────────────
        // If this order was already processed (e.g. network timeout caused
        // the frontend to call /verify again), return the existing booking.
        if (order.status === 'paid') {
            logger.info(`[verifyPayment] Idempotent return — order ${razorpay_order_id} already paid`);
            const existingBooking = await db.query(
                `SELECT * FROM bookings WHERE payment_id = $1`,
                [razorpay_payment_id]
            );
            if (existingBooking.rowCount > 0) {
                return res.status(200).json({
                    success:  true,
                    message:  "Payment already verified — booking confirmed!",
                    booking:  existingBooking.rows[0],
                    _idempotent: true,
                });
            }
            logger.warn(`[verifyPayment] Order ${razorpay_order_id} is marked 'paid' but booking was missing. Re-creating booking.`);
            isRecreatedIdempotent = true;
        }

        // ── Step 4: Atomic booking confirmation ─────────────────
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            // Update seats to BOOKED (only if still HELD by this customer)
            await client.query(`
                UPDATE show_booked_seats
                SET status = 'BOOKED', booked_at = NOW(), hold_expires_at = NULL
                WHERE show_id = $1
                  AND seat_id  = ANY($2::text[])
                  AND held_by  = $3
            `, [order.show_id, seats, customer_id]);

            // Insert booking row.
            // ON CONFLICT (payment_id) DO NOTHING is the concurrency safety net:
            // if two verify calls race through the pre-check above simultaneously,
            // only one INSERT will succeed. The loser gets 0 rows back and fetches
            // the winner's row below.
            const bookingResult = await client.query(`
                INSERT INTO bookings
                  (show_id, customer_id, seats, total_amount, payment_status, payment_id,
                   convenience_fee, gst_amount, offer_code, discount_amount)
                VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7, $8, $9)
                ON CONFLICT (payment_id) DO NOTHING
                RETURNING *
            `, [order.show_id, customer_id, JSON.stringify(seats), order.amount, razorpay_payment_id,
                order.convenience_fee || 0, order.gst_amount || 0,
                order.offer_code || null, order.discount_amount || 0]);

            // If INSERT returned 0 rows, a concurrent call already created the booking.
            // Fetch the existing booking and return it.
            let booking;
            if (bookingResult.rowCount === 0) {
                logger.warn(`[verifyPayment] ON CONFLICT hit for payment_id ${razorpay_payment_id} — concurrent duplicate, returning existing booking`);
                const fallback = await client.query(
                    `SELECT * FROM bookings WHERE payment_id = $1`,
                    [razorpay_payment_id]
                );
                booking = fallback.rows[0];
            } else {
                booking = bookingResult.rows[0];
            }

            // Update payment order status
            await client.query(`
                UPDATE payment_orders
                SET status = 'paid', payment_id = $2, payment_signature = $3, updated_at = NOW()
                WHERE order_id = $1
            `, [razorpay_order_id, razorpay_payment_id, razorpay_signature]);

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
                    `, [offerLookup.rows[0].id, customer_id, booking.id, order.discount_amount]);
                }
            }

            await client.query('COMMIT');

            // Notify only if this call actually created the booking row —
            // bookingResult.rowCount === 0 means a concurrent call won the
            // ON CONFLICT race and will send its own notification.
            // Called after COMMIT, never inside the transaction: a notification
            // failure must never turn a successful payment into a 500 — notify()
            // and scheduleShowReminder() catch all their own errors internally.
            if (bookingResult.rowCount > 0) {
                try {
                    const detailsResult = await db.query(`
                        SELECT m.title AS movie_title, sh.show_date, sh.start_time,
                               ch.name AS cinema_hall_name, ch.org_id,
                               ARRAY(
                                   SELECT (seat_data->>'row') || (seat_data->>'column')
                                   FROM jsonb_array_elements(sc.layout->'seats') AS seat_data
                                   WHERE seat_data->>'id' = ANY($2::text[])
                               ) AS seat_labels
                        FROM shows sh
                        JOIN movies m ON m.id = sh.movie_id
                        JOIN screens sc ON sc.id = sh.screen_id
                        JOIN cinema_hall ch ON ch.id = sc.cinema_hall_id
                        WHERE sh.id = $1
                    `, [order.show_id, seats]);
                    const details = detailsResult.rows[0];

                    if (details) {
                        const recipient = { type: 'customer', id: customer_id, orgId: details.org_id };
                        const notifyData = {
                            bookingId: booking.id,
                            showId: order.show_id,
                            movieTitle: details.movie_title,
                            cinemaHallName: details.cinema_hall_name,
                            showDate: details.show_date,
                            startTime: details.start_time,
                            seats: details.seat_labels,
                            amount: booking.total_amount,
                        };
                        await notify('booking_confirmed', recipient, notifyData);
                        // show_date/start_time are IST wall-clock values with no
                        // offset in the DB (no DST in India, so the offset is
                        // always fixed) — an explicit +05:30 in the ISO string
                        // gives the correct UTC instant without depending on the
                        // Postgres session's TimeZone setting or node-postgres's
                        // default (non-UTC) timestamp parsing.
                        const showDateTime = new Date(`${details.show_date}T${details.start_time}+05:30`);
                        await scheduleShowReminder({
                            bookingId: booking.id,
                            showId: order.show_id,
                            customerId: customer_id,
                            orgId: details.org_id,
                            movieTitle: details.movie_title,
                            seats: details.seat_labels,
                            showDateTime,
                        });
                    }
                } catch (notifyError) {
                    logger.error('[verifyPayment] Notification dispatch failed (non-fatal)', { message: notifyError.message });
                }
            }

            return res.status(200).json({
                success: true,
                message: isRecreatedIdempotent
                    ? "Payment already verified — booking confirmed!"
                    : "Payment verified and booking confirmed!",
                booking,
                ...(isRecreatedIdempotent ? { _idempotent: true } : {}),
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        logger.error("❌ Verify payment error:", { error });
        return res.status(500).json({ error: "Payment verification failed" });
    }
};


/**
 * ✅ WEBHOOK HANDLER — Razorpay sends events here
 *
 * POST /api/payment/webhook
 * No customer auth — verified by HMAC signature.
 *
 * Idempotency:
 *   - Deduplicates by X-Razorpay-Event-Id header (Razorpay's idempotency key).
 *   - Falls back to SHA-256 of raw body if header is absent.
 *   - Uses INSERT … ON CONFLICT DO NOTHING into webhook_events table.
 *   - handlePaymentCaptured uses SELECT FOR UPDATE to serialize concurrent
 *     deliveries of the same event.
 *
 * NOTE: This route receives req.body as a Buffer (raw bytes) because
 * express.raw() is applied in the route definition. Do NOT call
 * JSON.parse on it before computing the HMAC — use the raw bytes.
 */
export const handleWebhook = async (req, res) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature     = req.headers["x-razorpay-signature"];

    // req.body is a Buffer here (express.raw middleware on this route)
    const rawBody = req.body;

    // ── Step 1: Verify webhook signature ────────────────────────
    const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");

    if (expectedSignature !== signature) {
        logger.error("❌ Invalid webhook signature");
        return res.status(400).json({ error: "Invalid signature" });
    }

    // Parse body after signature verification
    let parsedBody;
    try {
        parsedBody = JSON.parse(rawBody.toString('utf8'));
    } catch {
        logger.error("❌ Webhook body is not valid JSON");
        return res.status(400).json({ error: "Invalid JSON body" });
    }

    const event   = parsedBody.event;
    const payload = parsedBody.payload;

    // ── Step 2: Deduplicate webhook events ───────────────────────
    // Razorpay sends X-Razorpay-Event-Id as their idempotency key.
    // If absent (older SDK), fall back to SHA-256 of the raw body.
    const eventId = req.headers["x-razorpay-event-id"]
        || crypto.createHash("sha256").update(rawBody).digest("hex");

    const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");

    try {
        const dedup = await db.query(`
            INSERT INTO webhook_events (event_id, event_type, payload_hash)
            VALUES ($1, $2, $3)
            ON CONFLICT (event_id) DO NOTHING
            RETURNING id
        `, [eventId, event || 'unknown', payloadHash]);

        if (dedup.rowCount === 0) {
            // This event was already processed — return 200 immediately
            // so Razorpay stops retrying.
            logger.info(`[webhook] Duplicate event skipped: ${event} (id: ${eventId})`);
            return res.status(200).json({ received: true, _duplicate: true });
        }
    } catch (dedupError) {
        // If dedup table insert fails, log and continue processing.
        // It is safer to risk processing twice than to reject a real event.
        logger.error("[webhook] Dedup insert failed — processing anyway:", { error: dedupError });
    }

    logger.info(`📥 Webhook received: ${event} (id: ${eventId})`);

    try {
        switch (event) {
            case "payment.captured":
                await handlePaymentCaptured(payload.payment.entity);
                break;

            case "payment.failed":
                await handlePaymentFailed(payload.payment.entity);
                break;

            case "order.paid":
                // Backup confirmation path
                await handleOrderPaid(payload.order.entity);
                break;

            case "refund.processed": {
                const settledResult = await db.query(
                    `UPDATE refunds SET refund_status = 'settled', settled_at = NOW()
                     WHERE razorpay_refund_id = $1
                     RETURNING id, booking_id, amount`,
                    [payload.refund.entity.id]
                );
                logger.info(`✅ Refund settled: ${payload.refund.entity.id}`);

                const settledRefund = settledResult.rows[0];
                if (settledRefund) {
                    try {
                        const bookingResult = await db.query(
                            `SELECT b.customer_id, m.title AS movie_title, ch.org_id
                             FROM bookings b
                             JOIN shows sh ON sh.id = b.show_id
                             JOIN movies m ON m.id = sh.movie_id
                             JOIN screens sc ON sc.id = sh.screen_id
                             JOIN cinema_hall ch ON ch.id = sc.cinema_hall_id
                             WHERE b.id = $1`,
                            [settledRefund.booking_id]
                        );
                        const bookingInfo = bookingResult.rows[0];
                        if (bookingInfo) {
                            await notify(
                                'refund_settled',
                                { type: 'customer', id: bookingInfo.customer_id, orgId: bookingInfo.org_id },
                                { bookingId: settledRefund.booking_id, refundId: settledRefund.id, movieTitle: bookingInfo.movie_title, amount: settledRefund.amount }
                            );
                        }
                    } catch (notifyError) {
                        logger.error('[webhook refund.processed] Notification dispatch failed (non-fatal)', { message: notifyError.message });
                    }
                }
                break;
            }

            case "refund.failed":
                await db.query(
                    `UPDATE refunds SET refund_status = 'failed', failure_reason = $1
                     WHERE razorpay_refund_id = $2`,
                    [payload.refund.entity.description || 'Refund failed', payload.refund.entity.id]
                );
                logger.warn(`❌ Refund failed: ${payload.refund.entity.id}`);
                break;

            default:
                logger.warn(`[webhook] Unhandled event type: ${event}`);
        }

        return res.status(200).json({ received: true });

    } catch (error) {
        logger.error("❌ Webhook processing error:", { error });
        // Return 500 so Razorpay retries — our dedup table will prevent
        // re-processing if the event was already committed.
        return res.status(500).json({ error: "Webhook processing failed" });
    }
};


/**
 * Handle successful payment capture (webhook backup path).
 *
 * Uses SELECT FOR UPDATE on payment_orders to serialize concurrent
 * webhook deliveries. If verifyPayment already processed this order,
 * the status will be 'paid' and we return early without re-inserting.
 */
async function handlePaymentCaptured(payment) {
    const orderId = payment.order_id;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Lock the payment order row to prevent concurrent webhook deliveries
        // from both seeing status = 'created' and both trying to write.
        const orderResult = await client.query(`
            SELECT * FROM payment_orders
            WHERE order_id = $1
            FOR UPDATE
        `, [orderId]);

        if (orderResult.rowCount === 0) {
            await client.query('ROLLBACK');
            logger.warn(`[webhook] Order ${orderId} not found in DB`);
            return;
        }

        const order = orderResult.rows[0];

        // Idempotency: if verifyPayment already handled this, skip.
        if (order.status === 'paid') {
            await client.query('ROLLBACK');
            logger.info(`[webhook] Order ${orderId} already paid — skipping`);
            return;
        }

        const seats = Array.isArray(order.seats) ? order.seats : JSON.parse(order.seats);

        // Update seats to BOOKED
        await client.query(`
            UPDATE show_booked_seats
            SET status = 'BOOKED', booked_at = NOW(), hold_expires_at = NULL
            WHERE show_id = $1
              AND seat_id  = ANY($2::text[])
              AND status   = 'HELD'
        `, [order.show_id, seats]);

        // Insert booking row (idempotent via ON CONFLICT)
        const bookingResult = await client.query(`
            INSERT INTO bookings
              (show_id, customer_id, seats, total_amount, payment_status, payment_id,
               convenience_fee, gst_amount, offer_code, discount_amount)
            VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7, $8, $9)
            ON CONFLICT (payment_id) DO NOTHING
            RETURNING *
        `, [order.show_id, order.customer_id, JSON.stringify(seats), order.amount, payment.id,
            order.convenience_fee || 0, order.gst_amount || 0,
            order.offer_code || null, order.discount_amount || 0]);

        const booking = bookingResult.rowCount > 0
            ? bookingResult.rows[0]
            : (await client.query(`SELECT * FROM bookings WHERE payment_id = $1`, [payment.id])).rows[0];

        // Update payment order status
        await client.query(`
            UPDATE payment_orders
            SET status = 'paid', payment_id = $2, updated_at = NOW()
            WHERE order_id = $1
        `, [orderId, payment.id]);

        // Record offer redemption if an offer was applied
        if (order.offer_code && booking) {
            const offerLookup = await client.query(
                `SELECT id FROM offers WHERE code = $1`,
                [order.offer_code]
            );
            if (offerLookup.rowCount > 0) {
                await client.query(`
                    INSERT INTO offer_redemptions (offer_id, customer_id, booking_id, discount_applied)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (offer_id, customer_id) DO NOTHING
                `, [offerLookup.rows[0].id, order.customer_id, booking.id, order.discount_amount]);
            }
        }

        await client.query('COMMIT');
        logger.info(`✅ Webhook: Order ${orderId} confirmed and booking created via payment.captured`);

        // Notify only if this call actually created the booking row —
        // rowCount === 0 means verifyPayment (or a prior webhook delivery)
        // already created it and already sent this notification.
        if (bookingResult.rowCount > 0) {
            try {
                const detailsResult = await db.query(`
                    SELECT m.title AS movie_title, sh.show_date, sh.start_time,
                           ch.name AS cinema_hall_name, ch.org_id,
                           ARRAY(
                               SELECT (seat_data->>'row') || (seat_data->>'column')
                               FROM jsonb_array_elements(sc.layout->'seats') AS seat_data
                               WHERE seat_data->>'id' = ANY($2::text[])
                           ) AS seat_labels
                    FROM shows sh
                    JOIN movies m ON m.id = sh.movie_id
                    JOIN screens sc ON sc.id = sh.screen_id
                    JOIN cinema_hall ch ON ch.id = sc.cinema_hall_id
                    WHERE sh.id = $1
                `, [order.show_id, seats]);
                const details = detailsResult.rows[0];

                if (details) {
                    const recipient = { type: 'customer', id: order.customer_id, orgId: details.org_id };
                    await notify('booking_confirmed', recipient, {
                        bookingId: booking.id,
                        showId: order.show_id,
                        movieTitle: details.movie_title,
                        cinemaHallName: details.cinema_hall_name,
                        showDate: details.show_date,
                        startTime: details.start_time,
                        seats: details.seat_labels,
                        amount: booking.total_amount,
                    });
                    const showDateTime = new Date(`${details.show_date}T${details.start_time}+05:30`);
                    await scheduleShowReminder({
                        bookingId: booking.id,
                        showId: order.show_id,
                        customerId: order.customer_id,
                        orgId: details.org_id,
                        movieTitle: details.movie_title,
                        seats: details.seat_labels,
                        showDateTime,
                    });
                }
            } catch (notifyError) {
                logger.error('[handlePaymentCaptured] Notification dispatch failed (non-fatal)', { message: notifyError.message });
            }
        }

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}


/**
 * Handle failed payment (webhook).
 *
 * Atomically releases held seats using a single query with a subquery
 * instead of the previous SELECT-then-DELETE pattern (which had a TOCTOU race).
 */
async function handlePaymentFailed(payment) {
    const orderId = payment.order_id;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Lock the order row first
        const orderResult = await client.query(`
            SELECT * FROM payment_orders
            WHERE order_id = $1
            FOR UPDATE
        `, [orderId]);

        if (orderResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return;
        }

        const order = orderResult.rows[0];
        const seats = Array.isArray(order.seats) ? order.seats : JSON.parse(order.seats);

        // Update order status to failed
        await client.query(`
            UPDATE payment_orders
            SET status = 'failed', updated_at = NOW()
            WHERE order_id = $1
        `, [orderId]);

        // Atomically release held seats in a single statement.
        // Only deletes seats that are still HELD (not yet BOOKED by a
        // concurrent successful webhook), preventing accidental un-booking.
        const released = await client.query(`
            DELETE FROM show_booked_seats
            WHERE show_id = $1
              AND seat_id  = ANY($2::text[])
              AND status   = 'HELD'
            RETURNING seat_id
        `, [order.show_id, seats]);

        await client.query('COMMIT');
        logger.info(`🔓 Webhook: Released ${released.rowCount} seats for failed order ${orderId}`);

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}


/**
 * Handle order.paid event (backup confirmation path).
 * Delegates to handlePaymentCaptured since the logic is identical.
 */
async function handleOrderPaid(order) {
    logger.info(`📦 order.paid received for order ${order.id}`);
    // order.paid fires after payment.captured in normal flow.
    // handlePaymentCaptured's idempotency guard handles the case where
    // the order is already marked paid from verifyPayment or payment.captured.
    await handlePaymentCaptured({ order_id: order.id, id: order.payment_id });
}


/**
 * ✅ GET PAYMENT ORDERS (Admin) — List all payment orders for the cinema hall
 *
 * GET /api/payment/admin/orders
 * Query: from_date, to_date, status, customer, movie, page
 * Auth: Admin + CinemaHall required
 */
export const getPaymentOrders = async (req, res) => {
    const cinema_hall_id = req.currentHallId;
    const { from_date, to_date, status, customer, movie, page = 1, limit: limitParam = 10 } = req.query;
    const limit  = Math.min(Math.max(parseInt(limitParam) || 10, 1), 100);
    const offset = (parseInt(page) - 1) * limit;

    try {
        const params = [
            cinema_hall_id,
            from_date || null,
            to_date   || null,
            status    || null,
            customer  || null,
            movie     || null,
            offset,
        ];

        const ordersResult = await db.query(`
            SELECT
                po.*,
                c.name  AS customer_name,
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
            JOIN shows sh     ON sh.id = po.show_id
            JOIN movies m     ON m.id  = sh.movie_id
            JOIN screens sc   ON sc.id = sh.screen_id
            WHERE sc.cinema_hall_id = $1
              AND ($2::date IS NULL OR po.created_at::date >= $2::date)
              AND ($3::date IS NULL OR po.created_at::date <= $3::date)
              AND ($4::text IS NULL OR po.status = $4)
              AND ($5::text IS NULL OR LOWER(c.name) LIKE '%' || LOWER($5) || '%' OR LOWER(c.email) LIKE '%' || LOWER($5) || '%')
              AND ($6::text IS NULL OR LOWER(m.title) LIKE '%' || LOWER($6) || '%')
            ORDER BY po.created_at DESC
            LIMIT ${limit} OFFSET $7
        `, params);

        const countResult = await db.query(`
            SELECT COUNT(*) AS total
            FROM payment_orders po
            JOIN customers c ON c.id = po.customer_id
            JOIN shows sh     ON sh.id = po.show_id
            JOIN movies m     ON m.id  = sh.movie_id
            JOIN screens sc   ON sc.id = sh.screen_id
            WHERE sc.cinema_hall_id = $1
              AND ($2::date IS NULL OR po.created_at::date >= $2::date)
              AND ($3::date IS NULL OR po.created_at::date <= $3::date)
              AND ($4::text IS NULL OR po.status = $4)
              AND ($5::text IS NULL OR LOWER(c.name) LIKE '%' || LOWER($5) || '%' OR LOWER(c.email) LIKE '%' || LOWER($5) || '%')
              AND ($6::text IS NULL OR LOWER(m.title) LIKE '%' || LOWER($6) || '%')
        `, params.slice(0, 6));

        return res.status(200).json({
            orders: ordersResult.rows,
            total:  parseInt(countResult.rows[0].total),
            page:   parseInt(page),
        });

    } catch (error) {
        logger.error("❌ Get payment orders error:", { error });
        return res.status(500).json({ error: "Failed to fetch payment orders" });
    }
};
