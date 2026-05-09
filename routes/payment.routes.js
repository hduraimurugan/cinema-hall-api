import express from "express";
import {
    createOrder,
    verifyPayment,
    handleWebhook,
    getPaymentOrders,
} from "../controllers/payment.Controller.js";
import { verifyCustomer, verifyCinemaAdminAccessToken, verifyCinemaHall } from "../middleware/verifyCinemaAdmin.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL: The webhook route MUST receive the raw, unparsed request body.
//
// express.json() is applied globally in server.js, but the /webhook path is
// excluded from it. Instead, express.raw() is applied here so that req.body
// is a Buffer containing the exact bytes Razorpay signed.
//
// If express.json() parses the body first, JSON.stringify(req.body) may not
// reproduce the exact original byte sequence (field order can differ), causing
// HMAC signature verification to fail intermittently in production.
// ─────────────────────────────────────────────────────────────────────────────

// Customer routes (auth required)
router.post("/create-order", verifyCustomer, createOrder);
router.post("/verify",       verifyCustomer, verifyPayment);

// Webhook route — NO customer auth, verified by HMAC signature.
// express.raw() parses body as Buffer for accurate signature verification.
router.post(
    "/webhook",
    express.raw({ type: "*/*" }), // accept any content-type, always buffer
    handleWebhook
);

// Admin routes
router.get("/admin/orders", verifyCinemaAdminAccessToken, verifyCinemaHall, getPaymentOrders);

export default router;
