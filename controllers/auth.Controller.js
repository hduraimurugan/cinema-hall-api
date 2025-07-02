import pool from '../db.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { generateTokenAndSetCookie } from '../utils/generateTokenAndSetCookie.js'

const isProduction = process.env.NODE_ENV === 'production'

// ✅ Register Admin
export const registerCinemaAdmin = async (req, res) => {
  const { name, email, password, phone, hall_name, hall_location } = req.body

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
      `INSERT INTO cinema_hall (admin_id, name, location)
       VALUES ($1, $2, $3)
       RETURNING id, name, location, created_at`,
      [adminId, hall_name, hall_location]
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
      'SELECT * FROM cinema_admin_user WHERE email = $1',
      [email]
    )

    if (result.rows.length === 0) return res.status(400).json({ error: 'Admin not found' })

    const admin = result.rows[0]
    const match = await bcrypt.compare(password, admin.password)

    if (!match) return res.status(400).json({ error: 'Invalid password' })

    const { accessToken, refreshToken } = generateTokenAndSetCookie(res, admin)

    res.json({
      message: 'Login successful',
      accessToken,
      refreshToken,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
      },
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
      { adminId: admin.id, name: admin.name, email: admin.email },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    )

    res.cookie('accessToken', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 15 * 60 * 1000,
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
    // req.admin is set by verifyCinemaAdminAccessToken middleware
    const adminId = req.admin.id

    const result = await pool.query('SELECT * FROM cinema_admin_user WHERE id = $1', [adminId])
    if (result.rows.length === 0) return res.status(404).json({ error: 'Admin not found' })

    const admin = result.rows[0]

    res.json({
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        created_at: admin.created_at,
      },
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
