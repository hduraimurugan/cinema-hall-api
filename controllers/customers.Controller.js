import pool from '../db.js'

// GET /api/customers — Super Admin only
export const getAllCustomers = async (req, res) => {
  const { search, page = 1 } = req.query
  const limit = 50
  const offset = (parseInt(page) - 1) * limit
  const searchParam = search?.trim() || null

  try {
    const [customersResult, countResult, statsResult] = await Promise.all([
      pool.query(
        `SELECT
          c.id, c.name, c.email, c.phone, c.district, c.state,
          c.is_verified, c.created_at,
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

    res.json({
      customers: customersResult.rows,
      total: parseInt(countResult.rows[0].count),
      stats: {
        total: parseInt(statsResult.rows[0].total),
        verified: parseInt(statsResult.rows[0].verified),
      },
    })
  } catch (err) {
    console.error('❌ getAllCustomers error:', err.message)
    res.status(500).json({ error: 'Failed to fetch customers' })
  }
}
