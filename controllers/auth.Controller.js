import pool from '../db.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { generateTokenAndSetCookie, resolveOrgContext } from '../utils/generateTokenAndSetCookie.js'
import { generateVerificationToken } from '../utils/generateVerificationToken.js'
import { hashToken } from '../utils/hashToken.js'
import { validatePassword } from '../utils/passwordPolicy.js'
import { verifyGoogleToken, exchangeGithubCode, getGithubUser } from '../utils/oauthProviders.js'
import { checkOAuthRateLimit } from '../utils/oauthRateLimit.js'
import {
  sendAdminVerificationEmail,
  sendAdminPasswordResetEmail,
  sendAdminPasswordChangedEmail,
  sendAdminAccountLockedEmail,
} from '../mail/emails.js'
import logger from '../utils/logger.js'
import * as teamService from '../services/team.service.js'
import { resolveOrgId } from '../middleware/requirePermission.js'

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

/**
 * Load an admin's permission keys for a login response. Never throws — a
 * permission-load failure must not block an otherwise valid login.
 */
const resolveLoginPermissions = async (adminId, orgId) => {
  if (!orgId) return []
  try {
    return [...await teamService.loadAdminPermissions(adminId, orgId)]
  } catch (e) {
    logger.error('Failed to load permissions on login:', { message: e.message })
    return []
  }
}

/**
 * Pick a default hall for a session, using the same access rule as
 * requireActiveHall: a hall the admin owns, one explicitly assigned to them,
 * or — for org-wide roles — any hall in the org.
 *
 * Login and /me used to resolve this with `LEFT JOIN cinema_hall ON admin_id`,
 * which only ever matches the hall's creator. An invited member therefore got
 * hall: null even with halls assigned to them, so the client announced
 * "set up your first cinema hall" to someone who already had two.
 *
 * Never throws — a hall lookup must not block an otherwise valid login.
 */
const resolveDefaultHall = async (adminId, orgId) => {
  if (!orgId) return null
  try {
    const { rows } = await pool.query(
      `SELECT ch.id, ch.name, ch.location, ch.district, ch.state,
              ch.latitude, ch.longitude, ch.created_at
       FROM cinema_hall ch
       WHERE ch.org_id = $2
         AND (
           ch.admin_id = $1
           OR EXISTS (
             SELECT 1 FROM hall_assignments ha
             JOIN organization_members om ON om.id = ha.org_member_id
             WHERE ha.hall_id = ch.id AND om.admin_id = $1 AND om.status = 'active'
           )
           OR EXISTS (
             SELECT 1 FROM organization_members om
             JOIN roles r ON r.id = om.role_id
             WHERE om.admin_id = $1 AND om.org_id = $2
               AND om.status = 'active' AND r.key IN ('owner', 'admin')
           )
         )
       ORDER BY (ch.admin_id = $1) DESC, ch.created_at ASC
       LIMIT 1`,
      [adminId, orgId]
    )
    if (rows.length === 0) return null
    const h = rows[0]
    return {
      id: h.id,
      name: h.name,
      location: h.location,
      district: h.district,
      state: h.state,
      latitude: h.latitude ? parseFloat(h.latitude) : null,
      longitude: h.longitude ? parseFloat(h.longitude) : null,
      created_at: h.created_at,
    }
  } catch (e) {
    logger.error('Failed to resolve default hall:', { message: e.message })
    return null
  }
}

