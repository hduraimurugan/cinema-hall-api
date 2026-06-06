import pool from '../db.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { generateCustomerTokenAndSetCookie } from '../utils/generateTokenAndSetCookie.js'
import { hashToken } from '../utils/hashToken.js'
import { validatePassword } from '../utils/passwordPolicy.js'
import { verifyGoogleToken } from '../utils/oauthProviders.js'
import { checkOAuthRateLimit } from '../utils/oauthRateLimit.js'
import {
  sendCustomerOtpEmail,
  sendCustomerAccountLockedEmail,
  sendCustomerPasswordChangedEmail,
} from '../mail/emails.js'
import logger from '../utils/logger.js'

const isProduction = process.env.NODE_ENV === 'production'

// Tiered account lockout thresholds (same as admin)
const LOCKOUT_THRESHOLDS = [
  { attempts: 5,  lockMinutes: 15   },
  { attempts: 10, lockMinutes: 60   },
  { attempts: 15, lockMinutes: 1440 }, // 24 h
]

/** Returns the lock duration (minutes) for a given attempt count, or 0 if no lock. */
const getLockDuration = (attempts) => {
  const tier = [...LOCKOUT_THRESHOLDS].reverse().find(t => attempts >= t.attempts)
  return tier ? tier.lockMinutes : 0
}

// ✅ Customer Signup
export const registerCustomer = async (req, res) => {
  const { name, email, password, phone, district, state } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' })
  }

  // Enforce password policy
  const policyError = validatePassword(password)
  if (policyError) return res.status(400).json({ error: policyError })

  try {
    const existing = await pool.query(`SELECT id FROM customers WHERE email = $1`, [email])
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' })
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    const result = await pool.query(
      `INSERT INTO customers (name, email, password, phone, district, state)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, phone, district, state, is_verified, created_at`,
      [name, email, hashedPassword, phone || null, district || '', state || '']
    )

    res.status(201).json({
      message: 'Customer registered successfully! Please verify your email with OTP.',
      customer: result.rows[0],
    })
  } catch (err) {
    logger.error('❌ Customer signup error:', { message: err.message })
    res.status(500).json({ error: 'Signup failed. Try again later.' })
  }
}

// ✅ Customer Login — with account lockout + brute-force hints
export const loginCustomer = async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' })
  }

  try {
    const result = await pool.query(`SELECT * FROM customers WHERE email = $1`, [email])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' })
    }

    const customer = result.rows[0]

    // Check account lockout
    if (customer.account_locked_until && new Date(customer.account_locked_until) > new Date()) {
      return res.status(423).json({
        code: 'ACCOUNT_LOCKED',
        error: 'Account is temporarily locked due to multiple failed login attempts.',
        lockedUntil: customer.account_locked_until,
      })
    }

    const match = await bcrypt.compare(password, customer.password)

    if (!match) {
      const newAttempts = (customer.failed_login_attempts || 0) + 1
      const lockMinutes = getLockDuration(newAttempts)

      const updateFields = { failed_login_attempts: newAttempts }
      if (lockMinutes > 0) {
        const lockedUntil = new Date(Date.now() + lockMinutes * 60 * 1000)
        updateFields.account_locked_until = lockedUntil

        await pool.query(
          `UPDATE customers
           SET failed_login_attempts = $1, account_locked_until = $2
           WHERE id = $3`,
          [newAttempts, lockedUntil, customer.id]
        )

        // Send lockout notification email (non-fatal)
        sendCustomerAccountLockedEmail(customer.email, customer.name, lockedUntil).catch(() => {})

        return res.status(423).json({
          code: 'ACCOUNT_LOCKED',
          error: `Account locked for ${lockMinutes < 60 ? lockMinutes + ' minutes' : lockMinutes / 60 + ' hours'} due to too many failed attempts.`,
          lockedUntil,
        })
      }

      await pool.query(
        `UPDATE customers SET failed_login_attempts = $1 WHERE id = $2`,
        [newAttempts, customer.id]
      )

      // Hint: how many attempts until next lock tier
      const nextTier = LOCKOUT_THRESHOLDS.find(t => t.attempts > newAttempts)
      const hint = nextTier
        ? `${nextTier.attempts - newAttempts} attempt${nextTier.attempts - newAttempts === 1 ? '' : 's'} remaining before account is locked.`
        : null

      return res.status(400).json({ error: 'Invalid password', ...(hint && { hint }) })
    }

    if (!customer.is_verified) {
      return res.status(403).json({ error: 'Email not verified. Please verify using OTP.' })
    }

    // Successful login — reset lockout counters + update last_login_at
    await pool.query(
      `UPDATE customers
       SET failed_login_attempts = 0, account_locked_until = NULL, last_login_at = now()
       WHERE id = $1`,
      [customer.id]
    )

    const tokenPayload = { id: customer.id, name: customer.name, email: customer.email, role: 'customer' }
    const meta = { ip: req.ip, userAgent: req.headers['user-agent'] }
    await generateCustomerTokenAndSetCookie(res, tokenPayload, meta)

    res.json({
      message: 'Login successful',
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        is_verified: customer.is_verified,
        created_at: customer.created_at,
      },
    })
  } catch (err) {
    logger.error('❌ Customer login error:', { message: err.message })
    res.status(500).json({ error: 'Login failed. Try again later.' })
  }
}

