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
import { requirePermission } from "../middleware/requirePermission.js"

const router = express.Router()

// 👇 protect routes using your cinema admin + screen ownership middleware
router.post("/create", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('shows.create'), verifyScreenOwnership, createShow)
router.post("/bulk", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('shows.create'), verifyScreenOwnership, createMultipleShows)
router.put("/edit/:id", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('shows.update'), verifyScreenOwnership, editShow)

router.delete("/delete/:id", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('shows.delete'), deleteShow)
router.delete("/bulk", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('shows.delete'), deleteMultipleShows)
router.get("/date/:date", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('shows.read'), getShowsByDate)

router.get("/booking-count/:id", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('shows.read'), getShowBookingCount)
router.put("/cancel/:id", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('shows.cancel'), cancelShow)
router.put("/bulk-cancel", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('shows.cancel'), bulkCancelShows)
router.put("/booking-status/:id", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('shows.update'), updateShowBookingStatus)
router.put("/bulk-booking-open", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('shows.update'), bulkOpenBooking)
router.put("/bulk-restore", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('shows.update'), bulkRestoreShows)

router.get("/get/:id", getShowById)
router.post("/book/:showId",bookShow)

export default router
