import express from 'express'
import { sendOtp, verifyOtp } from '../controllers/otp.Controller.js'

const router = express.Router()

// ✅ OTP Routes
router.post('/send', sendOtp)       // Send OTP to email
router.post('/verify', verifyOtp)   // Verify OTP

export default router
