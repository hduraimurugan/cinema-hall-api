import express from "express";
import {
    holdSeats,
    confirmBooking,
    releaseSeats,
    getBookingByPaymentId,
    getMyBookings,
    getBookingDetails,
    getCinemaHallBookings,
    verifyBookingById
} from "../controllers/booking.Controller.js";
import { verifyCustomer, verifyCinemaAdminAccessToken, requireActiveHall } from "../middleware/verifyCinemaAdmin.js";

const router = express.Router();

// Customer routes
router.post("/hold", verifyCustomer, holdSeats);
router.post("/confirm", verifyCustomer, confirmBooking);
router.post("/release", verifyCustomer, releaseSeats);
router.get("/by-payment/:payment_id", verifyCustomer, getBookingByPaymentId);
router.get("/my-bookings", verifyCustomer, getMyBookings);

// Admin routes
router.get("/admin/all", verifyCinemaAdminAccessToken, requireActiveHall, getCinemaHallBookings);
router.get("/admin/verify/:booking_id", verifyCinemaAdminAccessToken, requireActiveHall, verifyBookingById);

// Customer: get single booking by ID (must be last to avoid shadowing other routes)
router.get("/:booking_id", verifyCustomer, getBookingDetails);

export default router;
