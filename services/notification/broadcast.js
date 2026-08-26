import pool from '../../db.js';
import logger from '../../utils/logger.js';
import { insertInAppNotification } from './channels/inApp.js';
import { sendPushForNotification } from './channels/push.js';
import { resolveEnabledChannels } from './preferences.js';
import { publishDispatch } from './qstashClient.js';

/**
 * Resolve an audience selector into a flat list of {type, id} recipients,
 * the same shape notify()/insertInAppNotification() already expect.
 */
export async function resolveAudience({ audienceType, customerIds = [], adminIds = [] }) {
    if (audienceType === 'all_customers') {
        const { rows } = await pool.query(`SELECT id FROM customers`);
        return rows.map((r) => ({ type: 'customer', id: r.id }));
    }
    if (audienceType === 'all_admins') {
        // Matches the existing getAllAdmins scope (auth.Controller.js) — hall
        // admins only, not other superAdmins or org staff.
        const { rows } = await pool.query(`SELECT id FROM cinema_admin_user WHERE role = 'admin'`);
        return rows.map((r) => ({ type: 'admin', id: r.id }));
    }
    return [
        ...customerIds.map((id) => ({ type: 'customer', id })),
        ...adminIds.map((id) => ({ type: 'admin', id })),
    ];
}

async function insertDispatchLogRow({ notificationId, broadcastId, recipient, channel, status, target, error }) {
    await pool.query(
        `INSERT INTO notification_dispatch_log
           (notification_id, broadcast_id, customer_id, admin_id, event, channel, status, target, error, attempted_at)
         VALUES ($1, $2, $3, $4, 'admin_broadcast', $5, $6, $7, $8, now())`,
        [
            notificationId,
            broadcastId,
            recipient.type === 'customer' ? recipient.id : null,
            recipient.type === 'admin' ? recipient.id : null,
            channel,
            status,
            target || null,
            error || null,
        ]
    );
}

/**
 * Send a broadcast immediately — synchronous, no QStash — so "Send Now"
 * works on localhost with no public URL/tunnel and returns real
 * success/failure counts in the same request.
 */
export async function sendBroadcastNow(broadcast, recipients) {
    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
        try {
            const notification = await insertInAppNotification({
                event: 'admin_broadcast',
                recipient,
                data: { title: broadcast.title, body: broadcast.body, imageUrl: broadcast.image_url },
            });
            await pool.query(`UPDATE notifications SET broadcast_id = $1 WHERE id = $2`, [broadcast.id, notification.id]);

            const channels = await resolveEnabledChannels(recipient, 'admin_broadcast');
            if (!channels.includes('push')) {
                failed++;
                continue;
            }

            try {
                const target = await sendPushForNotification(recipient, notification);
                await insertDispatchLogRow({ notificationId: notification.id, broadcastId: broadcast.id, recipient, channel: 'push', status: 'sent', target });
                sent++;
            } catch (pushErr) {
                await insertDispatchLogRow({ notificationId: notification.id, broadcastId: broadcast.id, recipient, channel: 'push', status: 'failed', error: pushErr.message });
                failed++;
            }
        } catch (err) {
            logger.error('[broadcast] recipient failed', { recipient, message: err.message });
            failed++;
        }
    }

    await pool.query(
        `UPDATE admin_broadcasts SET status = 'sent', sent_count = $1, failed_count = $2, sent_at = now() WHERE id = $3`,
        [sent, failed, broadcast.id]
    );

    return { sent, failed };
}

/**
 * Queue a broadcast for future delivery via QStash's notBefore — same
 * mechanism as scheduleShowReminder() in services/notification/index.js.
 * The existing /api/notifications/dispatch webhook fires each recipient's
 * send at the scheduled instant; no new webhook needed.
 */
export async function scheduleBroadcastFor(broadcast, recipients, scheduledFor) {
    const notBefore = Math.floor(scheduledFor.getTime() / 1000);

    for (const recipient of recipients) {
        const notification = await insertInAppNotification({
            event: 'admin_broadcast',
            recipient,
            data: { title: broadcast.title, body: broadcast.body, imageUrl: broadcast.image_url },
            scheduledFor,
        });
        await pool.query(`UPDATE notifications SET broadcast_id = $1 WHERE id = $2`, [broadcast.id, notification.id]);

        const channels = await resolveEnabledChannels(recipient, 'admin_broadcast');
        for (const channel of channels) {
            const { rows } = await pool.query(
                `INSERT INTO notification_dispatch_log
                   (notification_id, broadcast_id, customer_id, admin_id, event, channel, status)
                 VALUES ($1, $2, $3, $4, 'admin_broadcast', $5, 'queued')
                 RETURNING id`,
                [
                    notification.id,
                    broadcast.id,
                    recipient.type === 'customer' ? recipient.id : null,
                    recipient.type === 'admin' ? recipient.id : null,
                    channel,
                ]
            );
            try {
                const { messageId } = await publishDispatch({
                    notificationId: notification.id,
                    event: 'admin_broadcast',
                    recipientType: recipient.type,
                    recipientId: recipient.id,
                    channel,
                    notBefore,
                });
                await pool.query(`UPDATE notification_dispatch_log SET qstash_message_id = $1 WHERE id = $2`, [messageId, rows[0].id]);
            } catch (publishErr) {
                logger.error('[scheduleBroadcastFor] QStash publish failed', { broadcastId: broadcast.id, channel, message: publishErr.message });
                await pool.query(`UPDATE notification_dispatch_log SET status = 'failed', error = $1 WHERE id = $2`, [publishErr.message, rows[0].id]);
            }
        }
    }

    await pool.query(`UPDATE admin_broadcasts SET status = 'scheduled' WHERE id = $1`, [broadcast.id]);
}
