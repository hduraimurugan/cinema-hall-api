import pool from '../../db.js';
import logger from '../../utils/logger.js';
import { insertInAppNotification } from './channels/inApp.js';
import { sendPushForNotification } from './channels/push.js';
import { sendEmailForNotification } from './channels/email.js';
import { resolveEnabledChannelsForBroadcast } from './preferences.js';
import { publishDispatch, cancelScheduledMessage } from './qstashClient.js';

const EXTERNAL_CHANNELS = ['push', 'email'];

/**
 * Resolve an audience selector into a flat list of recipients carrying enough
 * contact info to send every channel synchronously (sendBroadcastNow doesn't
 * go through the QStash webhook's fresh re-fetch, so it needs email/name up
 * front) — { type, id, email, name, deviceTokenIds }.
 */
export async function resolveAudience({ audienceType, customerIds = [], adminIds = [], deviceTokenFilter = {}, cinemaHallId }) {
    if (audienceType === 'all_customers') {
        const { rows } = await pool.query(`SELECT id, email, name FROM customers`);
        return rows.map((r) => ({ type: 'customer', id: r.id, email: r.email, name: r.name, deviceTokenIds: null }));
    }
    if (audienceType === 'all_admins') {
        // Matches the existing getAllAdmins scope (auth.Controller.js) — hall
        // admins only, not other superAdmins or org staff.
        const { rows } = await pool.query(`SELECT id, email, name FROM cinema_admin_user WHERE role = 'admin'`);
        return rows.map((r) => ({ type: 'admin', id: r.id, email: r.email, name: r.name, deviceTokenIds: null }));
    }
    if (audienceType === 'hall_customers') {
        // Customers who have booked at this specific hall — used for
        // announcing a hall-scoped offer, whose code only works there. Same
        // show->screen->hall join validateOfferCode() uses to enforce scope.
        if (!cinemaHallId) return [];
        const { rows } = await pool.query(
            `SELECT DISTINCT c.id, c.email, c.name
             FROM bookings b
             JOIN shows sh    ON sh.id = b.show_id
             JOIN screens sc  ON sc.id = sh.screen_id
             JOIN customers c ON c.id = b.customer_id
             WHERE sc.cinema_hall_id = $1 AND b.customer_id IS NOT NULL`,
            [cinemaHallId]
        );
        return rows.map((r) => ({ type: 'customer', id: r.id, email: r.email, name: r.name, deviceTokenIds: null }));
    }
    // custom — deviceTokenIds: null means "every device this person has
    // registered" (the default); an array means the admin narrowed it to
    // specific device_tokens rows via the picker — see broadcast.Controller.js.
    const [customersRes, adminsRes] = await Promise.all([
        customerIds.length > 0
            ? pool.query(`SELECT id, email, name FROM customers WHERE id = ANY($1::uuid[])`, [customerIds])
            : Promise.resolve({ rows: [] }),
        adminIds.length > 0
            ? pool.query(`SELECT id, email, name FROM cinema_admin_user WHERE id = ANY($1::uuid[])`, [adminIds])
            : Promise.resolve({ rows: [] }),
    ]);
    return [
        ...customersRes.rows.map((r) => ({ type: 'customer', id: r.id, email: r.email, name: r.name, deviceTokenIds: deviceTokenFilter[`customer:${r.id}`] || null })),
        ...adminsRes.rows.map((r) => ({ type: 'admin', id: r.id, email: r.email, name: r.name, deviceTokenIds: deviceTokenFilter[`admin:${r.id}`] || null })),
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

async function sendExternalChannel(channel, recipient, notification) {
    if (channel === 'push') {
        return sendPushForNotification(recipient, notification, { tokenIds: recipient.deviceTokenIds });
    }
    if (channel === 'email') {
        if (!recipient.email) throw new Error('Recipient has no email address');
        return sendEmailForNotification(recipient, notification);
    }
    throw new Error(`Channel "${channel}" is not implemented`);
}

/**
 * Send a broadcast immediately — synchronous, no QStash — so "Send Now"
 * works on localhost with no public URL/tunnel and returns real
 * success/failure counts in the same request.
 *
 * `broadcast.channels` (a subset of push/email chosen by the admin) is
 * intersected with each recipient's own admin_broadcast preference — the
 * admin's selection is a ceiling, not an override, so a recipient who opted
 * out of broadcast email still won't get one. In-app always fires and is
 * never counted as a failure on its own: a recipient is only "failed" when
 * every *requested* external channel failed for them.
 */
export async function sendBroadcastNow(broadcast, recipients, extraData = {}) {
    let sent = 0;
    let failed = 0;
    const requestedChannels = (broadcast.channels || []).filter((c) => EXTERNAL_CHANNELS.includes(c));

    for (const recipient of recipients) {
        try {
            const notification = await insertInAppNotification({
                event: 'admin_broadcast',
                recipient,
                data: { title: broadcast.title, body: broadcast.body, imageUrl: broadcast.image_url, ...extraData },
            });
            await pool.query(`UPDATE notifications SET broadcast_id = $1 WHERE id = $2`, [broadcast.id, notification.id]);
            await insertDispatchLogRow({ notificationId: notification.id, broadcastId: broadcast.id, recipient, channel: 'in_app', status: 'sent' });

            const allowedChannels = await resolveEnabledChannelsForBroadcast(recipient, 'admin_broadcast');
            const channels = requestedChannels.filter((c) => allowedChannels.includes(c));

            let anySucceeded = false;
            for (const channel of channels) {
                try {
                    const target = await sendExternalChannel(channel, recipient, notification);
                    await insertDispatchLogRow({ notificationId: notification.id, broadcastId: broadcast.id, recipient, channel, status: 'sent', target });
                    anySucceeded = true;
                } catch (channelErr) {
                    await insertDispatchLogRow({ notificationId: notification.id, broadcastId: broadcast.id, recipient, channel, status: 'failed', error: channelErr.message });
                }
            }

            if (channels.length === 0 || anySucceeded) {
                sent++;
            } else {
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
export async function scheduleBroadcastFor(broadcast, recipients, scheduledFor, extraData = {}) {
    const notBefore = Math.floor(scheduledFor.getTime() / 1000);
    const requestedChannels = (broadcast.channels || []).filter((c) => EXTERNAL_CHANNELS.includes(c));

    for (const recipient of recipients) {
        const notification = await insertInAppNotification({
            event: 'admin_broadcast',
            recipient,
            data: { title: broadcast.title, body: broadcast.body, imageUrl: broadcast.image_url, ...extraData },
            scheduledFor,
        });
        await pool.query(`UPDATE notifications SET broadcast_id = $1 WHERE id = $2`, [broadcast.id, notification.id]);

        const allowedChannels = await resolveEnabledChannelsForBroadcast(recipient, 'admin_broadcast');
        const channels = requestedChannels.filter((c) => allowedChannels.includes(c));
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
                    tokenIds: recipient.deviceTokenIds || undefined,
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

/**
 * Deletes a broadcast: cancels any still-pending QStash sends so they don't
 * fire against a notification row that's about to disappear, removes it
 * from every recipient's in-app feed, then removes the broadcast itself.
 * notification_dispatch_log rows are left in place (their broadcast_id just
 * goes NULL via the FK) as a send-attempt audit trail — see
 * migration_admin_broadcasts.sql.
 */
export async function deleteBroadcast(broadcastId) {
    const { rows: pending } = await pool.query(
        `SELECT id, qstash_message_id FROM notification_dispatch_log
         WHERE broadcast_id = $1 AND status = 'queued' AND qstash_message_id IS NOT NULL`,
        [broadcastId]
    );
    for (const row of pending) {
        try {
            await cancelScheduledMessage(row.qstash_message_id);
            await pool.query(`UPDATE notification_dispatch_log SET status = 'skipped' WHERE id = $1`, [row.id]);
        } catch (err) {
            // Message may have already fired or expired — not fatal either way.
            logger.warn('[deleteBroadcast] Failed to cancel scheduled message', { broadcastId, message: err.message });
        }
    }

    await pool.query(`DELETE FROM notifications WHERE broadcast_id = $1`, [broadcastId]);
    const { rowCount } = await pool.query(`DELETE FROM admin_broadcasts WHERE id = $1`, [broadcastId]);
    return rowCount > 0;
}
