import express from 'express'
import { registerCustomer, loginCustomer, logoutCustomer } from '../controllers/customerAuth.Controller.js'

const router = express.Router()

// ✅ Customer Auth Routes
router.post('/signup', registerCustomer)
router.post('/login', loginCustomer)
router.post('/logout', logoutCustomer)

export default router
