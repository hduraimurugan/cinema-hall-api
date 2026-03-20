import express from 'express'
import { getDashboardStats } from '../controllers/dashboard.Controller.js'
import { verifyCinemaAdminAccessToken, verifyCinemaHall } from '../middleware/verifyCinemaAdmin.js'

const router = express.Router()

router.get('/stats', verifyCinemaAdminAccessToken, verifyCinemaHall, getDashboardStats)

export default router
