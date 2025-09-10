import jwt from 'jsonwebtoken'
import pool from '../db.js'
import db from "../db.js";

const isProduction = process.env.NODE_ENV === 'production'

// ✅ Middleware to verify Access Token
export const verifyCinemaAdminAccessToken = async (req, res, next) => {
  const token = req.cookies.accessToken
  if (!token) {
    return res.status(401).json({ message: 'Access token missing' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.admin = decoded
    next()
  } catch (err) {
    console.error('❌ Access Token Error:', err.message)
    return res.status(403).json({ message: 'Invalid or expired access token' })
  }
}

// ✅ Middleware to verify Refresh Token
export const verifyCinemaAdminRefreshToken = (req, res, next) => {
  const token = req.cookies.refreshToken
  if (!token) {
    return res.status(401).json({ message: 'Refresh token missing' })
  }

  try {
    const decoded = jwt.verify(token, process.env.REFRESH_SECRET)
    req.admin = decoded
    next()
  } catch (err) {
    console.error('❌ Refresh Token Error:', err.message)
    return res.status(403).json({ message: 'Invalid or expired refresh token' })
  }
}

// ✅ Middleware to verify Super Admin Access
export const verifySuperAdmin = async (req, res, next) => {
  const token = req.cookies.accessToken
  if (!token) {
    return res.status(401).json({ message: 'Access token missing' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // Check if the user is a super admin
    if (decoded.role !== 'superAdmin') {
      return res.status(403).json({ message: 'Access denied: Super admin only' })
    }

    req.admin = decoded // attach the user payload
    next()
  } catch (err) {
    console.error('❌ Super Admin Token Error:', err.message)
    return res.status(403).json({ message: 'Invalid or expired access token' })
  }
}

// ✅ Verify Cinema Hall
export const verifyCinemaHall = async (req, res, next) => {
  const token = req.cookies.accessToken

  if (!token) {
    return res.status(401).json({ message: 'Access token missing' })
  }

  try {
    // 1. Decode token
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.admin = decoded // you can access req.admin.id or email later

    // 2. Fetch cinema hall(s) for this admin
    const client = await pool.connect()
    try {
      const { rows } = await client.query(
        `SELECT * FROM cinema_hall WHERE admin_id = $1`,
        [decoded.id]
      )

      if (rows.length === 0) {
        return res.status(404).json({ message: 'Cinema hall not found for admin' })
      }

      // 3. If only one hall per admin, send as object. If multiple, send array.
      req.my_cinema_hall = rows.length === 1 ? rows[0] : rows
    } finally {
      client.release()
    }

    next()
  } catch (err) {
    console.error('❌ Access Token or DB Error:', err.message)
    return res.status(403).json({ message: 'Invalid or expired access token' })
  }
}

// ✅ Verify Screen Ownership
export const verifyScreenOwnership = async (req, res, next) => {
  try {
    const screenIds = req.body.screen_ids || (req.body.screen_id ? [req.body.screen_id] : null);

    if (!screenIds || screenIds.length === 0) {
      return res.status(400).json({ message: "Screen ID(s) are required" });
    }

    // 🎯 Get allowed cinema hall IDs from req.my_cinema_hall
    const allowedHallIds = Array.isArray(req.my_cinema_hall)
      ? req.my_cinema_hall.map(hall => hall.id)
      : [req.my_cinema_hall.id];

    // 🧠 Query all screen_id’s cinema_hall_id in one go
    const result = await db.query(
      `SELECT id, cinema_hall_id FROM screens WHERE id = ANY($1::uuid[])`,
      [screenIds]
    );

    const foundScreens = result.rows;

    if (foundScreens.length !== screenIds.length) {
      return res.status(404).json({ message: "Some screens were not found" });
    }

    const unauthorizedScreens = foundScreens.filter(
      (screen) => !allowedHallIds.includes(screen.cinema_hall_id)
    );

    if (unauthorizedScreens.length > 0) {
      return res.status(403).json({
        message: "You do not own one or more of the specified screens",
        unauthorized_screen_ids: unauthorizedScreens.map(s => s.id),
      });
    }

    // ✅ All checks passed
    next();
  } catch (err) {
    console.error("verifyScreenOwnership error:", err.message);
    res.status(500).json({ message: "Internal error verifying screen ownership" });
  }
};

// ✅ Middleware to verify Customer Access Token
export const verifyCustomer = async (req, res, next) => {
  const token = req.cookies.cusAccessToken
  // console.log("Customer Access Token:", req.cookies);
  
  if (!token) {
    return res.status(401).json({ message: 'Customer access token missing' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    req.customer = decoded // attach decoded payload → { id, email, name }
    next()
  } catch (err) {
    console.error('❌ Customer Token Error:', err.message)
    return res.status(403).json({ message: 'Invalid or expired customer access token' })
  }
}

// ✅ Middleware to verify Customer Refresh Token
export const verifyCustomerRefreshToken = (req, res, next) => {
  const token = req.cookies.cusRefreshToken
  if (!token) {
    return res.status(401).json({ message: 'Customer refresh token missing' })
  }

  try {
    const decoded = jwt.verify(token, process.env.REFRESH_SECRET)
    req.customer = decoded // attach decoded payload → { id, email, name }
    next()
  } catch (err) {
    console.error('❌ Customer Refresh Token Error:', err.message)
    return res.status(403).json({ message: 'Invalid or expired customer refresh token' })
  }
}
