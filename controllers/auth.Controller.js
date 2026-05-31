import pool from '../db.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { generateTokenAndSetCookie } from '../utils/generateTokenAndSetCookie.js'
import { generateVerificationToken } from '../utils/generateVerificationToken.js'
import { hashToken } from '../utils/hashToken.js'
import { validatePassword } from '../utils/passwordPolicy.js'
import {
  sendAdminVerificationEmail,
  sendAdminPasswordResetEmail,
  sendAdminPasswordChangedEmail,
  sendAdminAccountLockedEmail,
} from '../mail/emails.js'
import logger from '../utils/logger.js'

const isProduction = process.env.NODE_ENV === 'production'

// ── Lockout thresholds (configurable) ─────────────────────────────────────────
const LOCKOUT_THRESHOLDS = [
  { attempts: 5,  lockMinutes: 15 },
  { attempts: 10, lockMinutes: 60 },
  { attempts: 15, lockMinutes: 1440 },
]

const getLockDuration = (failedAttempts) => {
  let duration = 0
  for (const t of LOCKOUT_THRESHOLDS) {
    if (failedAttempts >= t.attempts) duration = t.lockMinutes
  }
  return duration
}

// ── Security log helper ────────────────────────────────────────────────────────
const logSecurityEvent = async (adminId, action, req, metadata = {}) => {
  try {
    await pool.query(
      `INSERT INTO admin_security_logs (admin_id, action, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId || null, action, req.ip || null, req.headers['user-agent'] || null, JSON.stringify(metadata)]
    )
  } catch (err) {
    logger.error('Failed to write security log:', { message: err.message })
  }
}

// ✅ Register Admin
export const registerCinemaAdmin = async (req, res) => {
  const { name, email, password, phone } = req.body

  if (!name || !email || !password || !phone) {
    return res.status(400).json({ error: 'Name, email, password, and phone are required.' })
  }

  const passwordCheck = validatePassword(password)
  if (!passwordCheck.valid) {
    return res.status(400).json({ error: passwordCheck.message })
  }

  try {
    const existing = await pool.query('SELECT id FROM cinema_admin_user WHERE email = $1', [email.toLowerCase()])
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' })
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    const userResult = await pool.query(
      `INSERT INTO cinema_admin_user (name, email, password, phone, email_verified)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING id, name, email, phone, created_at`,
      [name, email.toLowerCase(), hashedPassword, phone]
    )
    const admin = userResult.rows[0]

    const rawToken = generateVerificationToken()
    const tokenHash = hashToken(rawToken)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    await pool.query(
      `INSERT INTO admin_verification_tokens (admin_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [admin.id, tokenHash, expiresAt]
    )

    const adminFrontendUrl = process.env.ADMIN_FRONTEND_URL || 'http://localhost:5174'
    const verificationLink = `${adminFrontendUrl}/verify-email?token=${rawToken}`

    try {
      await sendAdminVerificationEmail(admin.email, admin.name, verificationLink)
    } catch (mailErr) {
      logger.error('Could not send verification email during registration:', { message: mailErr.message })
    }

    await logSecurityEvent(admin.id, 'REGISTER', req)

    res.status(201).json({
      message: 'Account created. Please check your email to verify your account.',
      admin: { id: admin.id, name: admin.name, email: admin.email, phone: admin.phone, created_at: admin.created_at },
    })
  } catch (err) {
    logger.error('❌ Registration error:', { message: err.message })
    res.status(500).json({ error: 'Registration failed. Try again later.' })
  }
}

// ✅ Verify Email
export const verifyAdminEmail = async (req, res) => {
  const { token } = req.query
  if (!token) return res.status(400).json({ error: 'Verification token is required.' })

  try {
    const tokenHash = hashToken(token)
    const result = await pool.query(
      `SELECT avt.id, avt.admin_id, avt.expires_at, a.name, a.email
       FROM admin_verification_tokens avt
       JOIN cinema_admin_user a ON a.id = avt.admin_id
       WHERE avt.token_hash = $1`,
      [tokenHash]
    )

    if (result.rows.length === 0) {
      return res.status(400).json({ code: 'INVALID_TOKEN', error: 'Invalid verification link.' })
    }

    const record = result.rows[0]

    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ code: 'TOKEN_EXPIRED', error: 'Verification link has expired. Please request a new one.' })
    }

    await pool.query('BEGIN')
    try {
      await pool.query(
        `UPDATE cinema_admin_user SET email_verified = TRUE, email_verified_at = now() WHERE id = $1`,
        [record.admin_id]
      )
      await pool.query(`DELETE FROM admin_verification_tokens WHERE admin_id = $1`, [record.admin_id])
      await pool.query('COMMIT')
    } catch (err) {
      await pool.query('ROLLBACK')
      throw err
    }

    await logSecurityEvent(record.admin_id, 'EMAIL_VERIFIED', req)
    res.json({ message: 'Email verified successfully. You can now log in.' })
  } catch (err) {
    logger.error('❌ verifyAdminEmail error:', { message: err.message })
    res.status(500).json({ error: 'Verification failed. Try again later.' })
  }
}

