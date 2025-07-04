import express from "express"
import {
  createShow,
  createMultipleShows,
  editShow,
  deleteShow,
  getShowsByDate,
} from "../controllers/shows.Controller.js"
import { verifyCinemaHall , verifyScreenOwnership } from "../middleware/verifyCinemaAdmin.js"

const router = express.Router()

// 👇 protect routes using your cinema admin + screen ownership middleware
router.post("/create", verifyCinemaHall, verifyScreenOwnership, createShow)
router.post("/bulk", verifyCinemaHall, verifyScreenOwnership, createMultipleShows)
router.put("/edit/:id", verifyCinemaHall, verifyScreenOwnership, editShow)

router.delete("/delete/:id", verifyCinemaHall, deleteShow)
router.get("/date/:date",verifyCinemaHall, getShowsByDate)

export default router
