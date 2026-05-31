import express from 'express'
import {
  registerCinemaAdmin,
  loginCinemaAdmin,
  logoutCinemaAdmin,
  refreshCinemaAdminToken,
  getCinemaAdminMe,
  getAllAdmins,
  updateCinemaHall,
  verifyAdminEmail,
  resendVerificationEmail,
  forgotPassword,
  resetPassword,
  changePassword,
  logoutAllDevices,
  getAdminSecurity,
} from '../controllers/auth.Controller.js'

import {
  verifyCinemaAdminAccessToken,
  verifyCinemaAdminRefreshToken,
  verifySuperAdmin
} from '../middleware/verifyCinemaAdmin.js'

const router = express.Router()

// ── Public routes ──────────────────────────────────────────────────────────────
router.post('/register', registerCinemaAdmin)
router.post('/login', loginCinemaAdmin)
router.post('/logout', logoutCinemaAdmin)
router.get('/verify-email', verifyAdminEmail)
router.post('/resend-verification', resendVerificationEmail)
router.post('/forgot-password', forgotPassword)
router.post('/reset-password', resetPassword)

// ── Protected routes ───────────────────────────────────────────────────────────
router.get('/me', verifyCinemaAdminAccessToken, getCinemaAdminMe)
router.post('/refresh', verifyCinemaAdminRefreshToken, refreshCinemaAdminToken)
router.patch('/hall', verifyCinemaAdminAccessToken, updateCinemaHall)
router.post('/change-password', verifyCinemaAdminAccessToken, changePassword)
router.post('/logout-all', verifyCinemaAdminAccessToken, logoutAllDevices)
router.get('/security', verifyCinemaAdminAccessToken, getAdminSecurity)

// ── Super admin routes ─────────────────────────────────────────────────────────
router.get('/admins', verifySuperAdmin, getAllAdmins)

export default router
