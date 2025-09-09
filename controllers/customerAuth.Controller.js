import pool from '../db.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { generateCustomerTokenAndSetCookie, generateTokenAndSetCookie } from '../utils/generateTokenAndSetCookie.js'

const isProduction = process.env.NODE_ENV === 'production'

// ✅ Customer Signup
export const registerCustomer = async (req, res) => {
  const { name, email, password, phone } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' })
  }

  try {
    // Check if customer already exists
    const existing = await pool.query(`SELECT * FROM customers WHERE email = $1`, [email])
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const result = await pool.query(
      `INSERT INTO customers (name, email, password, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, phone, is_verified, created_at`,
      [name, email, hashedPassword, phone || null]
    )

    res.status(201).json({
      message: 'Customer registered successfully! Please verify your email with OTP.',
      customer: result.rows[0],
    })
  } catch (err) {
    console.error('❌ Customer signup error:', err.message)
    res.status(500).json({ error: 'Signup failed. Try again later.' })
  }
}

// ✅ Customer Login
export const loginCustomer = async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' })
  }

  try {
    const result = await pool.query(`SELECT * FROM customers WHERE email = $1`, [email])
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' })

    const customer = result.rows[0]
    const match = await bcrypt.compare(password, customer.password)

    if (!match) return res.status(400).json({ error: 'Invalid password' })

    if (!customer.is_verified) {
      return res.status(403).json({ error: 'Email not verified. Please verify using OTP.' })
    }

    const tokenPayload = {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      role: 'customer',
    }

    const { accessToken, refreshToken } = generateCustomerTokenAndSetCookie(res, tokenPayload)

    res.json({
      message: 'Login successful',
      accessToken,
      refreshToken,
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
    console.error('❌ Customer login error:', err.message)
    res.status(500).json({ error: 'Login failed. Try again later.' })
  }
}

// ✅ Logout
export const logoutCustomer = async (req, res) => {
  try {
    res.clearCookie('cusAccessToken', {
      httpOnly: true,
      sameSite: isProduction ? 'None' : 'Lax',
      secure: isProduction,
    })
    res.clearCookie('cusRefreshToken', {
      httpOnly: true,
      sameSite: isProduction ? 'None' : 'Lax',
      secure: isProduction,
    })
    res.status(200).json({ message: 'Logged out successfully' })
  } catch (err) {
    console.error('❌ Logout error:', err.message)
    res.status(500).json({ error: 'Logout failed' })
  }
}