// ✅ Logout — revokes session in DB
export const logoutCustomer = async (req, res) => {
  try {
    const refreshToken = req.cookies.cusRefreshToken
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken)
      pool.query(
        `UPDATE customer_sessions SET is_revoked = TRUE WHERE refresh_token_hash = $1`,
        [tokenHash]
      ).catch(() => {})
    }

    res.clearCookie('cusAccessToken', { httpOnly: true, sameSite: isProduction ? 'None' : 'Lax', secure: isProduction })
    res.clearCookie('cusRefreshToken', { httpOnly: true, sameSite: isProduction ? 'None' : 'Lax', secure: isProduction })
    res.status(200).json({ message: 'Logged out successfully' })
  } catch (err) {
    logger.error('❌ Logout error:', { message: err.message })
    res.status(500).json({ error: 'Logout failed' })
  }
}

// ✅ Update Customer Profile (name, phone, location — no password here)
export const updateCustomerProfile = async (req, res) => {
  const customerId = req.customer?.id
  logger.debug('Authenticated Customer ID:', { customerId })

  const { name, phone, district, state } = req.body

  if (!customerId) return res.status(401).json({ error: 'Unauthorized. Please log in.' })

  try {
    const existing = await pool.query(`SELECT * FROM customers WHERE id = $1`, [customerId])
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Customer not found' })

    const row = existing.rows[0]
    const result = await pool.query(
      `UPDATE customers
       SET name = $1, phone = $2, district = $3, state = $4, updated_at = now()
       WHERE id = $5
       RETURNING id, name, email, phone, district, state, is_verified, created_at, updated_at`,
      [
        name     ?? row.name,
        phone    ?? row.phone,
        district ?? row.district,
        state    ?? row.state,
        customerId,
      ]
    )

    res.json({ message: 'Profile updated successfully', customer: result.rows[0] })
  } catch (err) {
    logger.error('❌ Update profile error:', { message: err.message })
    res.status(500).json({ error: 'Profile update failed. Try again later.' })
  }
}

