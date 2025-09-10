import express from 'express'
import {
    registerCustomer,
    loginCustomer,
    logoutCustomer,
    updateCustomerProfile,
    getCustomerMe,
    refreshCustomerToken
} from '../controllers/customerAuth.Controller.js'
import {
    verifyCustomer,
    verifyCustomerRefreshToken
} from '../middleware/verifyCinemaAdmin.js'

const router = express.Router()

// ✅ Customer Auth Routes
router.post('/signup', registerCustomer)
router.post('/login', loginCustomer)
router.post('/logout', logoutCustomer)
router.put('/update', verifyCustomer, updateCustomerProfile)

router.get('/me', verifyCustomer, getCustomerMe)
router.post('/refresh', verifyCustomerRefreshToken, refreshCustomerToken)

export default router
