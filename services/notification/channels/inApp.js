import pool from '../../../db.js';
import { buildNotificationContent } from '../templates.js';

/**
 * Writes the in-app feed row synchronously — cheap same-DB insert, no
 * external dependency, so it doesn't need to go through QStash like
 * email/push do.
 */
export async function insertInAppNotification({ event, recipient, data }) {
    const { title, body } = buildNotificationContent(event, data);

    const { rows } = await pool.query(
        `INSERT INTO notifications
           (org_id, customer_id, admin_id, event, title, body, data, booking_id, show_id, refund_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
            recipient.orgId || null,
            recipient.type === 'customer' ? recipient.id : null,
            recipient.type === 'admin' ? recipient.id : null,
            event,
            title,
            body,
            JSON.stringify(data || {}),
            data?.bookingId || null,
            data?.showId || null,
            data?.refundId || null,
        ]
    );
    return rows[0];
}
