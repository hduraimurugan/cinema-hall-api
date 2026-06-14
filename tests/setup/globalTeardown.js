import pg from 'pg'

export default async function teardown() {
  console.log('\n=== Global Teardown ===')

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
  })

  try {
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `)
    for (const row of result.rows) {
      await pool.query(`DROP TABLE IF EXISTS "${row.table_name}" CASCADE`)
    }
    await pool.query('DROP FUNCTION IF EXISTS prevent_overlapping_shows CASCADE')
    await pool.query('DROP FUNCTION IF EXISTS update_updated_at_column CASCADE')
    console.log('All test tables and functions dropped.')
  } catch (err) {
    console.error('Teardown error:', err.message)
  } finally {
    await pool.end()
  }

  console.log('=== Teardown Complete ===\n')
}
