import pg from 'pg'

let pool = null

export function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5000,
    })
  }
  return pool
}

export async function query(text, params) {
  const client = await getPool().connect()
  try {
    const result = await client.query(text, params)
    return result
  } finally {
    client.release()
  }
}

export async function getClient() {
  return getPool().connect()
}

export async function cleanupTable(table) {
  await query(`DELETE FROM "${table}"`)
}

export async function cleanupAll() {
  const tables = [
    'refunds', 'offer_redemptions', 'offers', 'ad_clicks', 'ads',
    'webhook_events', 'admin_security_logs', 'admin_sessions',
    'admin_password_reset_tokens', 'admin_verification_tokens',
    'customer_sessions', 'show_booked_seats', 'bookings',
    'payment_orders', 'otp_verifications', 'shows', 'screens',
    'movies', 'hall_assignments', 'cinema_hall', 'hall_settings',
    'organization_members', 'role_permissions', 'roles',
    'organization_settings', 'organizations', 'user_settings',
    'customers', 'cinema_admin_user', 'permissions'
  ]
  for (const table of tables) {
    await cleanupTable(table)
  }
}

export async function closePool() {
  if (pool) {
    await pool.end()
    pool = null
  }
}
