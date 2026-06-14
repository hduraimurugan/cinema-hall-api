import pool from '../db.js'
import logger from '../utils/logger.js'


// GET /api/customers — Super Admin only
export const getAllCustomers = async (req, res) => {
  const { search, page = 1, limit: limitParam = 10 } = req.query
  const limit = Math.min(Math.max(parseInt(limitParam) || 10, 1), 100)
  const offset = (parseInt(page) - 1) * limit
  const searchParam = search?.trim() || null

  try {
    const [customersResult, countResult, statsResult] = await Promise.all([
      pool.query(
        `SELECT
          c.id, c.name, c.email, c.phone, c.district, c.state,
          c.is_verified, c.created_at, c.avatar, c.auth_providers,
          (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id AND b.payment_status = 'completed')::int AS booking_count
        FROM customers c
        WHERE ($1::text IS NULL
          OR c.name ILIKE '%' || $1 || '%'
          OR c.email ILIKE '%' || $1 || '%'
          OR c.phone ILIKE '%' || $1 || '%')
        ORDER BY c.created_at DESC
        LIMIT $2 OFFSET $3`,
        [searchParam, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM customers c
        WHERE ($1::text IS NULL
          OR c.name ILIKE '%' || $1 || '%'
          OR c.email ILIKE '%' || $1 || '%'
          OR c.phone ILIKE '%' || $1 || '%')`,
        [searchParam]
      ),
      pool.query(
        `SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE is_verified = true) AS verified
        FROM customers`
      ),
    ])

    res.status(200).json({
      customers: customersResult.rows,
      total: parseInt(countResult.rows[0].count),
      stats: {
        total: parseInt(statsResult.rows[0].total),
        verified: parseInt(statsResult.rows[0].verified),
      },
    })
  } catch (err) {
    logger.error('❌ getAllCustomers error:', { message: err.message })
    res.status(500).json({ error: 'Failed to fetch customers' })
  }
}

export const getCustomerDetails = async (req, res) => {
  const { id } = req.params

  try {
    const [customerResult, bookingsResult, sessionsResult] = await Promise.all([
      pool.query(
        `SELECT id, name, email, phone, district, state, is_verified,
                failed_login_attempts, account_locked_until, last_login_at,
                password_changed_at, created_at, updated_at,
                auth_providers, avatar,
                (password IS NOT NULL) AS has_password
         FROM customers WHERE id = $1`,
        [id]
      ),
      pool.query(
        `SELECT id, booking_status, payment_status, total_amount, created_at
         FROM bookings WHERE customer_id = $1
         ORDER BY created_at DESC LIMIT 10`,
        [id]
      ),
      pool.query(
        `SELECT id, ip_address, user_agent, is_revoked, last_used_at, created_at
         FROM customer_sessions WHERE customer_id = $1 AND is_revoked = false
         ORDER BY last_used_at DESC LIMIT 10`,
        [id]
      ),
    ])

    if (customerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found.' })
    }

    res.status(200).json({
      customer: customerResult.rows[0],
      recentBookings: bookingsResult.rows,
      activeSessions: sessionsResult.rows,
    })
  } catch (err) {
    logger.error('❌ getCustomerDetails error:', { message: err.message })
    res.status(500).json({ error: 'Failed to fetch customer details.' })
  }
}