// ✅ Resend Verification Email
export const resendVerificationEmail = async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email is required.' })

  const genericResponse = { message: 'If an unverified account with that email exists, a verification email has been sent.' }

  try {
    const result = await pool.query(
      'SELECT id, name, email, email_verified FROM cinema_admin_user WHERE email = $1',
      [email.toLowerCase()]
    )

    if (result.rows.length === 0 || result.rows[0].email_verified) {
      return res.json(genericResponse)
    }

    const admin = result.rows[0]

    const recentToken = await pool.query(
      `SELECT created_at FROM admin_verification_tokens WHERE admin_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [admin.id]
    )
    if (recentToken.rows.length > 0) {
      const elapsed = Date.now() - new Date(recentToken.rows[0].created_at).getTime()
      if (elapsed < 2 * 60 * 1000) {
        return res.status(429).json({ error: 'Please wait 2 minutes before requesting another verification email.' })
      }
    }

    await pool.query(`DELETE FROM admin_verification_tokens WHERE admin_id = $1`, [admin.id])

    const rawToken = generateVerificationToken()
    const tokenHash = hashToken(rawToken)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    await pool.query(
      `INSERT INTO admin_verification_tokens (admin_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [admin.id, tokenHash, expiresAt]
    )

    const adminFrontendUrl = process.env.ADMIN_FRONTEND_URL || 'http://localhost:5174'
    const verificationLink = `${adminFrontendUrl}/verify-email?token=${rawToken}`

    await sendAdminVerificationEmail(admin.email, admin.name, verificationLink)
    await logSecurityEvent(admin.id, 'RESEND_VERIFICATION', req)

    res.json(genericResponse)
  } catch (err) {
    logger.error('❌ resendVerificationEmail error:', { message: err.message })
    res.status(500).json({ error: 'Failed to send verification email. Try again later.' })
  }
}


