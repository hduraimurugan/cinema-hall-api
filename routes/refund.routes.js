import express from "express"
import { getRefunds, getRefundByBooking, manuallySettleRefund } from "../controllers/refund.Controller.js"
import { verifyCinemaHall } from "../middleware/verifyCinemaAdmin.js"

const router = express.Router()

router.get("/", verifyCinemaHall, getRefunds)
router.get("/booking/:booking_id", verifyCinemaHall, getRefundByBooking)
router.post("/:refund_id/settle", verifyCinemaHall, manuallySettleRefund)

export default router
