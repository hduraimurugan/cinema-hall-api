import { describe, it, expect } from 'vitest'
import pool from '../db.js'

describe('debug', () => {
  it('test query', async () => {
    const query = `SELECT a.*, COUNT(ac.id)::int AS click_count
FROM ads a LEFT JOIN ad_clicks ac ON ac.ad_id = a.id
GROUP BY a.id ORDER BY a.created_at DESC`
    try {
      const { rows } = await pool.query(query)
      console.log('rows:', JSON.stringify(rows))
      expect(true).toBe(true)
    } catch (err) {
      console.error('Error:', err.message)
      expect(err.message).toBe('')
    }
  })
})
