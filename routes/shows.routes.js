import express from "express"
import {
  createShow,
  createMultipleShows,
  editShow,
  deleteShow,
  deleteMultipleShows,
  getShowsByDate,
  bookShow,
  getShowById,
  cancelShow,
  updateShowBookingStatus,
  bulkCancelShows,
  bulkOpenBooking,
  bulkRestoreShows,
  getShowBookingCount,
} from "../controllers/shows.Controller.js"
import { verifyCinemaAdminAccessToken, requireActiveHall, verifyScreenOwnership } from "../middleware/verifyCinemaAdmin.js"

const router = express.Router()

// 👇 protect routes using your cinema admin + screen ownership middleware
router.post("/create", verifyCinemaAdminAccessToken, requireActiveHall, verifyScreenOwnership, createShow)
router.post("/bulk", verifyCinemaAdminAccessToken, requireActiveHall, verifyScreenOwnership, createMultipleShows)
router.put("/edit/:id", verifyCinemaAdminAccessToken, requireActiveHall, verifyScreenOwnership, editShow)

router.delete("/delete/:id", verifyCinemaAdminAccessToken, requireActiveHall, deleteShow)
router.delete("/bulk", verifyCinemaAdminAccessToken, requireActiveHall, deleteMultipleShows)
router.get("/date/:date", verifyCinemaAdminAccessToken, requireActiveHall, getShowsByDate)

router.get("/booking-count/:id", verifyCinemaAdminAccessToken, requireActiveHall, getShowBookingCount)
router.put("/cancel/:id", verifyCinemaAdminAccessToken, requireActiveHall, cancelShow)
router.put("/bulk-cancel", verifyCinemaAdminAccessToken, requireActiveHall, bulkCancelShows)
router.put("/booking-status/:id", verifyCinemaAdminAccessToken, requireActiveHall, updateShowBookingStatus)
router.put("/bulk-booking-open", verifyCinemaAdminAccessToken, requireActiveHall, bulkOpenBooking)
router.put("/bulk-restore", verifyCinemaAdminAccessToken, requireActiveHall, bulkRestoreShows)

router.get("/get/:id", getShowById)
router.post("/book/:showId",bookShow)

export default router