// ✅ Change Password (authenticated)
export const changePasswordCustomer = async (req, res) => {
  const customerId = req.customer?.id
  if (!customerId) return res.status(401).json({ error: 'Unauthorized.' })

  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required.' })
  }

  // Enforce password policy on new password
  const policyError = validatePassword(newPassword)
  if (policyError) return res.status(400).json({ error: policyError })

  try {
    const result = await pool.query(`SELECT * FROM customers WHERE id = $1`, [customerId])
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' })

    const customer = result.rows[0]

    // Verify current password
    const match = await bcrypt.compare(currentPassword, customer.password)
    if (!match) return res.status(400).json({ error: 'Current password is incorrect.' })

    // Reject if new password == current
    const sameAsOld = await bcrypt.compare(newPassword, customer.password)
    if (sameAsOld) return res.status(400).json({ error: 'New password must be different from your current password.' })

    const hashedNew = await bcrypt.hash(newPassword, 12)

    // Get the current refresh token hash so we can keep this session active
    const currentRefreshToken = req.cookies.cusRefreshToken
    const currentTokenHash = currentRefreshToken ? hashToken(currentRefreshToken) : null

    await pool.query(
      `UPDATE customers SET password = $1, password_changed_at = now() WHERE id = $2`,
      [hashedNew, customerId]
    )

    // Revoke all OTHER sessions (keep current device logged in)
    if (currentTokenHash) {
      await pool.query(
        `UPDATE customer_sessions SET is_revoked = TRUE
         WHERE customer_id = $1 AND refresh_token_hash != $2`,
        [customerId, currentTokenHash]
      )
    } else {
      await pool.query(
        `UPDATE customer_sessions SET is_revoked = TRUE WHERE customer_id = $1`,
        [customerId]
      )
    }

    // Send notification email (non-fatal)
    sendCustomerPasswordChangedEmail(customer.email, customer.name).catch(() => {})

    res.json({ message: 'Password changed successfully. Other devices have been signed out.' })
  } catch (err) {
    logger.error('❌ Change password error:', { message: err.message })
    res.status(500).json({ error: 'Failed to change password. Try again later.' })
  }
}

// ✅ Forgot Password — sends OTP to email (generic response to prevent enumeration)
export const forgotPasswordCustomer = async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email is required.' })

  // Always return a generic response — never reveal if the email exists
  const GENERIC_MSG = 'If an account with that email exists, a password reset OTP has been sent.'

  try {
    const result = await pool.query(`SELECT id, name FROM customers WHERE email = $1`, [email])
    if (result.rows.length === 0) return res.json({ message: GENERIC_MSG })

    const customer = result.rows[0]

    // Delegate to OTP logic: hash + store + email (password_reset type)
    // Rate limit check (3 per 10 min) is handled inside otp.Controller.js
    const otpHash = await _generateAndSendOtp(email, customer.name, 'password_reset')
    if (!otpHash) return res.json({ message: GENERIC_MSG }) // rate-limited, still generic

    res.json({ message: GENERIC_MSG })
  } catch (err) {
    logger.error('❌ Forgot password error:', { message: err.message })
    res.status(500).json({ error: 'Failed to process request. Try again later.' })
  }
}

