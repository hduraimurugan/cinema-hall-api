import express from "express"
import { getRefunds, getRefundByBooking, manuallySettleRefund } from "../controllers/refund.Controller.js"
import { verifyCinemaAdminAccessToken, requireActiveHall } from "../middleware/verifyCinemaAdmin.js"
import { requirePermission } from "../middleware/requirePermission.js"

const router = express.Router()

router.get("/", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('refunds.read'), getRefunds)
router.get("/booking/:booking_id", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('refunds.read'), getRefundByBooking)
router.post("/:refund_id/settle", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('refunds.settle'), manuallySettleRefund)

export default router
