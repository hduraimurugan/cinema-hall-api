import { qstashReceiver } from './qstashClient.js';
import { sendEmailForNotification } from './channels/email.js';
import { sendPushForNotification } from './channels/push.js';
import pool from '../../db.js';
import logger from '../../utils/logger.js';

/**
 * POST /api/notifications/dispatch
 *
 * QStash webhook target — every enqueued channel send (email/push) lands here.
 * Mounted with express.raw() in server.js so req.body is the exact Buffer QStash
 * signed (same reasoning as the Razorpay webhook's raw-body requirement).
 *
 * The publish payload carries only IDs; this handler re-fetches the
 * `notifications` row and the recipient's contact info fresh rather than
 * trusting a payload that might be stale by the time QStash delivers it.
 */
export const handleDispatch = async (req, res) => {
    const rawBody = req.body?.toString('utf8') || '';
    const signature = req.headers['upstash-signature'];

    try {
        await qstashReceiver.verify({
            signature,
            body: rawBody,
            url: `${process.env.API_BASE_URL}/api/notifications/dispatch`,
        });
    } catch (err) {
        logger.warn('[notifications/dispatch] Signature verification failed', { message: err.message });
        return res.status(401).json({ error: 'Invalid signature' });
    }

    let payload;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const { notificationId, recipientType, recipientId, channel, tokenIds } = payload;
    logger.info('[notifications/dispatch] Received', payload);

    try {
        const { rows: notificationRows } = await pool.query(
            `SELECT * FROM notifications WHERE id = $1`,
            [notificationId]
        );
        const notification = notificationRows[0];
        if (!notification) {
            // Nothing to send — treat as done so QStash doesn't retry forever.
            logger.warn('[notifications/dispatch] Notification row not found', { notificationId });
            return res.status(200).json({ received: true, skipped: true });
        }

        const recipient = await fetchRecipientContact(recipientType, recipientId);
        if (!recipient) {
            await markDispatchFailed(notificationId, channel, 'Recipient not found');
            return res.status(200).json({ received: true, skipped: true });
        }

        let target;
        if (channel === 'email') {
            target = await sendEmailForNotification(recipient, notification);
        } else if (channel === 'push') {
            target = await sendPushForNotification({ type: recipientType, id: recipientId }, notification, { tokenIds });
        } else {
            throw new Error(`Channel "${channel}" is not implemented`);
        }

        await pool.query(
            `UPDATE notification_dispatch_log
             SET status = 'sent', target = $1, attempted_at = now()
             WHERE notification_id = $2 AND channel = $3`,
            [target, notificationId, channel]
        );

        return res.status(200).json({ received: true });
    } catch (err) {
        logger.error('[notifications/dispatch] Send failed', { notificationId, channel, message: err.message });
        await markDispatchFailed(notificationId, channel, err.message);
        // Non-2xx so QStash retries with its own backoff.
        return res.status(500).json({ error: 'Dispatch failed' });
    }
};

async function fetchRecipientContact(recipientType, recipientId) {
    const table = recipientType === 'customer' ? 'customers' : 'cinema_admin_user';
    const { rows } = await pool.query(`SELECT email, name FROM ${table} WHERE id = $1`, [recipientId]);
    return rows[0] || null;
}

async function markDispatchFailed(notificationId, channel, error) {
    await pool.query(
        `UPDATE notification_dispatch_log
         SET status = 'failed', error = $1, attempted_at = now()
         WHERE notification_id = $2 AND channel = $3`,
        [error, notificationId, channel]
    );
}
