import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },

  // 👇 Add these to stabilize the pool
  max: 10,                         // Max number of clients in pool
  idleTimeoutMillis: 30000,       // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000   // Wait max 2 seconds to connect
});

// Optional but useful: listen for unexpected errors in the pool
pool.on('error', (err, client) => {
  console.error('❌ Unexpected error on idle PostgreSQL client:', err.message);
});

export default pool;