// ✅ Login Admin
export const loginCinemaAdmin = async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' })

  try {
    const result = await pool.query(
      `SELECT
        a.id AS admin_id, a.name AS admin_name, a.email, a.password, a.phone, a.role,
        a.email_verified, a.failed_login_attempts, a.account_locked_until, a.created_at AS admin_created_at,
        h.id AS hall_id, h.name AS hall_name, h.location AS hall_location,
        h.district AS hall_district, h.state AS hall_state,
        h.latitude AS hall_latitude, h.longitude AS hall_longitude,
        h.created_at AS hall_created_at
       FROM cinema_admin_user a
       LEFT JOIN cinema_hall h ON h.admin_id = a.id
       WHERE a.email = $1`,
      [email.toLowerCase()]
    )

    if (result.rows.length === 0) {
      await logSecurityEvent(null, 'LOGIN_FAILED_UNKNOWN_EMAIL', req, { email })
      return res.status(401).json({ error: 'Invalid credentials.' })
    }

    const admin = result.rows[0]

    // Check lockout
    if (admin.account_locked_until && new Date(admin.account_locked_until) > new Date()) {
      const remainingMs = new Date(admin.account_locked_until).getTime() - Date.now()
      const remainingMins = Math.ceil(remainingMs / 60000)
      await logSecurityEvent(admin.admin_id, 'LOGIN_ATTEMPT_WHILE_LOCKED', req)
      return res.status(423).json({
        code: 'ACCOUNT_LOCKED',
        error: `Account is temporarily locked. Try again in ${remainingMins} minute${remainingMins === 1 ? '' : 's'}.`,
        lockedUntil: admin.account_locked_until,
      })
    }

    // Verify password
    const match = await bcrypt.compare(password, admin.password)
    if (!match) {
      const newFailCount = (admin.failed_login_attempts || 0) + 1
      const lockMinutes = getLockDuration(newFailCount)
      const lockedUntil = lockMinutes > 0 ? new Date(Date.now() + lockMinutes * 60 * 1000) : null

      await pool.query(
        `UPDATE cinema_admin_user SET failed_login_attempts = $1, account_locked_until = $2 WHERE id = $3`,
        [newFailCount, lockedUntil, admin.admin_id]
      )
      await logSecurityEvent(admin.admin_id, 'LOGIN_FAILED_WRONG_PASSWORD', req, { attempts: newFailCount })

      if (lockedUntil) {
        sendAdminAccountLockedEmail(admin.email, admin.admin_name, lockedUntil).catch(() => {})
        return res.status(423).json({
          code: 'ACCOUNT_LOCKED',
          error: `Too many failed attempts. Account locked for ${lockMinutes} minute${lockMinutes === 1 ? '' : 's'}.`,
          lockedUntil,
        })
      }

      const attemptsLeft = LOCKOUT_THRESHOLDS[0].attempts - newFailCount
      return res.status(401).json({
        error: 'Invalid credentials.',
        ...(attemptsLeft > 0 && { hint: `${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining before lockout.` }),
      })
    }

    // Check email verification
    if (!admin.email_verified) {
      await logSecurityEvent(admin.admin_id, 'LOGIN_FAILED_UNVERIFIED', req)
      return res.status(403).json({
        code: 'EMAIL_NOT_VERIFIED',
        error: 'Please verify your email before logging in.',
        email: admin.email,
      })
    }

    // Success — reset failure counters
    await pool.query(
      `UPDATE cinema_admin_user SET failed_login_attempts = 0, account_locked_until = NULL, last_login_at = now() WHERE id = $1`,
      [admin.admin_id]
    )

    const tokenPayload = { id: admin.admin_id, name: admin.admin_name, email: admin.email, role: admin.role }
    const meta = { ip: req.ip, userAgent: req.headers['user-agent'] }
    const { accessToken, refreshToken } = await generateTokenAndSetCookie(res, tokenPayload, meta)

    await logSecurityEvent(admin.admin_id, 'LOGIN_SUCCESS', req)

    res.json({
      message: 'Login successful',
      accessToken,
      refreshToken,
      admin: {
        id: admin.admin_id,
        name: admin.admin_name,
        email: admin.email,
        phone: admin.phone,
        role: admin.role,
        email_verified: admin.email_verified,
        created_at: admin.admin_created_at,
      },
      hall: admin.hall_id
        ? {
            id: admin.hall_id,
            name: admin.hall_name,
            location: admin.hall_location,
            district: admin.hall_district,
            state: admin.hall_state,
            latitude: admin.hall_latitude ? parseFloat(admin.hall_latitude) : null,
            longitude: admin.hall_longitude ? parseFloat(admin.hall_longitude) : null,
            created_at: admin.hall_created_at,
          }
        : null,
    })
  } catch (err) {
    logger.error('❌ Login error:', { message: err.message })
    res.status(500).json({ error: 'Login failed. Try again later.' })
  }
}

// ✅ Refresh Access Token
export const refreshCinemaAdminToken = async (req, res) => {
  try {
    const adminId = req.admin.id

    const result = await pool.query('SELECT * FROM cinema_admin_user WHERE id = $1', [adminId])
    if (result.rows.length === 0) return res.status(404).json({ error: 'Admin not found' })

    const admin = result.rows[0]

    const newAccessToken = jwt.sign(
      { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    )

    res.cookie('accessToken', newAccessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 1 * 24 * 60 * 60 * 1000,
    })

    res.json({ success: true })
  } catch (err) {
    logger.error('❌ Refresh token error:', { message: err.message })
    res.status(500).json({ error: 'Token refresh failed' })
  }
}

