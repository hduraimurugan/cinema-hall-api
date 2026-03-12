import express from "express";
import {
    createOrder,
    verifyPayment,
    handleWebhook,
    getPaymentOrders,
} from "../controllers/payment.Controller.js";
import { verifyCustomer, verifyCinemaAdminAccessToken, verifyCinemaHall } from "../middleware/verifyCinemaAdmin.js";

const router = express.Router();

// Customer routes (auth required)
router.post("/create-order", verifyCustomer, createOrder);
router.post("/verify", verifyCustomer, verifyPayment);

// Webhook route (no auth - verified by signature)
router.post("/webhook", handleWebhook);

// Admin routes
router.get("/admin/orders", verifyCinemaAdminAccessToken, verifyCinemaHall, getPaymentOrders);

export default router;
