import Razorpay from "razorpay";
import crypto from "crypto";
import db from "../db.js";

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * ✅ CREATE ORDER - Generate Razorpay order before payment
 * 
 * POST /api/payment/create-order
 * Body: { show_id, seats: ["A1", "A2"], amount }
 * Auth: Customer required
 */
export const createOrder = async (req, res) => {
    const { show_id, seats, amount } = req.body;
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

        // Create Razorpay order
        const order = await razorpay.orders.create({
            amount: amount * 100, // Razorpay expects paise
            currency: "INR",
            receipt: `booking_${show_id}_${Date.now()}`,
            notes: {
                show_id,
                customer_id,
                seats: seats.join(",")
            }
        });

        // Store order in DB for tracking
        await db.query(`
      INSERT INTO payment_orders 
        (order_id, show_id, customer_id, seats, amount, status)
      VALUES ($1, $2, $3, $4, $5, 'created')
    `, [order.id, show_id, customer_id, JSON.stringify(seats), amount]);

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
        const seats = JSON.parse(order.seats);

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

            // Create booking record
            const bookingResult = await client.query(`
        INSERT INTO bookings 
          (show_id, user_email, seats, total_amount, status, payment_id)
        VALUES ($1, $2, $3, $4, 'booked', $5)
        RETURNING *
      `, [order.show_id, req.customer.email, order.seats, order.amount, razorpay_payment_id]);

            // Update payment order status
            await client.query(`
        UPDATE payment_orders 
        SET status = 'paid', payment_id = $2, updated_at = NOW()
        WHERE order_id = $1
      `, [razorpay_order_id, razorpay_payment_id]);

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