// ✅ Reset Password — verifies OTP then updates password
export const resetPasswordCustomer = async (req, res) => {
  const { email, otp, newPassword } = req.body
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ error: 'email, otp, and newPassword are required.' })
  }

  // Enforce password policy
  const policyError = validatePassword(newPassword)
  if (policyError) return res.status(400).json({ error: policyError })

  try {
    // Look up OTP record
    const otpResult = await pool.query(
      `SELECT * FROM otp_verifications WHERE email = $1 AND type = 'password_reset'`,
      [email]
    )
    if (otpResult.rows.length === 0) return res.status(400).json({ error: 'No password reset OTP found. Please request a new one.' })

    const otpRecord = otpResult.rows[0]

    if (otpRecord.is_verified) return res.status(400).json({ error: 'OTP already used.' })
    if (otpRecord.expires_at < new Date()) return res.status(400).json({ code: 'OTP_EXPIRED', error: 'OTP has expired. Please request a new one.' })
    if (otpRecord.otp_attempts >= 5) return res.status(400).json({ code: 'OTP_ATTEMPTS_EXCEEDED', error: 'Too many incorrect attempts. Please request a new OTP.' })

    const inputHash = crypto.createHash('sha256').update(otp.toString()).digest('hex')
    if (otpRecord.otp !== inputHash) {
      await pool.query(
        `UPDATE otp_verifications SET otp_attempts = otp_attempts + 1 WHERE id = $1`,
        [otpRecord.id]
      )
      const remaining = 5 - (otpRecord.otp_attempts + 1)
      return res.status(400).json({
        error: remaining > 0
          ? `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Invalid OTP. No attempts remaining — please request a new OTP.',
      })
    }

    // OTP is valid — fetch customer
    const customerResult = await pool.query(`SELECT * FROM customers WHERE email = $1`, [email])
    if (customerResult.rows.length === 0) return res.status(404).json({ error: 'Customer not found' })
    const customer = customerResult.rows[0]

    // Same-password check
    const sameAsOld = await bcrypt.compare(newPassword, customer.password)
    if (sameAsOld) return res.status(400).json({ error: 'New password must be different from your current password.' })

    const hashedNew = await bcrypt.hash(newPassword, 12)

    // Mark OTP used + update password + revoke ALL sessions
    await pool.query(`UPDATE otp_verifications SET is_verified = true WHERE id = $1`, [otpRecord.id])
    await pool.query(
      `UPDATE customers SET password = $1, password_changed_at = now(),
       failed_login_attempts = 0, account_locked_until = NULL WHERE id = $2`,
      [hashedNew, customer.id]
    )
    await pool.query(
      `UPDATE customer_sessions SET is_revoked = TRUE WHERE customer_id = $1`,
      [customer.id]
    )

    // Send notification email (non-fatal)
    sendCustomerPasswordChangedEmail(customer.email, customer.name).catch(() => {})

    res.json({ message: 'Password reset successfully. Please sign in with your new password.' })
  } catch (err) {
    logger.error('❌ Reset password error:', { message: err.message })
    res.status(500).json({ error: 'Failed to reset password. Try again later.' })
  }
}

// ✅ Refresh Access Token
export const refreshCustomerToken = async (req, res) => {
  try {
    const customerId = req.customer.id

    const result = await pool.query(`SELECT * FROM customers WHERE id = $1`, [customerId])
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' })

    const customer = result.rows[0]

    const newAccessToken = jwt.sign(
      { id: customer.id, name: customer.name, email: customer.email, role: 'customer' },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    )

    res.cookie('cusAccessToken', newAccessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 1 * 24 * 60 * 60 * 1000, // 1 day
    })

    res.json({ success: true })
  } catch (err) {
    logger.error('❌ Refresh token error:', { message: err.message })
    res.status(500).json({ error: 'Token refresh failed' })
  }
}

// ✅ Get Logged-in Customer
export const getCustomerMe = async (req, res) => {
  try {
    const customerId = req.customer.id

    const result = await pool.query(
      `SELECT id, name, email, phone, district, state, is_verified,
              auth_providers, avatar, password IS NOT NULL AS has_password,
              created_at, updated_at
       FROM customers WHERE id = $1`,
      [customerId]
    )

    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' })

    const customer = result.rows[0]
    res.json({
      customer: {
        ...customer,
        auth_providers: customer.auth_providers || ['local'],
      },
    })
  } catch (err) {
    logger.error('❌ getCustomerMe error:', { message: err.message })
    res.status(500).json({ error: 'Failed to fetch customer info' })
  }
}

// ─── Internal helper ─────────────────────────────────────────────────────────
// Generates, hashes, and stores an OTP, then sends the email.
// Returns the hash on success, null if rate-limited.
async function _generateAndSendOtp(email, name, type) {
  const OTP_RATE_LIMIT = 3
  const OTP_RATE_WINDOW_MS = 10 * 60 * 1000
  const windowStart = new Date(Date.now() - OTP_RATE_WINDOW_MS)

  const recentResult = await pool.query(
    `SELECT COUNT(*) FROM otp_verifications WHERE email = $1 AND type = $2 AND created_at > $3`,
    [email, type, windowStart]
  )
  if (parseInt(recentResult.rows[0].count, 10) >= OTP_RATE_LIMIT) return null

  const crypto = await import('crypto')
  const otp = Math.floor(100000 + Math.random() * 900000).toString()
  const otpHash = crypto.default.createHash('sha256').update(otp).digest('hex')
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

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

  await sendCustomerOtpEmail(email, name, otp, type)
  return otpHash
}

// ✅ Google OAuth Login (Customer)
export const googleLoginCustomer = async (req, res) => {
  const { idToken } = req.body
  if (!idToken) return res.status(400).json({ error: 'Google ID token is required.' })

  // Rate limiting
  const rateCheck = checkOAuthRateLimit(req.ip, 'customer-google-login')
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'Too many login attempts. Please try again later.',
      retryAfterMs: rateCheck.retryAfterMs,
    })
  }

  try {
    const googleUser = await verifyGoogleToken(idToken)

    // Look up customer by email
    const result = await pool.query(
      `SELECT * FROM customers WHERE email = $1`,
      [googleUser.email]
    )

    let customer
    let isNewAccount = false

    if (result.rows.length === 0) {
      // Case A — New customer account via Google
      const insertResult = await pool.query(
        `INSERT INTO customers (name, email, password, phone, is_verified, auth_providers, provider_ids, avatar)
         VALUES ($1, $2, NULL, NULL, TRUE, ARRAY['google'], $3, $4)
         RETURNING id, name, email, phone, is_verified, auth_providers, avatar, created_at`,
        [googleUser.name, googleUser.email, JSON.stringify({ google: googleUser.googleId }), googleUser.picture]
      )
      customer = insertResult.rows[0]
      isNewAccount = true
    } else {
      customer = result.rows[0]

      // Check lockout
      if (customer.account_locked_until && new Date(customer.account_locked_until) > new Date()) {
        return res.status(423).json({
          code: 'ACCOUNT_LOCKED',
          error: 'Account is temporarily locked due to multiple failed login attempts.',
          lockedUntil: customer.account_locked_until,
        })
      }

      // Case B — Existing local account, link Google
      if (!customer.auth_providers || !customer.auth_providers.includes('google')) {
        const updatedProviderIds = { ...(customer.provider_ids || {}), google: googleUser.googleId }
        const updatedProviders = [...new Set([...(customer.auth_providers || ['local']), 'google'])]
        await pool.query(
          `UPDATE customers
           SET auth_providers = $1, provider_ids = $2, avatar = COALESCE(avatar, $3),
               is_verified = TRUE
           WHERE id = $4`,
          [updatedProviders, JSON.stringify(updatedProviderIds), googleUser.picture, customer.id]
        )
        customer.auth_providers = updatedProviders
      } else {
        // Case C — Existing Google account, update avatar
        await pool.query(
          `UPDATE customers SET avatar = $1 WHERE id = $2`,
          [googleUser.picture, customer.id]
        )
      }
    }

    // Reset lockout and update last_login
    await pool.query(
      `UPDATE customers SET last_login_at = now(), failed_login_attempts = 0, account_locked_until = NULL WHERE id = $1`,
      [customer.id]
    )

    const tokenPayload = { id: customer.id, name: customer.name || googleUser.name, email: customer.email, role: 'customer' }
    const meta = { ip: req.ip, userAgent: req.headers['user-agent'] }
    await generateCustomerTokenAndSetCookie(res, tokenPayload, meta)

    res.json({
      message: isNewAccount ? 'Account created successfully' : 'Login successful',
      customer: {
        id: customer.id,
        name: customer.name || googleUser.name,
        email: customer.email,
        phone: customer.phone,
        is_verified: true,
        auth_providers: customer.auth_providers || ['google'],
        avatar: customer.avatar || googleUser.picture,
        created_at: customer.created_at,
      },
    })
  } catch (err) {
    logger.error('❌ Customer Google login error:', { message: err.message })
    if (err.message.includes('Token used too late') || err.message.includes('Invalid token')) {
      return res.status(401).json({ error: 'Invalid or expired Google token. Please try again.' })
    }
    res.status(500).json({ error: 'Google login failed. Try again later.' })
  }
}

// ✅ Link Google Provider (Customer - Authenticated)
export const linkProviderCustomer = async (req, res) => {
  const customerId = req.customer.id
  const { provider, idToken } = req.body

  if (!provider || provider !== 'google') {
    return res.status(400).json({ error: 'Invalid provider. Supported: google.' })
  }

  if (!idToken) return res.status(400).json({ error: 'Google ID token is required.' })

  try {
    const customerResult = await pool.query(
      'SELECT id, email, auth_providers, provider_ids FROM customers WHERE id = $1',
      [customerId]
    )
    if (customerResult.rows.length === 0) return res.status(404).json({ error: 'Customer not found.' })

    const customer = customerResult.rows[0]

    if (customer.auth_providers && customer.auth_providers.includes('google')) {
      return res.status(400).json({ error: 'Google is already linked to your account.' })
    }

    const googleUser = await verifyGoogleToken(idToken)
    if (googleUser.email !== customer.email) {
      return res.status(400).json({ error: 'Google email does not match your account email.' })
    }

    const updatedProviderIds = { ...(customer.provider_ids || {}), google: googleUser.googleId }
    const updatedProviders = [...new Set([...(customer.auth_providers || ['local']), 'google'])]

    await pool.query(
      `UPDATE customers SET auth_providers = $1, provider_ids = $2, avatar = COALESCE(avatar, $3) WHERE id = $4`,
      [updatedProviders, JSON.stringify(updatedProviderIds), googleUser.picture, customerId]
    )

    res.json({ message: 'Google account linked successfully.', auth_providers: updatedProviders })
  } catch (err) {
    logger.error('❌ linkProvider customer error:', { message: err.message })
    res.status(500).json({ error: 'Failed to link provider. Try again later.' })
  }
}

// ✅ Unlink Google Provider (Customer - Authenticated)
export const unlinkProviderCustomer = async (req, res) => {
  const customerId = req.customer.id
  const { provider } = req.body

  if (!provider || provider !== 'google') {
    return res.status(400).json({ error: 'Invalid provider. Supported: google.' })
  }

  try {
    const customerResult = await pool.query(
      'SELECT id, password, auth_providers, provider_ids FROM customers WHERE id = $1',
      [customerId]
    )
    if (customerResult.rows.length === 0) return res.status(404).json({ error: 'Customer not found.' })

    const customer = customerResult.rows[0]

    if (!customer.auth_providers || !customer.auth_providers.includes('google')) {
      return res.status(400).json({ error: 'Google is not linked to your account.' })
    }

    // Prevent removing last auth method
    const remainingProviders = customer.auth_providers.filter(p => p !== 'google')
    const hasPassword = !!customer.password
    if (remainingProviders.length === 0 && !hasPassword) {
      return res.status(400).json({ error: 'Cannot remove your only login method. Set a password first.' })
    }
    if (remainingProviders.filter(p => p !== 'local').length === 0 && !hasPassword) {
      return res.status(400).json({ error: 'Cannot remove your only login method. Set a password first.' })
    }

    const updatedProviderIds = { ...(customer.provider_ids || {}) }
    delete updatedProviderIds.google

    await pool.query(
      `UPDATE customers SET auth_providers = $1, provider_ids = $2 WHERE id = $3`,
      [remainingProviders, JSON.stringify(updatedProviderIds), customerId]
    )

    res.json({ message: 'Google account unlinked successfully.', auth_providers: remainingProviders })
  } catch (err) {
    logger.error('❌ unlinkProvider customer error:', { message: err.message })
    res.status(500).json({ error: 'Failed to unlink provider. Try again later.' })
  }
}

// ✅ Set Password (for OAuth-only customer accounts)
export const setPasswordCustomer = async (req, res) => {
  const customerId = req.customer.id
  const { newPassword } = req.body

  if (!newPassword) return res.status(400).json({ error: 'New password is required.' })

  const policyError = validatePassword(newPassword)
  if (policyError) return res.status(400).json({ error: policyError })

  try {
    const customerResult = await pool.query(
      'SELECT id, password, auth_providers FROM customers WHERE id = $1',
      [customerId]
    )
    if (customerResult.rows.length === 0) return res.status(404).json({ error: 'Customer not found.' })

    const customer = customerResult.rows[0]

    if (customer.password) {
      return res.status(400).json({ error: 'You already have a password set. Use change password instead.' })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12)
    const updatedProviders = [...new Set([...(customer.auth_providers || []), 'local'])]

    await pool.query(
      `UPDATE customers SET password = $1, auth_providers = $2, password_changed_at = now() WHERE id = $3`,
      [hashedPassword, updatedProviders, customerId]
    )

    res.json({ message: 'Password set successfully. You can now login with email and password.', auth_providers: updatedProviders })
  } catch (err) {
    logger.error('❌ setPassword customer error:', { message: err.message })
    res.status(500).json({ error: 'Failed to set password. Try again later.' })
  }
}
