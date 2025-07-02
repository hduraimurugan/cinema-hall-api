import express from 'express'
import {
  registerCinemaAdmin,
  loginCinemaAdmin,
  logoutCinemaAdmin,
  refreshCinemaAdminToken,
  getCinemaAdminMe
} from '../controllers/auth.Controller.js'

import {
  verifyCinemaAdminAccessToken,
  verifyCinemaAdminRefreshToken
} from '../middleware/verifyCinemaAdmin.js'

const router = express.Router()

router.post('/register', registerCinemaAdmin)
router.post('/login', loginCinemaAdmin)
router.post('/logout', logoutCinemaAdmin)

router.get('/me', verifyCinemaAdminAccessToken, getCinemaAdminMe)
router.post('/refresh', verifyCinemaAdminRefreshToken, refreshCinemaAdminToken)

export default router
