import pool from '../db.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { generateCustomerTokenAndSetCookie, generateTokenAndSetCookie } from '../utils/generateTokenAndSetCookie.js'

const isProduction = process.env.NODE_ENV === 'production'

// ✅ Customer Signup
export const registerCustomer = async (req, res) => {
  const { name, email, password, phone, district, state } = req.body

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
      `INSERT INTO customers (name, email, password, phone, district, state)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, phone, district, state, is_verified, created_at`,
      [
        name,
        email,
        hashedPassword,
        phone || null,
        district || '', // fallback to empty string
        state || '',    // fallback to empty string
      ]
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

// ✅ Update Customer Profile
export const updateCustomerProfile = async (req, res) => {
  const customerId = req.customer?.id // assuming middleware attaches decoded JWT payload to req.user
  console.log("Authenticated Customer ID:", customerId);
  
  const { name, phone, district, state, password } = req.body

  if (!customerId) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' })
  }

  try {
    // Fetch existing customer
    const existing = await pool.query(`SELECT * FROM customers WHERE id = $1`, [customerId])
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' })
    }

    // Prepare update fields
    let updateFields = [
      name || existing.rows[0].name,
      phone || existing.rows[0].phone,
      district || existing.rows[0].district,
      state || existing.rows[0].state,
    ]

    let query = `
      UPDATE customers
      SET name = $1,
          phone = $2,
          district = $3,
          state = $4,
          updated_at = now()
    `

    // If password update is requested
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10)
      updateFields.push(hashedPassword)
      query += `, password = $${updateFields.length}`
    }

    // Add WHERE condition
    updateFields.push(customerId)
    query += ` WHERE id = $${updateFields.length}
               RETURNING id, name, email, phone, district, state, is_verified, created_at, updated_at`

    // Execute query
    const result = await pool.query(query, updateFields)

    res.json({
      message: 'Profile updated successfully',
      customer: result.rows[0],
    })
  } catch (err) {
    console.error('❌ Update profile error:', err.message)
    res.status(500).json({ error: 'Profile update failed. Try again later.' })
  }
}

// ✅ Refresh Access Token
export const refreshCustomerToken = async (req, res) => {
  try {
    // req.customer is already populated by verifyCustomerRefreshToken middleware
    const customerId = req.customer.id

    const result = await pool.query(`SELECT * FROM customers WHERE id = $1`, [customerId])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' })
    }

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
    console.error('❌ Refresh token error:', err.message)
    res.status(500).json({ error: 'Token refresh failed' })
  }
}

// ✅ Get Logged-in Customer
export const getCustomerMe = async (req, res) => {
  try {
    const customerId = req.customer.id

    const result = await pool.query(
      `SELECT id, name, email, phone, district, state, is_verified, created_at, updated_at
       FROM customers
       WHERE id = $1`,
      [customerId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' })
    }

    res.json({
      customer: result.rows[0],
    })
  } catch (err) {
    console.error('❌ getCustomerMe error:', err.message)
    res.status(500).json({ error: 'Failed to fetch customer info' })
  }
}
