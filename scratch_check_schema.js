import db from "../db.js";

async function checkSchema() {
    try {
        const res = await db.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'payment_orders';
        `);
        console.log("Columns in payment_orders:", res.rows.map(r => r.column_name).join(", "));
        
        const res2 = await db.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'bookings';
        `);
        console.log("Columns in bookings:", res2.rows.map(r => r.column_name).join(", "));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}

checkSchema();
