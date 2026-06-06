import express from 'express'
import {
    registerCustomer,
    loginCustomer,
    logoutCustomer,
    updateCustomerProfile,
    getCustomerMe,
    refreshCustomerToken,
    changePasswordCustomer,
    forgotPasswordCustomer,
    resetPasswordCustomer,
    googleLoginCustomer,
    linkProviderCustomer,
    unlinkProviderCustomer,
    setPasswordCustomer,
} from '../controllers/customerAuth.Controller.js'
import {
    verifyCustomer,
    verifyCustomerRefreshToken
} from '../middleware/verifyCinemaAdmin.js'

const router = express.Router()

// ✅ Customer Auth Routes
router.post('/signup',          registerCustomer)
router.post('/login',           loginCustomer)
router.post('/logout',          logoutCustomer)
router.post('/google-login',    googleLoginCustomer)
router.put('/update',           verifyCustomer, updateCustomerProfile)
router.get('/me',               verifyCustomer, getCustomerMe)
router.post('/refresh',         verifyCustomerRefreshToken, refreshCustomerToken)

// ── Security flows ──────────────────────────────────────────────────────────
router.post('/change-password', verifyCustomer, changePasswordCustomer)
router.post('/forgot-password', forgotPasswordCustomer)
router.post('/reset-password',  resetPasswordCustomer)

// ── OAuth provider management ───────────────────────────────────────────────
router.post('/link-provider',   verifyCustomer, linkProviderCustomer)
router.post('/unlink-provider', verifyCustomer, unlinkProviderCustomer)
router.post('/set-password',    verifyCustomer, setPasswordCustomer)

export default router
