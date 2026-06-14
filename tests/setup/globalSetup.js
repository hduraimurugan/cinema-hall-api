import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SETUP_DIR = resolve(__dirname)

process.env.DATABASE_URL = 'postgresql://postgres:Durai@1234@localhost:5432/cinema_hall_test'

async function runMigrations() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10000,
  })

  try {
    await pool.query('SELECT 1')
    console.log('Connected to test database.')
  } catch (err) {
    console.error('Cannot connect to test database:', err.message)
    throw err
  }

  // Drop all tables and functions to ensure clean slate
  const dropResult = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `)
  for (const row of dropResult.rows) {
    await pool.query(`DROP TABLE IF EXISTS "${row.table_name}" CASCADE`)
  }
  await pool.query('DROP FUNCTION IF EXISTS prevent_overlapping_shows CASCADE')
  await pool.query('DROP FUNCTION IF EXISTS update_updated_at_column CASCADE')

  // Run consolidated schema
  const schemaPath = resolve(SETUP_DIR, 'schema.sql')
  const sql = readFileSync(schemaPath, 'utf-8')
  await pool.query(sql)
  console.log('  ✓ schema.sql (consolidated)')
  console.log('All tables and indexes created.')
}

export default async function setup() {
  console.log('\n=== Global Setup ===')
  process.env.NODE_ENV = 'test'
  await runMigrations()
  console.log('=== Setup Complete ===\n')
}
