import pool from '../../../db.js';
import { messaging } from '../firebaseAdmin.js';
import logger from '../../../utils/logger.js';

const recipientColumn = (type) => (type === 'customer' ? 'customer_id' : 'admin_id');

/**
 * Sends a push notification to this recipient's registered devices — every
 * one of them by default, or only `options.tokenIds` when the caller (a
 * Super Admin broadcast) narrowed it to specific devices. Returns a
 * comma-separated list of tokens actually sent to (for the dispatch log's
 * `target`), or throws if there's nothing to send to — caught by the
 * caller like any other channel failure.
 */
export async function sendPushForNotification(recipient, notification, options = {}) {
    const { tokenIds } = options;
    const { rows: devices } = tokenIds && tokenIds.length > 0
        ? await pool.query(
            `SELECT id, token FROM device_tokens WHERE id = ANY($1::uuid[]) AND ${recipientColumn(recipient.type)} = $2`,
            [tokenIds, recipient.id]
        )
        : await pool.query(
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
            ...(notification.data?.imageUrl ? { imageUrl: notification.data.imageUrl } : {}),
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