// ✅ Get Logged-in Admin
export const getCinemaAdminMe = async (req, res) => {
  try {
    const adminId = req.admin.id

    const result = await pool.query(
      `SELECT
        a.id AS admin_id, a.name AS admin_name, a.email, a.phone, a.role,
        a.email_verified, a.email_verified_at, a.password_changed_at, a.last_login_at,
        a.created_at AS admin_created_at,
        h.id AS hall_id, h.name AS hall_name, h.location AS hall_location,
        h.district AS hall_district, h.state AS hall_state,
        h.latitude AS hall_latitude, h.longitude AS hall_longitude,
        h.created_at AS hall_created_at
       FROM cinema_admin_user a
       LEFT JOIN cinema_hall h ON h.admin_id = a.id
       WHERE a.id = $1`,
      [adminId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' })
    }

    const row = result.rows[0]
    res.json({
      admin: {
        id: row.admin_id,
        name: row.admin_name,
        email: row.email,
        phone: row.phone,
        role: row.role,
        email_verified: row.email_verified,
        email_verified_at: row.email_verified_at,
        password_changed_at: row.password_changed_at,
        last_login_at: row.last_login_at,
        created_at: row.admin_created_at,
      },
      hall: row.hall_id
        ? {
            id: row.hall_id,
            name: row.hall_name,
            location: row.hall_location,
            district: row.hall_district,
            state: row.hall_state,
            latitude: row.hall_latitude ? parseFloat(row.hall_latitude) : null,
            longitude: row.hall_longitude ? parseFloat(row.hall_longitude) : null,
            created_at: row.hall_created_at,
          }
        : null,
    })
  } catch (err) {
    logger.error('❌ getMe error:', { message: err.message })
    res.status(500).json({ error: 'Failed to fetch admin info' })
  }
}

// ✅ Forgot Password
export const forgotPassword = async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email is required.' })

  const genericResponse = { message: 'If an account with that email exists, a password reset link has been sent.' }

  try {
    const result = await pool.query(
      'SELECT id, name, email, email_verified FROM cinema_admin_user WHERE email = $1',
      [email.toLowerCase()]
    )

    if (result.rows.length === 0 || !result.rows[0].email_verified) {
      return res.json(genericResponse)
    }

    const admin = result.rows[0]

    await pool.query(`DELETE FROM admin_password_reset_tokens WHERE admin_id = $1`, [admin.id])

    const rawToken = generateVerificationToken()
    const tokenHash = hashToken(rawToken)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

    await pool.query(
      `INSERT INTO admin_password_reset_tokens (admin_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [admin.id, tokenHash, expiresAt]
    )

    const adminFrontendUrl = process.env.ADMIN_FRONTEND_URL || 'http://localhost:5174'
    const resetLink = `${adminFrontendUrl}/reset-password?token=${rawToken}`

    await sendAdminPasswordResetEmail(admin.email, admin.name, resetLink)
    await logSecurityEvent(admin.id, 'PASSWORD_RESET_REQUESTED', req)

    res.json(genericResponse)
  } catch (err) {
    logger.error('❌ forgotPassword error:', { message: err.message })
    res.status(500).json({ error: 'Failed to process request. Try again later.' })
  }
}

// ✅ Reset Password
export const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required.' })

  const passwordCheck = validatePassword(newPassword)
  if (!passwordCheck.valid) return res.status(400).json({ error: passwordCheck.message })

  try {
    const tokenHash = hashToken(token)
    const result = await pool.query(
      `SELECT aprt.id, aprt.admin_id, aprt.expires_at, aprt.used, a.name, a.email, a.password
       FROM admin_password_reset_tokens aprt
       JOIN cinema_admin_user a ON a.id = aprt.admin_id
       WHERE aprt.token_hash = $1`,
      [tokenHash]
    )

    if (result.rows.length === 0) {
      return res.status(400).json({ code: 'INVALID_TOKEN', error: 'Invalid or expired password reset link.' })
    }

    const record = result.rows[0]

    if (record.used) {
      return res.status(400).json({ code: 'TOKEN_USED', error: 'This reset link has already been used.' })
    }
    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ code: 'TOKEN_EXPIRED', error: 'This reset link has expired. Please request a new one.' })
    }

    const isSamePassword = await bcrypt.compare(newPassword, record.password)
    if (isSamePassword) {
      return res.status(400).json({ error: 'New password must be different from your current password.' })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12)

    await pool.query('BEGIN')
    try {
      await pool.query(
        `UPDATE cinema_admin_user SET password = $1, password_changed_at = now() WHERE id = $2`,
        [hashedPassword, record.admin_id]
      )
      await pool.query(`UPDATE admin_password_reset_tokens SET used = TRUE WHERE id = $1`, [record.id])
      await pool.query(`UPDATE admin_sessions SET is_revoked = TRUE WHERE admin_id = $1`, [record.admin_id])
      await pool.query('COMMIT')
    } catch (err) {
      await pool.query('ROLLBACK')
      throw err
    }

    const cookieOpts = { httpOnly: true, sameSite: isProduction ? 'None' : 'Lax', secure: isProduction }
    res.clearCookie('accessToken', cookieOpts)
    res.clearCookie('refreshToken', cookieOpts)

    sendAdminPasswordChangedEmail(record.email, record.name).catch(() => {})
    await logSecurityEvent(record.admin_id, 'PASSWORD_RESET_SUCCESS', req)

    res.json({ message: 'Password reset successfully. Please log in with your new password.' })
  } catch (err) {
    logger.error('❌ resetPassword error:', { message: err.message })
    res.status(500).json({ error: 'Password reset failed. Try again later.' })
  }
}

// ✅ Change Password (authenticated)
export const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body
  const adminId = req.admin.id

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required.' })
  }

  const passwordCheck = validatePassword(newPassword)
  if (!passwordCheck.valid) return res.status(400).json({ error: passwordCheck.message })

  try {
    const result = await pool.query('SELECT id, name, email, password FROM cinema_admin_user WHERE id = $1', [adminId])
    if (result.rows.length === 0) return res.status(404).json({ error: 'Admin not found.' })

    const admin = result.rows[0]

    const currentMatch = await bcrypt.compare(currentPassword, admin.password)
    if (!currentMatch) return res.status(401).json({ error: 'Current password is incorrect.' })

    const isSamePassword = await bcrypt.compare(newPassword, admin.password)
    if (isSamePassword) return res.status(400).json({ error: 'New password must be different from your current password.' })

    const hashedPassword = await bcrypt.hash(newPassword, 12)
    const currentRefreshToken = req.cookies.refreshToken
    const currentTokenHash = currentRefreshToken ? hashToken(currentRefreshToken) : null

    await pool.query('BEGIN')
    try {
      await pool.query(
        `UPDATE cinema_admin_user SET password = $1, password_changed_at = now() WHERE id = $2`,
        [hashedPassword, adminId]
      )
      if (currentTokenHash) {
        await pool.query(
          `UPDATE admin_sessions SET is_revoked = TRUE WHERE admin_id = $1 AND refresh_token_hash != $2`,
          [adminId, currentTokenHash]
        )
      } else {
        await pool.query(`UPDATE admin_sessions SET is_revoked = TRUE WHERE admin_id = $1`, [adminId])
      }
      await pool.query('COMMIT')
    } catch (err) {
      await pool.query('ROLLBACK')
      throw err
    }

    sendAdminPasswordChangedEmail(admin.email, admin.name).catch(() => {})
    await logSecurityEvent(adminId, 'PASSWORD_CHANGED', req)

    res.json({ message: 'Password changed successfully.' })
  } catch (err) {
    logger.error('❌ changePassword error:', { message: err.message })
    res.status(500).json({ error: 'Failed to change password. Try again later.' })
  }
}

// ✅ Logout
export const logoutCinemaAdmin = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken)
      await pool.query(
        `UPDATE admin_sessions SET is_revoked = TRUE WHERE refresh_token_hash = $1`,
        [tokenHash]
      ).catch((err) => logger.error('Failed to revoke session on logout:', { message: err.message }))
    }

    const cookieOpts = { httpOnly: true, sameSite: isProduction ? 'None' : 'Lax', secure: isProduction }
    res.clearCookie('accessToken', cookieOpts)
    res.clearCookie('refreshToken', cookieOpts)

    if (req.admin?.id) await logSecurityEvent(req.admin.id, 'LOGOUT', req)

    res.status(200).json({ message: 'Logged out successfully' })
  } catch (err) {
    logger.error('Logout error:', { error: err })
    res.status(500).json({ error: 'Logout failed' })
  }
}

// ✅ Logout All Devices
export const logoutAllDevices = async (req, res) => {
  const adminId = req.admin.id
  try {
    await pool.query(`UPDATE admin_sessions SET is_revoked = TRUE WHERE admin_id = $1`, [adminId])

    const cookieOpts = { httpOnly: true, sameSite: isProduction ? 'None' : 'Lax', secure: isProduction }
    res.clearCookie('accessToken', cookieOpts)
    res.clearCookie('refreshToken', cookieOpts)

    await logSecurityEvent(adminId, 'LOGOUT_ALL_DEVICES', req)
    res.json({ message: 'Signed out from all devices.' })
  } catch (err) {
    logger.error('❌ logoutAllDevices error:', { message: err.message })
    res.status(500).json({ error: 'Failed to sign out from all devices.' })
  }
}

// ✅ Get Security Info
export const getAdminSecurity = async (req, res) => {
  const adminId = req.admin.id
  try {
    const [adminResult, sessionsResult, logsResult] = await Promise.all([
      pool.query(
        `SELECT email_verified, email_verified_at, failed_login_attempts,
                account_locked_until, password_changed_at, last_login_at
         FROM cinema_admin_user WHERE id = $1`,
        [adminId]
      ),
      pool.query(
        `SELECT id, ip_address, user_agent, created_at, last_used_at
         FROM admin_sessions WHERE admin_id = $1 AND is_revoked = FALSE
         ORDER BY last_used_at DESC`,
        [adminId]
      ),
      pool.query(
        `SELECT action, ip_address, user_agent, metadata, created_at
         FROM admin_security_logs WHERE admin_id = $1
         ORDER BY created_at DESC LIMIT 20`,
        [adminId]
      ),
    ])

    if (adminResult.rows.length === 0) return res.status(404).json({ error: 'Admin not found.' })

    const a = adminResult.rows[0]
    res.json({
      emailVerified: a.email_verified,
      emailVerifiedAt: a.email_verified_at,
      failedLoginAttempts: a.failed_login_attempts,
      accountLockedUntil: a.account_locked_until,
      passwordChangedAt: a.password_changed_at,
      lastLoginAt: a.last_login_at,
      activeSessions: sessionsResult.rows,
      recentLogs: logsResult.rows,
    })
  } catch (err) {
    logger.error('❌ getAdminSecurity error:', { message: err.message })
    res.status(500).json({ error: 'Failed to load security info.' })
  }
}

// ✅ Get All Cinema Hall Admins (Super Admin only)
export const getAllAdmins = async (req, res) => {
  const { search, page = 1, limit: limitParam = 10 } = req.query
  const limit = Math.min(Math.max(parseInt(limitParam) || 10, 1), 100)
  const offset = (parseInt(page) - 1) * limit
  const searchParam = search?.trim() || null

  try {
    const [adminsResult, countResult] = await Promise.all([
      pool.query(
        `SELECT
          a.id, a.name, a.email, a.phone, a.role, a.email_verified, a.last_login_at, a.created_at,
          h.id AS hall_id, h.name AS hall_name, h.location, h.district, h.state
        FROM cinema_admin_user a
        LEFT JOIN cinema_hall h ON h.admin_id = a.id
        WHERE a.role != 'superAdmin'
          AND ($1::text IS NULL
            OR a.name ILIKE '%' || $1 || '%'
            OR a.email ILIKE '%' || $1 || '%'
            OR h.name ILIKE '%' || $1 || '%')
        ORDER BY a.created_at DESC
        LIMIT $2 OFFSET $3`,
        [searchParam, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM cinema_admin_user a
        LEFT JOIN cinema_hall h ON h.admin_id = a.id
        WHERE a.role != 'superAdmin'
          AND ($1::text IS NULL
            OR a.name ILIKE '%' || $1 || '%'
            OR a.email ILIKE '%' || $1 || '%'
            OR h.name ILIKE '%' || $1 || '%')`,
        [searchParam]
      ),
    ])

    res.json({
      admins: adminsResult.rows,
      total: parseInt(countResult.rows[0].count),
    })
  } catch (err) {
    logger.error('❌ getAllAdmins error:', { message: err.message })
    res.status(500).json({ error: 'Failed to fetch admins' })
  }
}

// ✅ Update Cinema Hall Details
export const updateCinemaHall = async (req, res) => {
  const { hall_name, hall_location, hall_district, hall_state, latitude, longitude } = req.body
  const adminId = req.admin.id

  if (!hall_name || !hall_location) {
    return res.status(400).json({ error: 'Hall name and location are required.' })
  }

  try {
    const result = await pool.query(
      `UPDATE cinema_hall
       SET name = $1, location = $2, district = $3, state = $4, latitude = $5, longitude = $6
       WHERE admin_id = $7
       RETURNING id, name, location, district, state, latitude, longitude, created_at`,
      [hall_name, hall_location, hall_district || '', hall_state || '', latitude ?? null, longitude ?? null, adminId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cinema hall not found.' })
    }

    const hall = result.rows[0]
    res.json({
      message: 'Cinema hall updated successfully.',
      hall: {
        ...hall,
        latitude: hall.latitude ? parseFloat(hall.latitude) : null,
        longitude: hall.longitude ? parseFloat(hall.longitude) : null,
      },
    })
  } catch (err) {
    logger.error('❌ updateCinemaHall error:', { message: err.message })
    res.status(500).json({ error: 'Failed to update cinema hall.' })
  }
}
