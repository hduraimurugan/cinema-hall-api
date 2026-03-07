import express from "express";
import {
    holdSeats,
    confirmBooking,
    releaseSeats,
    getBookingByPaymentId
} from "../controllers/booking.Controller.js";
import { verifyCustomer } from "../middleware/verifyCinemaAdmin.js";

const router = express.Router();

// All routes require customer authentication
router.post("/hold", verifyCustomer, holdSeats);
router.post("/confirm", verifyCustomer, confirmBooking);
router.post("/release", verifyCustomer, releaseSeats);
router.get("/by-payment/:payment_id", verifyCustomer, getBookingByPaymentId);

export default router;
