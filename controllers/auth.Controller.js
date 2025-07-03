import pool from '../db.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { generateTokenAndSetCookie } from '../utils/generateTokenAndSetCookie.js'

const isProduction = process.env.NODE_ENV === 'production'

// ✅ Register Admin
export const registerCinemaAdmin = async (req, res) => {
  const { name, email, password, phone, hall_name, hall_location, hall_district, hall_state } = req.body

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
      `INSERT INTO cinema_hall (admin_id, name, location, district, state)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, location, district, state, created_at`,
      [adminId, hall_name, hall_location, hall_district, hall_state]
    )

    res.status(201).json({
      message: 'Cinema admin registered successfully!',
      admin: userResult.rows[0],
      hall: hallResult.rows[0],
    })
  } catch (err) {
    console.error('❌ Registration error:', err.message)
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
        a.created_at AS admin_created_at,
        h.id AS hall_id,
        h.name AS hall_name,
        h.location AS hall_location,
        h.district AS hall_district,
        h.state AS hall_state,
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
        created_at: admin.admin_created_at,
      },
      hall: admin.hall_id
        ? {
          id: admin.hall_id,
          name: admin.hall_name,
          location: admin.hall_location,
          district: admin.hall_district,
          state: admin.hall_state,
          created_at: admin.hall_created_at,
        }
        : null,
    })
  } catch (err) {
    console.error('❌ Login error:', err.message)
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
      { id: admin.id, name: admin.name, email: admin.email },
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
    console.error('❌ Refresh token error:', err.message)
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
        a.created_at AS admin_created_at,
        h.id AS hall_id,
        h.name AS hall_name,
        h.location AS hall_location,
        h.district AS hall_district,
        h.state AS hall_state,
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
        created_at: row.admin_created_at,
      },
      hall: row.hall_id
        ? {
          id: row.hall_id,
          name: row.hall_name,
          location: row.hall_location,
          district: row.hall_district,
          state: row.hall_state,
          created_at: row.hall_created_at,
        }
        : null,
    })
  } catch (err) {
    console.error('❌ getMe error:', err.message)
    res.status(500).json({ error: 'Failed to fetch admin info' })
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
    console.error('Logout error:', err)
    res.status(500).json({ error: 'Logout failed' })
  }
}
