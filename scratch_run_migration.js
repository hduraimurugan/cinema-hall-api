import fs from 'fs';
import path from 'path';
import db from './db.js';

async function runMigration() {
  try {
    const sqlPath = path.join('database', 'migration_phase3_onboarding.sql');
    console.log(`Reading SQL migration from: ${sqlPath}`);
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('Running migration...');
    await db.query(sql);
    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit();
  }
}

runMigration();