// ✅ Register Admin
export const registerCinemaAdmin = async (req, res) => {
  const { name, email, password, phone } = req.body

  if (!name || !email || !password || !phone) {
    return res.status(400).json({ error: 'Name, email, password, and phone are required.' })
  }

  const passwordError = validatePassword(password)
  if (passwordError) {
    return res.status(400).json({ error: passwordError })
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

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE cinema_admin_user SET email_verified = TRUE, email_verified_at = now() WHERE id = $1`,
        [record.admin_id]
      )
      await client.query(`DELETE FROM admin_verification_tokens WHERE admin_id = $1`, [record.admin_id])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    await logSecurityEvent(record.admin_id, 'EMAIL_VERIFIED', req)
    res.status(200).json({ message: 'Email verified successfully. You can now log in.' })
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
      return res.status(200).json(genericResponse)
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

    const rawToken = generateVerificationToken()
    const tokenHash = hashToken(rawToken)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`DELETE FROM admin_verification_tokens WHERE admin_id = $1`, [admin.id])
      await client.query(
        `INSERT INTO admin_verification_tokens (admin_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [admin.id, tokenHash, expiresAt]
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    const adminFrontendUrl = process.env.ADMIN_FRONTEND_URL || 'http://localhost:5174'
    const verificationLink = `${adminFrontendUrl}/verify-email?token=${rawToken}`

    await sendAdminVerificationEmail(admin.email, admin.name, verificationLink)
    await logSecurityEvent(admin.id, 'RESEND_VERIFICATION', req)

    res.status(200).json(genericResponse)
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
    const {
      accessToken, refreshToken,
      orgId: loginOrgId, roleKey: loginRoleKey,
    } = await generateTokenAndSetCookie(res, tokenPayload, meta)

    await logSecurityEvent(admin.admin_id, 'LOGIN_SUCCESS', req)

    const loginPermissions = await resolveLoginPermissions(admin.admin_id, loginOrgId)
    const loginHall = await resolveDefaultHall(admin.admin_id, loginOrgId)

    res.status(200).json({
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
        orgId: loginOrgId,
        roleKey: loginRoleKey,
        permissions: loginPermissions,
      },
      hall: loginHall,
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

    // Re-read the org context instead of copying it out of the old token.
    // A refresh is how a client recovers from TOKEN_STALE, so carrying the
    // stale permissionsVersion forward would loop forever.
    const { orgId, roleKey, permissionsVersion } = await resolveOrgContext(adminId)

    const newAccessToken = jwt.sign(
      { id: admin.id, name: admin.name, email: admin.email, role: admin.role, orgId, roleKey, permissionsVersion },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    )

    res.cookie('accessToken', newAccessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 1 * 24 * 60 * 60 * 1000,
    })

    res.status(200).json({ success: true })
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
        a.auth_providers, a.avatar, a.password IS NOT NULL AS has_password,
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

    // Org context comes from the shared resolver, not from a LEFT JOIN on
    // organization_members. That join had no ORDER BY or LIMIT, so an admin in
    // two orgs got whichever row Postgres happened to return first — /me could
    // disagree with the token minted at login, and the answer could even change
    // between two refreshes.
    const { orgId, roleKey, permissionsVersion } = await resolveOrgContext(adminId)

    // Resolved through access, not ownership — see resolveDefaultHall.
    const hall = await resolveDefaultHall(adminId, orgId)

    let permissions = []
    if (orgId) {
      try {
        const permsSet = await teamService.loadAdminPermissions(adminId, orgId)
        permissions = [...permsSet]
      } catch (e) {
        logger.error('Failed to load permissions for me:', { message: e.message })
      }
    }

    res.status(200).json({
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
        auth_providers: row.auth_providers || ['local'],
        avatar: row.avatar,
        has_password: row.has_password,
        created_at: row.admin_created_at,
        orgId,
        roleKey,
        permissionsVersion,
        permissions,
      },
      hall,
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
      return res.status(200).json(genericResponse)
    }

    const admin = result.rows[0]

    const rawToken = generateVerificationToken()
    const tokenHash = hashToken(rawToken)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`DELETE FROM admin_password_reset_tokens WHERE admin_id = $1`, [admin.id])
      await client.query(
        `INSERT INTO admin_password_reset_tokens (admin_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [admin.id, tokenHash, expiresAt]
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    const adminFrontendUrl = process.env.ADMIN_FRONTEND_URL || 'http://localhost:5174'
    const resetLink = `${adminFrontendUrl}/reset-password?token=${rawToken}`

    await sendAdminPasswordResetEmail(admin.email, admin.name, resetLink)
    await logSecurityEvent(admin.id, 'PASSWORD_RESET_REQUESTED', req)

    res.status(200).json(genericResponse)
  } catch (err) {
    logger.error('❌ forgotPassword error:', { message: err.message })
    res.status(500).json({ error: 'Failed to process request. Try again later.' })
  }
}

// ✅ Reset Password
export const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required.' })

  const passwordError = validatePassword(newPassword)
  if (passwordError) return res.status(400).json({ error: passwordError })

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

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE cinema_admin_user SET password = $1, password_changed_at = now() WHERE id = $2`,
        [hashedPassword, record.admin_id]
      )
      await client.query(`UPDATE admin_password_reset_tokens SET used = TRUE WHERE id = $1`, [record.id])
      await client.query(`UPDATE admin_sessions SET is_revoked = TRUE WHERE admin_id = $1`, [record.admin_id])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    const cookieOpts = { httpOnly: true, sameSite: isProduction ? 'None' : 'Lax', secure: isProduction }
    res.clearCookie('accessToken', cookieOpts)
    res.clearCookie('refreshToken', cookieOpts)

    sendAdminPasswordChangedEmail(record.email, record.name).catch(() => {})
    await logSecurityEvent(record.admin_id, 'PASSWORD_RESET_SUCCESS', req)

    res.status(200).json({ message: 'Password reset successfully. Please log in with your new password.' })
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

  const passwordError = validatePassword(newPassword)
  if (passwordError) return res.status(400).json({ error: passwordError })

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

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE cinema_admin_user SET password = $1, password_changed_at = now() WHERE id = $2`,
        [hashedPassword, adminId]
      )
      if (currentTokenHash) {
        await client.query(
          `UPDATE admin_sessions SET is_revoked = TRUE WHERE admin_id = $1 AND refresh_token_hash != $2`,
          [adminId, currentTokenHash]
        )
      } else {
        await client.query(`UPDATE admin_sessions SET is_revoked = TRUE WHERE admin_id = $1`, [adminId])
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    sendAdminPasswordChangedEmail(admin.email, admin.name).catch(() => {})
    await logSecurityEvent(adminId, 'PASSWORD_CHANGED', req)

    res.status(200).json({ message: 'Password changed successfully.' })
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
    res.status(200).json({ message: 'Signed out from all devices.' })
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
    res.status(200).json({
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
          a.id, a.name, a.email, a.phone, a.role,
          a.email_verified, a.email_verified_at, a.last_login_at, a.created_at,
          a.auth_providers, a.avatar,
          COALESCE(
            (SELECT json_agg(json_build_object(
              'id', h.id, 'name', h.name, 'location', h.location, 'district', h.district, 'state', h.state
            )) FROM cinema_hall h WHERE h.admin_id = a.id),
            '[]'::json
          ) AS halls
        FROM cinema_admin_user a
        WHERE a.role = 'admin'
          AND ($1::text IS NULL
            OR a.name ILIKE '%' || $1 || '%'
            OR a.email ILIKE '%' || $1 || '%'
            OR EXISTS (SELECT 1 FROM cinema_hall h WHERE h.admin_id = a.id AND h.name ILIKE '%' || $1 || '%'))
        ORDER BY a.created_at DESC
        LIMIT $2 OFFSET $3`,
        [searchParam, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM cinema_admin_user a
        WHERE a.role = 'admin'
          AND ($1::text IS NULL
            OR a.name ILIKE '%' || $1 || '%'
            OR a.email ILIKE '%' || $1 || '%'
            OR EXISTS (SELECT 1 FROM cinema_hall h WHERE h.admin_id = a.id AND h.name ILIKE '%' || $1 || '%'))`,
        [searchParam]
      ),
    ])

    res.status(200).json({
      admins: adminsResult.rows,
      total: parseInt(countResult.rows[0].count),
    })
  } catch (err) {
    logger.error('❌ getAllAdmins error:', { message: err.message })
    res.status(500).json({ error: 'Failed to fetch admins' })
  }
}

// ✅ Get Security Logs for a specific admin (Super Admin only)
export const getAdminSecurityLogs = async (req, res) => {
  const { id } = req.params
  try {
    const [adminResult, logsResult] = await Promise.all([
      pool.query(
        `SELECT a.id, a.name, a.email, a.role, a.email_verified, a.email_verified_at,
                a.failed_login_attempts, a.account_locked_until, a.password_changed_at, a.last_login_at, a.created_at,
                a.auth_providers, a.avatar,
                COALESCE(
                  (SELECT json_agg(json_build_object(
                    'id', h.id, 'name', h.name, 'location', h.location, 'district', h.district, 'state', h.state
                  )) FROM cinema_hall h WHERE h.admin_id = a.id),
                  '[]'::json
                ) AS halls
         FROM cinema_admin_user a
         WHERE a.id = $1 AND a.role != 'superAdmin'`,
        [id]
      ),
      pool.query(
        `SELECT action, ip_address, user_agent, metadata, created_at
         FROM admin_security_logs WHERE admin_id = $1
         ORDER BY created_at DESC LIMIT 30`,
        [id]
      ),
    ])

    if (adminResult.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found.' })
    }

    res.status(200).json({ admin: adminResult.rows[0], logs: logsResult.rows })
  } catch (err) {
    logger.error('❌ getAdminSecurityLogs error:', { message: err.message })
    res.status(500).json({ error: 'Failed to fetch admin security logs.' })
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
    res.status(200).json({
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

// ✅ Google OAuth Login (Admin)
export const googleLoginAdmin = async (req, res) => {
  const { idToken } = req.body
  if (!idToken) return res.status(400).json({ error: 'Google ID token is required.' })

  // Rate limiting
  const rateCheck = checkOAuthRateLimit(req.ip, 'admin-google-login')
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'Too many login attempts. Please try again later.',
      retryAfterMs: rateCheck.retryAfterMs,
    })
  }

  try {
    const googleUser = await verifyGoogleToken(idToken)

    // Look up admin by email
    const result = await pool.query(
      `SELECT a.id AS admin_id, a.name AS admin_name, a.email, a.phone, a.role,
              a.email_verified, a.auth_providers, a.provider_ids, a.avatar,
              a.account_locked_until,
              h.id AS hall_id, h.name AS hall_name, h.location AS hall_location,
              h.district AS hall_district, h.state AS hall_state,
              h.latitude AS hall_latitude, h.longitude AS hall_longitude,
              h.created_at AS hall_created_at
       FROM cinema_admin_user a
       LEFT JOIN cinema_hall h ON h.admin_id = a.id
       WHERE a.email = $1`,
      [googleUser.email]
    )

    let admin
    let isNewAccount = false

    if (result.rows.length === 0) {
      // Case A — New admin account via Google
      const insertResult = await pool.query(
        `INSERT INTO cinema_admin_user (name, email, password, phone, email_verified, email_verified_at, auth_providers, provider_ids, avatar)
         VALUES ($1, $2, NULL, NULL, TRUE, now(), ARRAY['google'], $3, $4)
         RETURNING id, name, email, phone, role, email_verified, auth_providers, avatar, created_at`,
        [googleUser.name, googleUser.email, JSON.stringify({ google: googleUser.googleId }), googleUser.picture]
      )
      admin = insertResult.rows[0]
      admin.admin_id = admin.id
      admin.admin_name = admin.name
      isNewAccount = true
      await logSecurityEvent(admin.id, 'REGISTER_GOOGLE', req)
    } else {
      admin = result.rows[0]

      // Check lockout
      if (admin.account_locked_until && new Date(admin.account_locked_until) > new Date()) {
        const remainingMs = new Date(admin.account_locked_until).getTime() - Date.now()
        const remainingMins = Math.ceil(remainingMs / 60000)
        return res.status(423).json({
          code: 'ACCOUNT_LOCKED',
          error: `Account is temporarily locked. Try again in ${remainingMins} minute${remainingMins === 1 ? '' : 's'}.`,
          lockedUntil: admin.account_locked_until,
        })
      }

      // Case B — Existing local account, link Google
      if (!admin.auth_providers.includes('google')) {
        const updatedProviderIds = { ...(admin.provider_ids || {}), google: googleUser.googleId }
        const updatedProviders = [...new Set([...(admin.auth_providers || []), 'google'])]
        await pool.query(
          `UPDATE cinema_admin_user
           SET auth_providers = $1, provider_ids = $2, avatar = COALESCE(avatar, $3),
               email_verified = TRUE, email_verified_at = COALESCE(email_verified_at, now())
           WHERE id = $4`,
          [updatedProviders, JSON.stringify(updatedProviderIds), googleUser.picture, admin.admin_id]
        )
        await logSecurityEvent(admin.admin_id, 'LINK_GOOGLE', req)
      } else {
        // Case C — Existing Google account, update avatar
        await pool.query(
          `UPDATE cinema_admin_user SET avatar = $1 WHERE id = $2`,
          [googleUser.picture, admin.admin_id]
        )
      }
    }

    const adminId = admin.admin_id || admin.id
    // Update last_login_at and reset lockout
    await pool.query(
      `UPDATE cinema_admin_user SET last_login_at = now(), failed_login_attempts = 0, account_locked_until = NULL WHERE id = $1`,
      [adminId]
    )

    const tokenPayload = { id: adminId, name: admin.admin_name || admin.name, email: admin.email || googleUser.email, role: admin.role || 'admin' }
    const meta = { ip: req.ip, userAgent: req.headers['user-agent'] }
    const {
      accessToken, refreshToken,
      orgId: loginOrgId, roleKey: loginRoleKey,
    } = await generateTokenAndSetCookie(res, tokenPayload, meta)

    await logSecurityEvent(adminId, 'LOGIN_GOOGLE', req)

    const loginPermissions = await resolveLoginPermissions(adminId, loginOrgId)

    // Re-fetch full admin data for response
    const fullResult = await pool.query(
      `SELECT a.id AS admin_id, a.name AS admin_name, a.email, a.phone, a.role,
              a.email_verified, a.auth_providers, a.avatar, a.created_at AS admin_created_at,
              h.id AS hall_id, h.name AS hall_name, h.location AS hall_location,
              h.district AS hall_district, h.state AS hall_state,
              h.latitude AS hall_latitude, h.longitude AS hall_longitude,
              h.created_at AS hall_created_at
       FROM cinema_admin_user a
       LEFT JOIN cinema_hall h ON h.admin_id = a.id
       WHERE a.id = $1`,
      [adminId]
    )
    const row = fullResult.rows[0]

    res.status(200).json({
      message: isNewAccount ? 'Account created successfully' : 'Login successful',
      accessToken,
      refreshToken,
      admin: {
        id: row.admin_id,
        name: row.admin_name,
        email: row.email,
        phone: row.phone,
        role: row.role,
        email_verified: row.email_verified,
        auth_providers: row.auth_providers,
        avatar: row.avatar,
        created_at: row.admin_created_at,
        orgId: loginOrgId,
        roleKey: loginRoleKey,
        permissions: loginPermissions,
      },
      hall: await resolveDefaultHall(adminId, loginOrgId),
    })
  } catch (err) {
    logger.error('❌ Google login error:', { message: err.message })
    if (err.message.includes('Token used too late') || err.message.includes('Invalid token')) {
      return res.status(401).json({ error: 'Invalid or expired Google token. Please try again.' })
    }
    res.status(500).json({ error: 'Google login failed. Try again later.' })
  }
}

// ✅ GitHub OAuth Login (Admin)
export const githubLoginAdmin = async (req, res) => {
  const { code } = req.body
  if (!code) return res.status(400).json({ error: 'GitHub authorization code is required.' })

  // Rate limiting
  const rateCheck = checkOAuthRateLimit(req.ip, 'admin-github-login')
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'Too many login attempts. Please try again later.',
      retryAfterMs: rateCheck.retryAfterMs,
    })
  }

  try {
    const accessTokenGH = await exchangeGithubCode(code)
    const githubUser = await getGithubUser(accessTokenGH)

    // Look up admin by email
    const result = await pool.query(
      `SELECT a.id AS admin_id, a.name AS admin_name, a.email, a.phone, a.role,
              a.email_verified, a.auth_providers, a.provider_ids, a.avatar,
              a.account_locked_until,
              h.id AS hall_id, h.name AS hall_name, h.location AS hall_location,
              h.district AS hall_district, h.state AS hall_state,
              h.latitude AS hall_latitude, h.longitude AS hall_longitude,
              h.created_at AS hall_created_at
       FROM cinema_admin_user a
       LEFT JOIN cinema_hall h ON h.admin_id = a.id
       WHERE a.email = $1`,
      [githubUser.email]
    )

    let admin
    let isNewAccount = false

    if (result.rows.length === 0) {
      // New admin account via GitHub
      const insertResult = await pool.query(
        `INSERT INTO cinema_admin_user (name, email, password, phone, email_verified, email_verified_at, auth_providers, provider_ids, avatar)
         VALUES ($1, $2, NULL, NULL, $3, ${githubUser.emailVerified ? 'now()' : 'NULL'}, ARRAY['github'], $4, $5)
         RETURNING id, name, email, phone, role, email_verified, auth_providers, avatar, created_at`,
        [githubUser.name, githubUser.email, githubUser.emailVerified, JSON.stringify({ github: githubUser.githubId }), githubUser.picture]
      )
      admin = insertResult.rows[0]
      admin.admin_id = admin.id
      admin.admin_name = admin.name
      isNewAccount = true
      await logSecurityEvent(admin.id, 'REGISTER_GITHUB', req)
    } else {
      admin = result.rows[0]

      // Check lockout
      if (admin.account_locked_until && new Date(admin.account_locked_until) > new Date()) {
        const remainingMs = new Date(admin.account_locked_until).getTime() - Date.now()
        const remainingMins = Math.ceil(remainingMs / 60000)
        return res.status(423).json({
          code: 'ACCOUNT_LOCKED',
          error: `Account is temporarily locked. Try again in ${remainingMins} minute${remainingMins === 1 ? '' : 's'}.`,
          lockedUntil: admin.account_locked_until,
        })
      }

      // Link GitHub if not already linked
      if (!admin.auth_providers.includes('github')) {
        const updatedProviderIds = { ...(admin.provider_ids || {}), github: githubUser.githubId }
        const updatedProviders = [...new Set([...(admin.auth_providers || []), 'github'])]
        await pool.query(
          `UPDATE cinema_admin_user
           SET auth_providers = $1, provider_ids = $2, avatar = COALESCE(avatar, $3),
               email_verified = TRUE, email_verified_at = COALESCE(email_verified_at, now())
           WHERE id = $4`,
          [updatedProviders, JSON.stringify(updatedProviderIds), githubUser.picture, admin.admin_id]
        )
        await logSecurityEvent(admin.admin_id, 'LINK_GITHUB', req)
      } else {
        await pool.query(
          `UPDATE cinema_admin_user SET avatar = $1 WHERE id = $2`,
          [githubUser.picture, admin.admin_id]
        )
      }
    }

    const adminId = admin.admin_id || admin.id
    await pool.query(
      `UPDATE cinema_admin_user SET last_login_at = now(), failed_login_attempts = 0, account_locked_until = NULL WHERE id = $1`,
      [adminId]
    )

    const tokenPayload = { id: adminId, name: admin.admin_name || admin.name, email: admin.email || githubUser.email, role: admin.role || 'admin' }
    const meta = { ip: req.ip, userAgent: req.headers['user-agent'] }
    const {
      accessToken, refreshToken,
      orgId: loginOrgId, roleKey: loginRoleKey,
    } = await generateTokenAndSetCookie(res, tokenPayload, meta)

    await logSecurityEvent(adminId, 'LOGIN_GITHUB', req)

    const loginPermissions = await resolveLoginPermissions(adminId, loginOrgId)

    const fullResult = await pool.query(
      `SELECT a.id AS admin_id, a.name AS admin_name, a.email, a.phone, a.role,
              a.email_verified, a.auth_providers, a.avatar, a.created_at AS admin_created_at,
              h.id AS hall_id, h.name AS hall_name, h.location AS hall_location,
              h.district AS hall_district, h.state AS hall_state,
              h.latitude AS hall_latitude, h.longitude AS hall_longitude,
              h.created_at AS hall_created_at
       FROM cinema_admin_user a
       LEFT JOIN cinema_hall h ON h.admin_id = a.id
       WHERE a.id = $1`,
      [adminId]
    )
    const row = fullResult.rows[0]

    res.status(200).json({
      message: isNewAccount ? 'Account created successfully' : 'Login successful',
      accessToken,
      refreshToken,
      admin: {
        id: row.admin_id,
        name: row.admin_name,
        email: row.email,
        phone: row.phone,
        role: row.role,
        email_verified: row.email_verified,
        auth_providers: row.auth_providers,
        avatar: row.avatar,
        created_at: row.admin_created_at,
        orgId: loginOrgId,
        roleKey: loginRoleKey,
        permissions: loginPermissions,
      },
      hall: await resolveDefaultHall(adminId, loginOrgId),
    })
  } catch (err) {
    logger.error('❌ GitHub login error:', { message: err.message })
    if (err.message.includes('No verified email')) {
      return res.status(400).json({ error: err.message })
    }
    if (err.message.includes('token exchange failed')) {
      return res.status(401).json({ error: 'Invalid or expired GitHub authorization code. Please try again.' })
    }
    res.status(500).json({ error: 'GitHub login failed. Try again later.' })
  }
}

// ✅ Link OAuth Provider (Admin - Authenticated)
export const linkProviderAdmin = async (req, res) => {
  const adminId = req.admin.id
  const { provider, idToken, code } = req.body

  if (!provider || !['google', 'github'].includes(provider)) {
    return res.status(400).json({ error: 'Invalid provider. Supported: google, github.' })
  }

  try {
    const adminResult = await pool.query(
      'SELECT id, email, auth_providers, provider_ids FROM cinema_admin_user WHERE id = $1',
      [adminId]
    )
    if (adminResult.rows.length === 0) return res.status(404).json({ error: 'Admin not found.' })

    const admin = adminResult.rows[0]

    if (admin.auth_providers.includes(provider)) {
      return res.status(400).json({ error: `${provider} is already linked to your account.` })
    }

    let providerEmail, providerId, avatar

    if (provider === 'google') {
      if (!idToken) return res.status(400).json({ error: 'Google ID token is required.' })
      const googleUser = await verifyGoogleToken(idToken)
      if (googleUser.email !== admin.email) {
        return res.status(400).json({ error: 'Google email does not match your account email.' })
      }
      providerEmail = googleUser.email
      providerId = googleUser.googleId
      avatar = googleUser.picture
    } else if (provider === 'github') {
      if (!code) return res.status(400).json({ error: 'GitHub authorization code is required.' })
      const accessTokenGH = await exchangeGithubCode(code)
      const githubUser = await getGithubUser(accessTokenGH)
      if (githubUser.email !== admin.email) {
        return res.status(400).json({ error: 'GitHub email does not match your account email.' })
      }
      providerEmail = githubUser.email
      providerId = githubUser.githubId
      avatar = githubUser.picture
    }

    const updatedProviderIds = { ...(admin.provider_ids || {}), [provider]: providerId }
    const updatedProviders = [...new Set([...(admin.auth_providers || []), provider])]

    await pool.query(
      `UPDATE cinema_admin_user SET auth_providers = $1, provider_ids = $2, avatar = COALESCE(avatar, $3) WHERE id = $4`,
      [updatedProviders, JSON.stringify(updatedProviderIds), avatar, adminId]
    )

    await logSecurityEvent(adminId, `LINK_${provider.toUpperCase()}`, req)
    res.status(200).json({ message: `${provider} account linked successfully.`, auth_providers: updatedProviders })
  } catch (err) {
    logger.error('❌ linkProvider error:', { message: err.message })
    res.status(500).json({ error: 'Failed to link provider. Try again later.' })
  }
}

// ✅ Unlink OAuth Provider (Admin - Authenticated)
export const unlinkProviderAdmin = async (req, res) => {
  const adminId = req.admin.id
  const { provider } = req.body

  if (!provider || !['google', 'github'].includes(provider)) {
    return res.status(400).json({ error: 'Invalid provider. Supported: google, github.' })
  }

  try {
    const adminResult = await pool.query(
      'SELECT id, password, auth_providers, provider_ids FROM cinema_admin_user WHERE id = $1',
      [adminId]
    )
    if (adminResult.rows.length === 0) return res.status(404).json({ error: 'Admin not found.' })

    const admin = adminResult.rows[0]

    if (!admin.auth_providers.includes(provider)) {
      return res.status(400).json({ error: `${provider} is not linked to your account.` })
    }

    // Prevent removing last auth method
    const remainingProviders = admin.auth_providers.filter(p => p !== provider)
    const hasPassword = !!admin.password
    if (remainingProviders.length === 0 && !hasPassword) {
      return res.status(400).json({ error: 'Cannot remove your only login method. Add a password or another provider first.' })
    }
    if (remainingProviders.filter(p => p !== 'local').length === 0 && !hasPassword) {
      return res.status(400).json({ error: 'Cannot remove your only login method. Set a password first.' })
    }

    const updatedProviderIds = { ...(admin.provider_ids || {}) }
    delete updatedProviderIds[provider]

    await pool.query(
      `UPDATE cinema_admin_user SET auth_providers = $1, provider_ids = $2 WHERE id = $3`,
      [remainingProviders, JSON.stringify(updatedProviderIds), adminId]
    )

    await logSecurityEvent(adminId, `UNLINK_${provider.toUpperCase()}`, req)
    res.status(200).json({ message: `${provider} account unlinked successfully.`, auth_providers: remainingProviders })
  } catch (err) {
    logger.error('❌ unlinkProvider error:', { message: err.message })
    res.status(500).json({ error: 'Failed to unlink provider. Try again later.' })
  }
}

// ✅ Set Password (for OAuth-only admin accounts)
export const setPasswordAdmin = async (req, res) => {
  const adminId = req.admin.id
  const { newPassword } = req.body

  if (!newPassword) return res.status(400).json({ error: 'New password is required.' })

  const passwordError = validatePassword(newPassword)
  if (passwordError) return res.status(400).json({ error: passwordError })

  try {
    const adminResult = await pool.query(
      'SELECT id, password, auth_providers FROM cinema_admin_user WHERE id = $1',
      [adminId]
    )
    if (adminResult.rows.length === 0) return res.status(404).json({ error: 'Admin not found.' })

    const admin = adminResult.rows[0]

    if (admin.password) {
      return res.status(400).json({ error: 'You already have a password set. Use change password instead.' })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12)
    const updatedProviders = [...new Set([...(admin.auth_providers || []), 'local'])]

    await pool.query(
      `UPDATE cinema_admin_user SET password = $1, auth_providers = $2, password_changed_at = now() WHERE id = $3`,
      [hashedPassword, updatedProviders, adminId]
    )

    await logSecurityEvent(adminId, 'SET_PASSWORD', req)
    res.status(200).json({ message: 'Password set successfully. You can now login with email and password.', auth_providers: updatedProviders })
  } catch (err) {
    logger.error('❌ setPassword error:', { message: err.message })
    res.status(500).json({ error: 'Failed to set password. Try again later.' })
  }
}

// ✅ Validate Invite Token (public)
export const validateInviteToken = async (req, res) => {
  const { token } = req.query
  if (!token) return res.status(400).json({ error: 'Invite token is required.' })

  try {
    const result = await teamService.validateInviteToken(token)
    if (!result) {
      return res.status(400).json({ code: 'INVALID_TOKEN', error: 'Invalid invite link.' })
    }
    if (result.expired) {
      return res.status(400).json({ code: 'TOKEN_EXPIRED', error: 'Invite link has expired.' })
    }
    res.status(200).json({
      email: result.email,
      name: result.name,
      orgName: result.orgName,
      invitedBy: result.invitedBy,
    })
  } catch (err) {
    logger.error('❌ validateInviteToken error:', { message: err.message })
    res.status(500).json({ error: 'Failed to validate invite token.' })
  }
}

// ✅ Accept Invite (public)
export const acceptInvite = async (req, res) => {
  const { token, newPassword } = req.body
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password are required.' })
  }

  const passwordError = validatePassword(newPassword)
  if (passwordError) return res.status(400).json({ error: passwordError })

  try {
    const result = await teamService.acceptInvite(token, newPassword)
    if (result.error) {
      const statusCode = result.error === 'TOKEN_EXPIRED' ? 400 : 400
      return res.status(statusCode).json({ code: result.error, error: result.message })
    }
    res.status(200).json({ message: 'Invite accepted successfully. You can now log in.' })
  } catch (err) {
    logger.error('❌ acceptInvite error:', { message: err.message })
    res.status(500).json({ error: 'Failed to accept invite. Try again later.' })
  }
}

// ✅ Complete Onboarding (Organization + Hall setup)
export const completeOnboarding = async (req, res) => {
  const { orgName, name, location, district, state, latitude, longitude, phone, description } = req.body;
  const adminId = req.admin.id;

  if (!orgName) {
    return res.status(400).json({ error: 'Organization name is required.' });
  }
  if (!name || !location || !district || !state) {
    return res.status(400).json({ error: 'Cinema Hall name, location, district, and state are required.' });
  }

  // Only account holders create organizations. This endpoint used to be
  // guarded by nothing but a valid access token, so any authenticated user —
  // a Finance staff member included — could mint an org and become its Owner
  // with every permission. The frontend redirect that sends staff away from
  // /onboarding is UI-only and does nothing for a direct request.
  //
  // This is also the last remaining source of hall-less shell orgs: one owned
  // by someone who already belongs elsewhere used to hijack their sign-in.
  if (req.admin.role === 'staff') {
    return res.status(403).json({
      error: 'Staff accounts cannot create an organization. Ask your organization owner for access.',
    });
  }

  try {
    const existingOrgId = await resolveOrgId(adminId);
    if (existingOrgId) {
      // An owner re-running onboarding is resolved below against their own
      // org, which keeps the flow idempotent. Reaching here means the caller
      // belongs to an org someone else owns.
      const { rows } = await pool.query(
        `SELECT 1 FROM organizations WHERE id = $1 AND owner_id = $2`,
        [existingOrgId, adminId]
      );
      if (rows.length === 0) {
        return res.status(403).json({
          error: 'You already belong to an organization.',
        });
      }
    }
  } catch (err) {
    logger.error('Onboarding membership check failed:', { message: err.message });
    return res.status(500).json({ error: 'Onboarding failed. Try again later.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Resolve or create organization
    let orgId;
    const orgCheck = await client.query(
      `SELECT id FROM organizations WHERE owner_id = $1 AND is_active = TRUE LIMIT 1`,
      [adminId]
    );

    if (orgCheck.rows.length > 0) {
      orgId = orgCheck.rows[0].id;
    } else {
      const baseName = orgName.replace(/[^a-zA-Z0-9 ]/g, '');
      const slugBase = baseName.toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-') || 'cinema';
      const uniqueSlug = `${slugBase}-${adminId.toString().slice(0, 8)}`;
      
      const orgResult = await client.query(
        `INSERT INTO organizations (name, slug, owner_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE SET owner_id = EXCLUDED.owner_id
         RETURNING id`,
        [orgName.trim(), uniqueSlug, adminId]
      );
      orgId = orgResult.rows[0].id;
    }

    // 2. Seed system roles for the organization
    const rolesToSeed = [
      ['owner',           'Owner',           'Full access to all features including billing and org management'],
      ['admin',           'Admin',           'Full access except billing, org deletion, and role management'],
      ['manager',         'Manager',         'Manage shows, screens, bookings, refunds, and view customers'],
      ['sales',           'Sales',           'Handle bookings, refunds, and customer inquiries'],
      ['finance',         'Finance',         'View bookings, payments, refunds, and analytics'],
      ['marketing',       'Marketing',       'Manage offers, ads, and view customer analytics'],
      ['ticket_operator', 'Ticket Operator',  'Verify tickets and view bookings and shows'],
      ['auditor',         'Auditor',         'Read-only access across all resources']
    ];

    for (const [key, label, desc] of rolesToSeed) {
      await client.query(
        `INSERT INTO roles (org_id, key, label, description, is_system)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (org_id, key) DO NOTHING`,
        [orgId, key, label, desc]
      );
    }

    // 3. Seed role_permissions for system roles
    const rolesResult = await client.query(`SELECT id, key FROM roles WHERE org_id = $1`, [orgId]);
    const rolesMap = {};
    rolesResult.rows.forEach(r => { rolesMap[r.key] = r.id; });

    // Owner role (all permissions)
    if (rolesMap['owner']) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM permissions p
         ON CONFLICT DO NOTHING`,
        [rolesMap['owner']]
      );
    }
    // Admin role (all except org.delete, roles.manage, billing.manage)
    if (rolesMap['admin']) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM permissions p
         WHERE p.key NOT IN ('org.delete', 'roles.manage', 'billing.manage')
         ON CONFLICT DO NOTHING`,
        [rolesMap['admin']]
      );
    }
    // Manager role
    if (rolesMap['manager']) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM permissions p
         WHERE p.key IN (
           'shows.create', 'shows.read', 'shows.update', 'shows.delete', 'shows.cancel',
           'screens.create', 'screens.read', 'screens.update', 'screens.delete',
           'bookings.read', 'bookings.verify', 'bookings.cancel', 'bookings.modify',
           'refunds.create', 'refunds.read', 'refunds.settle',
           'movies.read', 'movies.update',
           'settings.hall.read', 'settings.hall.update',
           'halls.read', 'halls.manage',
           'customers.read', 'dashboard.view'
         )
         ON CONFLICT DO NOTHING`,
        [rolesMap['manager']]
      );
    }
    // Sales role
    if (rolesMap['sales']) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM permissions p
         WHERE p.key IN ('bookings.read', 'bookings.cancel', 'refunds.create', 'refunds.read', 'dashboard.view', 'customers.read', 'halls.read')
         ON CONFLICT DO NOTHING`,
        [rolesMap['sales']]
      );
    }
    // Finance role
    if (rolesMap['finance']) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM permissions p
         WHERE p.key IN ('bookings.read', 'payment.read', 'refunds.create', 'refunds.read', 'refunds.settle', 'analytics.view', 'dashboard.view', 'customers.read', 'halls.read')
         ON CONFLICT DO NOTHING`,
        [rolesMap['finance']]
      );
    }
    // Marketing role
    if (rolesMap['marketing']) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM permissions p
         WHERE p.key IN ('offers.create', 'offers.read', 'offers.update', 'offers.delete', 'ads.create', 'ads.read', 'ads.update', 'ads.delete', 'movies.read', 'customers.read', 'analytics.view', 'dashboard.view', 'halls.read')
         ON CONFLICT DO NOTHING`,
        [rolesMap['marketing']]
      );
    }
    // Ticket operator role
    if (rolesMap['ticket_operator']) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM permissions p
         WHERE p.key IN ('shows.read', 'bookings.read', 'bookings.verify', 'verify-ticket.use', 'customers.read', 'dashboard.view', 'halls.read')
         ON CONFLICT DO NOTHING`,
        [rolesMap['ticket_operator']]
      );
    }
    // Auditor role
    if (rolesMap['auditor']) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM permissions p
         WHERE p.key LIKE '%.read' OR p.key IN ('audit.view', 'dashboard.view')
         ON CONFLICT DO NOTHING`,
        [rolesMap['auditor']]
      );
    }

    // 4. Link admin as owner in organization_members
    //
    // The WHERE clause is required, not decorative: phase 4 dropped the plain
    // UNIQUE (org_id, admin_id) constraint and replaced it with the PARTIAL
    // index uniq_active_org_member ... WHERE status <> 'removed'. Postgres will
    // not match a bare ON CONFLICT (org_id, admin_id) against a partial index —
    // it raises "there is no unique or exclusion constraint matching the
    // ON CONFLICT specification", which rolled the whole transaction back and
    // made onboarding fail with a 500 for every new signup.
    if (rolesMap['owner']) {
      await client.query(
        `INSERT INTO organization_members (org_id, admin_id, role_id, status, joined_at)
         VALUES ($1, $2, $3, 'active', now())
         ON CONFLICT (org_id, admin_id) WHERE status <> 'removed' DO NOTHING`,
        [orgId, adminId, rolesMap['owner']]
      );
    }

    // 5. Seed default organization settings rows
    // General settings
    await client.query(
      `INSERT INTO organization_settings (org_id, section, value)
       VALUES ($1, 'general', $2)
       ON CONFLICT (org_id, section) DO NOTHING`,
      [orgId, JSON.stringify({ org_name: orgName, timezone: "Asia/Kolkata", currency: "INR", language: "en" })]
    );

    // Payment settings
    await client.query(
      `INSERT INTO organization_settings (org_id, section, value)
       VALUES ($1, 'payment', $2)
       ON CONFLICT (org_id, section) DO NOTHING`,
      [orgId, JSON.stringify({ convenience_fee: { model: 'per_ticket', amount: 15 }, gst_percentage: 18, gst_applies_to: 'convenience_fee', state_taxes: [] })]
    );

    // Tickets settings
    await client.query(
      `INSERT INTO organization_settings (org_id, section, value)
       VALUES ($1, 'tickets', $2)
       ON CONFLICT (org_id, section) DO NOTHING`,
      [orgId, JSON.stringify({ booking_id_prefix: "CINE", qr_error_correction: "M", pdf_footer_text: "" })]
    );

    // Security settings
    await client.query(
      `INSERT INTO organization_settings (org_id, section, value)
       VALUES ($1, 'security', $2)
       ON CONFLICT (org_id, section) DO NOTHING`,
      [orgId, JSON.stringify({ password_policy: { min_length: 8, require_upper: true, require_lower: true, require_digit: true, require_special: true, prevent_reuse_count: 5, expiry_days: null }, lockout_policy: { thresholds: [{ attempts: 5, minutes: 15 }, { attempts: 10, minutes: 60 }, { attempts: 15, minutes: 1440 }] }, session_timeout_minutes: null, mfa_required: false, invite_expiry_hours: 72 })]
    );

    // Notifications settings
    await client.query(
      `INSERT INTO organization_settings (org_id, section, value)
       VALUES ($1, 'notifications', $2)
       ON CONFLICT (org_id, section) DO NOTHING`,
      [orgId, JSON.stringify({ email: { provider: "smtp", from: "", enabled: true }, sms: { provider: "", from: "", enabled: false }, whatsapp: { provider: "", enabled: false }, push: { provider: "fcm", enabled: false } })]
    );

    // Branding settings
    await client.query(
      `INSERT INTO organization_settings (org_id, section, value)
       VALUES ($1, 'branding', $2)
       ON CONFLICT (org_id, section) DO NOTHING`,
      [orgId, JSON.stringify({ logo_url: "", logo_dark_url: "", banner_url: "", primary_color: "", accent_color: "", font_family: "", app_name: "Cinemax", default_theme: "dark", white_label: false })]
    );

    // Integrations settings
    await client.query(
      `INSERT INTO organization_settings (org_id, section, value)
       VALUES ($1, 'integrations', $2)
       ON CONFLICT (org_id, section) DO NOTHING`,
      [orgId, JSON.stringify({ razorpay: { key: "", secret_encrypted: "" }, tmdb: { api_key: "" }, cloudinary: { cloud_name: "", api_key: "", api_secret_encrypted: "" } })]
    );

    // Advanced settings
    await client.query(
      `INSERT INTO organization_settings (org_id, section, value)
       VALUES ($1, 'advanced', $2)
       ON CONFLICT (org_id, section) DO NOTHING`,
      [orgId, JSON.stringify({ feature_flags: {}, retention_days: { security_logs: 90, audit_logs: 90, sessions: 30, devices: 365 } })]
    );

    // 6. Create cinema hall
    const hallResult = await client.query(
      `INSERT INTO cinema_hall
         (admin_id, org_id, name, location, district, state, latitude, longitude, phone, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, name, location, district, state, latitude, longitude, phone, description, is_active, created_at, org_id`,
      [
        adminId,
        orgId,
        name.trim(),
        location.trim(),
        district.trim(),
        state.trim(),
        latitude ?? null,
        longitude ?? null,
        phone?.trim() ?? null,
        description?.trim() ?? null,
      ]
    );
    const hall = hallResult.rows[0];

    // 7. Seed default hall settings for this hall
    await client.query(
      `INSERT INTO hall_settings (hall_id, section, value)
       VALUES ($1, 'cinema_profile', $2)
       ON CONFLICT (hall_id, section) DO NOTHING`,
      [hall.id, JSON.stringify({ name: hall.name, address: hall.location, district: hall.district, state: hall.state, phone: hall.phone || "", description: hall.description || "", operating_hours: {} })]
    );

    await client.query(
      `INSERT INTO hall_settings (hall_id, section, value)
       VALUES ($1, 'showtimes', $2)
       ON CONFLICT (hall_id, section) DO NOTHING`,
      [hall.id, JSON.stringify({ default_buffer_minutes: 15, prevent_overlap: true, default_language_version: "Original", auto_status_transitions: true, timezone: "Asia/Kolkata", advance_booking_days: 7, booking_open_offset_minutes: 0 })]
    );

    await client.query(
      `INSERT INTO hall_settings (hall_id, section, value)
       VALUES ($1, 'booking', $2)
       ON CONFLICT (hall_id, section) DO NOTHING`,
      [hall.id, JSON.stringify({ max_seats_per_booking: 10, advance_booking_days: 7, hold_minutes: 5, cancellation: { allowed: true, window_minutes: 120, penalty_percentage: 10 } })]
    );

    await client.query(
      `INSERT INTO hall_settings (hall_id, section, value)
       VALUES ($1, 'offers', $2)
       ON CONFLICT (hall_id, section) DO NOTHING`,
      [hall.id, JSON.stringify({ auto_apply_best: true, max_redemptions_per_customer: 1, default_validity_days: 30 })]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Onboarding completed successfully',
      orgId,
      orgName,
      hall,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('❌ Onboarding error:', { message: err.message });
    res.status(500).json({ error: 'Onboarding failed. Try again later.' });
  } finally {
    client.release();
  }
};

