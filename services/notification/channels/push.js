import pool from '../../../db.js';
import { messaging } from '../firebaseAdmin.js';
import logger from '../../../utils/logger.js';

const recipientColumn = (type) => (type === 'customer' ? 'customer_id' : 'admin_id');

/**
 * Sends a push notification to every device registered for this recipient.
 * Returns a comma-separated list of tokens actually sent to (for the
 * dispatch log's `target`), or throws if the recipient has no devices —
 * caught by the caller like any other channel failure.
 */
export async function sendPushForNotification(recipient, notification) {
    const { rows: devices } = await pool.query(
        `SELECT id, token FROM device_tokens WHERE ${recipientColumn(recipient.type)} = $1`,
        [recipient.id]
    );

    if (devices.length === 0) {
        throw new Error('Recipient has no registered devices');
    }

    const response = await messaging.sendEachForMulticast({
        tokens: devices.map(d => d.token),
        notification: {
            title: notification.title,
            body: notification.body || '',
        },
        data: {
            event: notification.event,
            notificationId: notification.id,
        },
    });

    // Clean up tokens FCM says are no longer valid so device_tokens doesn't
    // accumulate dead entries and future sends don't keep retrying them.
    const deadTokenIds = [];
    response.responses.forEach((result, i) => {
        if (!result.success && result.error?.code === 'messaging/registration-token-not-registered') {
            deadTokenIds.push(devices[i].id);
        }
    });
    if (deadTokenIds.length > 0) {
        await pool.query(`DELETE FROM device_tokens WHERE id = ANY($1::uuid[])`, [deadTokenIds]);
        logger.info('[push] Removed unregistered device tokens', { count: deadTokenIds.length });
    }

    if (response.successCount === 0) {
        throw new Error(`Push failed for all ${devices.length} device(s)`);
    }

    return devices.map(d => d.token).join(',');
}
