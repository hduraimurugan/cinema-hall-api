import express from 'express'
import {
  registerCinemaAdmin,
  loginCinemaAdmin,
  logoutCinemaAdmin,
  refreshCinemaAdminToken,
  getCinemaAdminMe,
  getAllAdmins,
  getAdminSecurityLogs,
  updateCinemaHall,
  verifyAdminEmail,
  resendVerificationEmail,
  forgotPassword,
  resetPassword,
  changePassword,
  logoutAllDevices,
  getAdminSecurity,
  googleLoginAdmin,
  githubLoginAdmin,
  linkProviderAdmin,
  unlinkProviderAdmin,
  setPasswordAdmin,
  validateInviteToken,
  acceptInvite,
  completeOnboarding,
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

// ── Invite routes (public) ──────────────────────────────────────────────────────
router.get('/accept-invite', validateInviteToken)
router.post('/accept-invite', acceptInvite)

// ── OAuth routes ───────────────────────────────────────────────────────────────
router.post('/google-login', googleLoginAdmin)
router.post('/github-login', githubLoginAdmin)

// ── Protected routes ───────────────────────────────────────────────────────────
router.get('/me', verifyCinemaAdminAccessToken, getCinemaAdminMe)
router.post('/onboarding', verifyCinemaAdminAccessToken, completeOnboarding)
router.post('/refresh', verifyCinemaAdminRefreshToken, refreshCinemaAdminToken)
router.patch('/hall', verifyCinemaAdminAccessToken, updateCinemaHall)
router.post('/change-password', verifyCinemaAdminAccessToken, changePassword)
router.post('/logout-all', verifyCinemaAdminAccessToken, logoutAllDevices)
router.get('/security', verifyCinemaAdminAccessToken, getAdminSecurity)
router.post('/link-provider', verifyCinemaAdminAccessToken, linkProviderAdmin)
router.post('/unlink-provider', verifyCinemaAdminAccessToken, unlinkProviderAdmin)
router.post('/set-password', verifyCinemaAdminAccessToken, setPasswordAdmin)

// ── Super admin routes ─────────────────────────────────────────────────────────
router.get('/admins', verifySuperAdmin, getAllAdmins)
router.get('/admins/:id/logs', verifySuperAdmin, getAdminSecurityLogs)

export default router
