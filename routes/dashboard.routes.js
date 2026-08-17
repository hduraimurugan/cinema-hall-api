import express from 'express'
import { getDashboardStats } from '../controllers/dashboard.Controller.js'
import { verifyCinemaAdminAccessToken, requireActiveHall } from '../middleware/verifyCinemaAdmin.js'
import { requirePermission } from '../middleware/requirePermission.js'

const router = express.Router()

router.get('/stats', verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('dashboard.view'), getDashboardStats)

export default router
