import db from "./db.js";

async function listTables() {
    try {
        const res = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
        `);
        const tables = res.rows.map(r => r.table_name);
        console.log("Found tables:", tables);
        
        for (const table of tables) {
            try {
                const countRes = await db.query(`SELECT COUNT(*) as count FROM "${table}"`);
                console.log(`Table: ${table} - Rows: ${countRes.rows[0].count}`);
            } catch (err) {
                console.log(`Table: ${table} - Error counting rows: ${err.message}`);
            }
        }
    } catch (e) {
        console.error("Error listing tables:", e);
    } finally {
        process.exit();
    }
}

listTables();
