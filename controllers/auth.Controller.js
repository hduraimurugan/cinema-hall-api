import pool from '../db.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { generateTokenAndSetCookie } from '../utils/generateTokenAndSetCookie.js'
import logger from '../utils/logger.js'

const isProduction = process.env.NODE_ENV === 'production'

// ✅ Register Admin
export const registerCinemaAdmin = async (req, res) => {
  const { name, email, password, phone, hall_name, hall_location, hall_district, hall_state, latitude, longitude } = req.body

  if (!name || !email || !password || !phone || !hall_name || !hall_location) {
    return res.status(400).json({ error: 'All fields are required.' })
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10)

    const userResult = await pool.query(
      `INSERT INTO cinema_admin_user (name, email, password, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, phone, created_at`,
      [name, email, hashedPassword, phone]
    )

    const adminId = userResult.rows[0].id

    const hallResult = await pool.query(
      `INSERT INTO cinema_hall (admin_id, name, location, district, state, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, location, district, state, latitude, longitude, created_at`,
      [adminId, hall_name, hall_location, hall_district, hall_state, latitude ?? null, longitude ?? null]
    )

    res.status(201).json({
      message: 'Cinema admin registered successfully!',
      admin: userResult.rows[0],
      hall: hallResult.rows[0],
    })
  } catch (err) {
    logger.error('❌ Registration error:', { message: err.message })
    res.status(500).json({ error: 'Registration failed. Try again later.' })
  }
}

// ✅ Login Admin
export const loginCinemaAdmin = async (req, res) => {
  const { email, password } = req.body

  try {
    const result = await pool.query(
      `
      SELECT 
        a.id AS admin_id,
        a.name AS admin_name,
        a.email,
        a.password,
        a.phone,
        a.role,
        a.created_at AS admin_created_at,
        h.id AS hall_id,
        h.name AS hall_name,
        h.location AS hall_location,
        h.district AS hall_district,
        h.state AS hall_state,
        h.latitude AS hall_latitude,
        h.longitude AS hall_longitude,
        h.created_at AS hall_created_at
      FROM cinema_admin_user a
      LEFT JOIN cinema_hall h ON h.admin_id = a.id
      WHERE a.email = $1
      `,
      [email]
    )

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Admin not found' })
    }

    const admin = result.rows[0]

    const match = await bcrypt.compare(password, admin.password)
    if (!match) {
      return res.status(400).json({ error: 'Invalid password' })
    }

    const tokenPayload = {
      id: admin.admin_id,
      name: admin.admin_name,
      email: admin.email,
      role: admin.role,
    }

    const { accessToken, refreshToken } = generateTokenAndSetCookie(res, tokenPayload)

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
    // req.admin is already populated by verifyCinemaAdminRefreshToken middleware
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
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 1 * 24 * 60 * 60 * 1000, // 1 day
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
      `
      SELECT 
        a.id AS admin_id,
        a.name AS admin_name,
        a.email,
        a.phone,
        a.role,
        a.created_at AS admin_created_at,
        h.id AS hall_id,
        h.name AS hall_name,
        h.location AS hall_location,
        h.district AS hall_district,
        h.state AS hall_state,
        h.latitude AS hall_latitude,
        h.longitude AS hall_longitude,
        h.created_at AS hall_created_at
      FROM cinema_admin_user a
      LEFT JOIN cinema_hall h ON h.admin_id = a.id
      WHERE a.id = $1
      `,
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
          a.id, a.name, a.email, a.phone, a.role, a.created_at,
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

// ✅ Logout
export const logoutCinemaAdmin = async (req, res) => {
  try {
    res.clearCookie('accessToken', {
      httpOnly: true,
      sameSite: isProduction ? 'None' : 'Lax',
      secure: isProduction,
    })
    res.clearCookie('refreshToken', {
      httpOnly: true,
      sameSite: isProduction ? 'None' : 'Lax',
      secure: isProduction,
    })
    res.status(200).json({ message: 'Logged out successfully' })
  } catch (err) {
    logger.error('Logout error:', { error: err })
    res.status(500).json({ error: 'Logout failed' })
  }
}


