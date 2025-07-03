import jwt from 'jsonwebtoken'
import pool from '../db.js'

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
