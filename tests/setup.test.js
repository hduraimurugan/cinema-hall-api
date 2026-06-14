import { describe, it, expect, afterAll } from 'vitest'
import { query, cleanupAll, closePool } from './setup/db.js'

afterAll(async () => {
  await closePool()
})

describe('Test Database Setup', () => {
  it('should have all expected tables', async () => {
    const result = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `)
    const tables = result.rows.map(r => r.table_name)

    expect(tables).toContain('cinema_admin_user')
    expect(tables).toContain('cinema_hall')
    expect(tables).toContain('screens')
    expect(tables).toContain('movies')
    expect(tables).toContain('shows')
    expect(tables).toContain('bookings')
    expect(tables).toContain('customers')
    expect(tables).toContain('otp_verifications')
    expect(tables).toContain('show_booked_seats')
    expect(tables).toContain('payment_orders')
  })

  it('should have columns added by migrations', async () => {
    const result = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'cinema_admin_user' AND table_schema = 'public'
      ORDER BY ordinal_position
    `)
    const columns = result.rows.map(r => r.column_name)
    expect(columns).toContain('role')
    expect(columns).toContain('is_verified')
    expect(columns).toContain('is_active')
  })

  it('should be able to insert and query data', async () => {
    const ins = await query(
      `INSERT INTO cinema_admin_user (name, email, password, role)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      ['Setup Test', 'setup_test@test.com', 'hashed_pw', 'admin']
    )
    expect(ins.rows[0].name).toBe('Setup Test')
    expect(ins.rows[0].role).toBe('admin')

    await query(`DELETE FROM cinema_admin_user WHERE id = $1`, [ins.rows[0].id])
  })
})
