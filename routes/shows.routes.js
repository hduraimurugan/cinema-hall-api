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
} from "../controllers/shows.Controller.js"
import { verifyCinemaHall , verifyScreenOwnership } from "../middleware/verifyCinemaAdmin.js"

const router = express.Router()

// 👇 protect routes using your cinema admin + screen ownership middleware
router.post("/create", verifyCinemaHall, verifyScreenOwnership, createShow)
router.post("/bulk", verifyCinemaHall, verifyScreenOwnership, createMultipleShows)
router.put("/edit/:id", verifyCinemaHall, verifyScreenOwnership, editShow)

router.delete("/delete/:id", verifyCinemaHall, deleteShow)
router.delete("/bulk", verifyCinemaHall, deleteMultipleShows)
router.get("/date/:date",verifyCinemaHall, getShowsByDate)

router.put("/cancel/:id", verifyCinemaHall, cancelShow)
router.put("/bulk-cancel", verifyCinemaHall, bulkCancelShows)
router.put("/booking-status/:id", verifyCinemaHall, updateShowBookingStatus)
router.put("/bulk-booking-open", verifyCinemaHall, bulkOpenBooking)
router.put("/bulk-restore", verifyCinemaHall, bulkRestoreShows)

router.get("/get/:id", getShowById)
router.post("/book/:showId",bookShow)

export default router
