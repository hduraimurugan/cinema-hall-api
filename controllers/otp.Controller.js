import pool from '../db.js'
import crypto from 'crypto'
import logger from '../utils/logger.js'
import { sendCustomerOtpEmail } from '../mail/emails.js'

// Utility: Generate random 6-digit OTP
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString()

// Utility: SHA-256 hash an OTP before storing it
const hashOtp = (otp) => crypto.createHash('sha256').update(otp).digest('hex')

// Max OTP send attempts in a 10-minute window per (email, type)
const OTP_RATE_LIMIT = 3
const OTP_RATE_WINDOW_MS = 10 * 60 * 1000

// Max wrong-guess attempts before an OTP is invalidated
const MAX_OTP_ATTEMPTS = 5

// ✅ Send OTP — supports type: 'signup' | 'password_reset'
export const sendOtp = async (req, res) => {
    const { email, type = 'signup' } = req.body

    if (!email) return res.status(400).json({ error: 'Email is required' })
    if (!['signup', 'password_reset'].includes(type)) {
        return res.status(400).json({ error: 'Invalid OTP type' })
    }

    try {
        // 1️⃣ Look up customer
        const customerResult = await pool.query(
            `SELECT id, name, email FROM customers WHERE email = $1`,
            [email]
        )
        if (customerResult.rows.length === 0) {
            // Generic response to prevent user enumeration on password_reset
            if (type === 'password_reset') {
                return res.status(200).json({ message: 'If an account with that email exists, an OTP has been sent.' })
            }
            return res.status(404).json({ error: 'Customer not found' })
        }
        const customer = customerResult.rows[0]

        // 2️⃣ Rate limit: max OTP_RATE_LIMIT sends per (email, type) in OTP_RATE_WINDOW_MS
        const windowStart = new Date(Date.now() - OTP_RATE_WINDOW_MS)
        const recentResult = await pool.query(
            `SELECT COUNT(*) FROM otp_verifications
             WHERE email = $1 AND type = $2 AND created_at > $3`,
            [email, type, windowStart]
        )
        const recentCount = parseInt(recentResult.rows[0].count, 10)
        if (recentCount >= OTP_RATE_LIMIT) {
            return res.status(429).json({
                error: 'Too many OTP requests. Please wait a few minutes before trying again.',
            })
        }

        // 3️⃣ Generate OTP + hash + expiry
        const otp = generateOtp()
        const otpHash = hashOtp(otp)
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 mins

        // 4️⃣ Upsert into otp_verifications keyed by (email, type)
        await pool.query(
            `INSERT INTO otp_verifications (email, type, otp, is_verified, otp_attempts, created_at, expires_at)
             VALUES ($1, $2, $3, false, 0, now(), $4)
             ON CONFLICT (email, type) DO UPDATE
             SET otp          = EXCLUDED.otp,
                 is_verified  = false,
                 otp_attempts = 0,
                 created_at   = now(),
                 expires_at   = EXCLUDED.expires_at`,
            [email, type, otpHash, expiresAt]
        )

        // 5️⃣ Send OTP via email
        await sendCustomerOtpEmail(email, customer.name, otp, type)

        res.status(200).json({ message: type === 'password_reset'
            ? 'If an account with that email exists, an OTP has been sent.'
            : 'OTP sent successfully' })
    } catch (err) {
        logger.error('❌ Send OTP error:', { message: err.message })
        res.status(500).json({ error: 'Failed to send OTP' })
    }
}

// ✅ Verify OTP — supports type: 'signup' | 'password_reset'
export const verifyOtp = async (req, res) => {
    const { email, otp, type = 'signup' } = req.body

    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' })

    try {
        const result = await pool.query(
            `SELECT * FROM otp_verifications WHERE email = $1 AND type = $2`,
            [email, type]
        )

        if (result.rows.length === 0) return res.status(404).json({ error: 'OTP not found' })

        const otpRecord = result.rows[0]

        if (otpRecord.is_verified) {
            return res.status(400).json({ error: 'OTP already used' })
        }
        if (otpRecord.expires_at < new Date()) {
            return res.status(400).json({ code: 'OTP_EXPIRED', error: 'OTP has expired. Please request a new one.' })
        }
        if (otpRecord.otp_attempts >= MAX_OTP_ATTEMPTS) {
            return res.status(400).json({ code: 'OTP_ATTEMPTS_EXCEEDED', error: 'Too many incorrect attempts. Please request a new OTP.' })
        }

        // Compare hashed OTP
        const inputHash = hashOtp(otp.toString())
        if (otpRecord.otp !== inputHash) {
            // Increment attempt counter
            await pool.query(
                `UPDATE otp_verifications SET otp_attempts = otp_attempts + 1 WHERE id = $1`,
                [otpRecord.id]
            )
            const remaining = MAX_OTP_ATTEMPTS - (otpRecord.otp_attempts + 1)
            return res.status(400).json({
                error: remaining > 0
                    ? `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
                    : 'Invalid OTP. No attempts remaining — please request a new OTP.',
            })
        }

        // Mark OTP as verified
        await pool.query(`UPDATE otp_verifications SET is_verified = true WHERE id = $1`, [otpRecord.id])

        // Only activate the account for signup type
        if (type === 'signup') {
            await pool.query(`UPDATE customers SET is_verified = true WHERE email = $1`, [email])
        }

        res.status(200).json({ message: type === 'signup'
            ? 'OTP verified successfully. Account activated!'
            : 'OTP verified successfully.' })
    } catch (err) {
        logger.error('❌ Verify OTP error:', { message: err.message })
        res.status(500).json({ error: 'Failed to verify OTP' })
    }
}
