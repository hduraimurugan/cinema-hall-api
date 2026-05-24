import express from "express"
import { getRefunds, getRefundByBooking, manuallySettleRefund } from "../controllers/refund.Controller.js"
import { verifyCinemaAdminAccessToken, requireActiveHall } from "../middleware/verifyCinemaAdmin.js"

const router = express.Router()

router.get("/", verifyCinemaAdminAccessToken, requireActiveHall, getRefunds)
router.get("/booking/:booking_id", verifyCinemaAdminAccessToken, requireActiveHall, getRefundByBooking)
router.post("/:refund_id/settle", verifyCinemaAdminAccessToken, requireActiveHall, manuallySettleRefund)

export default router
