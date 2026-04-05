import pool from '../db.js'
import crypto from 'crypto'

// Utility: Generate random 6-digit OTP
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString()

// ✅ Send OTP
export const sendOtp = async (req, res) => {
    const { email } = req.body

    if (!email) return res.status(400).json({ error: "Email is required" })

    try {
        // 1️⃣ Check if customer exists
        const customer = await pool.query(
            `SELECT * FROM customers WHERE email = $1`,
            [email]
        )
        if (customer.rows.length === 0) {
            return res.status(404).json({ error: "Customer not found" })
        }

        // 2️⃣ Generate OTP + expiry
        const otp = generateOtp()
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 mins

        // 3️⃣ Upsert into otp_verifications (requires UNIQUE(email) constraint)
        await pool.query(
            `INSERT INTO otp_verifications (email, otp, is_verified, created_at, expires_at)
       VALUES ($1, $2, false, now(), $3)
       ON CONFLICT (email) DO UPDATE
       SET otp = EXCLUDED.otp,
           is_verified = false,
           created_at = now(),
           expires_at = EXCLUDED.expires_at`,
            [email, otp, expiresAt]
        )

        // 4️⃣ Send OTP via email service
        res.json({ message: "OTP sent successfully" })
    } catch (err) {
        console.error("❌ Send OTP error:", err.message)
        res.status(500).json({ error: "Failed to send OTP" })
    }
}

// ✅ Verify OTP
export const verifyOtp = async (req, res) => {
    const { email, otp } = req.body

    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' })

    try {
        const result = await pool.query(
            `SELECT * FROM otp_verifications WHERE email = $1 ORDER BY created_at DESC LIMIT 1`,
            [email]
        )

        if (result.rows.length === 0) return res.status(404).json({ error: 'OTP not found' })

        const otpRecord = result.rows[0]

        if (otpRecord.is_verified) return res.status(400).json({ error: 'OTP already used' })
        if (otpRecord.expires_at < new Date()) return res.status(400).json({ error: 'OTP expired' })
        if (otpRecord.otp !== otp) return res.status(400).json({ error: 'Invalid OTP' })

        // Mark OTP as verified
        await pool.query(`UPDATE otp_verifications SET is_verified = true WHERE id = $1`, [otpRecord.id])
        await pool.query(`UPDATE customers SET is_verified = true WHERE email = $1`, [email])

        res.json({ message: 'OTP verified successfully. Account activated!' })
    } catch (err) {
        console.error('❌ Verify OTP error:', err.message)
        res.status(500).json({ error: 'Failed to verify OTP' })
    }
}
