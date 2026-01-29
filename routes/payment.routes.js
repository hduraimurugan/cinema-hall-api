import express from "express";
import {
    createOrder,
    verifyPayment,
    handleWebhook
} from "../controllers/payment.Controller.js";
import { verifyCustomer } from "../middleware/verifyCinemaAdmin.js";

const router = express.Router();

// Customer routes (auth required)
router.post("/create-order", verifyCustomer, createOrder);
router.post("/verify", verifyCustomer, verifyPayment);

// Webhook route (no auth - verified by signature)
router.post("/webhook", handleWebhook);

export default router;
