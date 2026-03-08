import express from "express";
import {
    holdSeats,
    confirmBooking,
    releaseSeats,
    getBookingByPaymentId,
    getMyBookings,
    getCinemaHallBookings,
    verifyBookingById
} from "../controllers/booking.Controller.js";
import { verifyCustomer, verifyCinemaAdminAccessToken, verifyCinemaHall } from "../middleware/verifyCinemaAdmin.js";

const router = express.Router();

// Customer routes
router.post("/hold", verifyCustomer, holdSeats);
router.post("/confirm", verifyCustomer, confirmBooking);
router.post("/release", verifyCustomer, releaseSeats);
router.get("/by-payment/:payment_id", verifyCustomer, getBookingByPaymentId);
router.get("/my-bookings", verifyCustomer, getMyBookings);

// Admin routes
router.get("/admin/all", verifyCinemaAdminAccessToken, verifyCinemaHall, getCinemaHallBookings);
router.get("/admin/verify/:booking_id", verifyCinemaAdminAccessToken, verifyCinemaHall, verifyBookingById);

export default router;
