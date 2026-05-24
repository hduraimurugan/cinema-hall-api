import express from 'express'
import { getDashboardStats } from '../controllers/dashboard.Controller.js'
import { verifyCinemaAdminAccessToken, requireActiveHall } from '../middleware/verifyCinemaAdmin.js'

const router = express.Router()

router.get('/stats', verifyCinemaAdminAccessToken, requireActiveHall, getDashboardStats)

export default router
