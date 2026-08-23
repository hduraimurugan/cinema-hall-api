import pool from '../../db.js';
import logger from '../../utils/logger.js';
import { insertInAppNotification } from './channels/inApp.js';
import { resolveEnabledChannels } from './preferences.js';
import { publishDispatch, cancelScheduledMessage } from './qstashClient.js';

/**
 * @param {string} event — one of the taxonomy in defaultPreferences.js
 * @param {{type: 'customer'|'admin', id: string, orgId?: string}} recipient
 * @param {object} data — event-specific payload (bookingId, showId, movieTitle, ...)
 *
 * Must be called AFTER the triggering transaction's COMMIT, never inside it —
 * a notification failure must never turn a successful payment/cancellation
 * into a 500. Every error is caught and logged here; nothing propagates.
 */
export async function notify(event, recipient, data = {}) {
    try {
        const notification = await insertInAppNotification({ event, recipient, data });

        const channels = await resolveEnabledChannels(recipient, event);
        for (const channel of channels) {
            const logRow = await createDispatchLogRow({ notification, recipient, event, channel });
            try {
                const { messageId } = await publishDispatch({
                    notificationId: notification.id,
                    event,
                    recipientType: recipient.type,
                    recipientId: recipient.id,
                    channel,
                });
                await pool.query(
                    `UPDATE notification_dispatch_log SET qstash_message_id = $1 WHERE id = $2`,
                    [messageId, logRow.id]
                );
            } catch (publishErr) {
                logger.error('[notify] QStash publish failed', { event, channel, message: publishErr.message });
                await pool.query(
                    `UPDATE notification_dispatch_log SET status = 'failed', error = $1 WHERE id = $2`,
                    [publishErr.message, logRow.id]
                );
            }
        }

        return notification;
    } catch (err) {
        logger.error('[notify] failed', { event, recipient, message: err.message });
        return null;
    }
}

async function createDispatchLogRow({ notification, recipient, event, channel }) {
    const { rows } = await pool.query(
        `INSERT INTO notification_dispatch_log
           (notification_id, org_id, customer_id, admin_id, event, channel, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'queued')
         RETURNING *`,
        [
            notification.id,
            recipient.orgId || null,
            recipient.type === 'customer' ? recipient.id : null,
            recipient.type === 'admin' ? recipient.id : null,
            event,
            channel,
        ]
    );
    return rows[0];
}

/**
 * Schedule a show_reminder for a confirmed booking, if the showtime is far
 * enough out to be worth reminding about. Called from the booking_confirmed
 * trigger sites (verifyPayment / handlePaymentCaptured).
 *
 * @param {{bookingId, showId, customerId, orgId, movieTitle, seats, showDateTime: Date}} params
 */
export async function scheduleShowReminder({ bookingId, showId, customerId, orgId, movieTitle, seats, showDateTime }) {
    const REMINDER_OFFSET_MINUTES = 60;
    const reminderAt = new Date(showDateTime.getTime() - REMINDER_OFFSET_MINUTES * 60 * 1000);

    if (reminderAt.getTime() <= Date.now()) {
        // Booking made too close to showtime — nothing useful to remind about.
        return null;
    }

    const notification = await insertInAppNotification({
        event: 'show_reminder',
        recipient: { type: 'customer', id: customerId, orgId },
        data: { bookingId, showId, movieTitle, seats, startTime: showDateTime.toISOString() },
    });

    const channels = await resolveEnabledChannels({ type: 'customer', id: customerId, orgId }, 'show_reminder');
    for (const channel of channels) {
        const logRow = await createDispatchLogRow({ notification, recipient: { type: 'customer', id: customerId, orgId }, event: 'show_reminder', channel });
        try {
            const { messageId } = await publishDispatch({
                notificationId: notification.id,
                event: 'show_reminder',
                recipientType: 'customer',
                recipientId: customerId,
                channel,
                notBefore: Math.floor(reminderAt.getTime() / 1000),
            });
            await pool.query(
                `UPDATE notification_dispatch_log SET qstash_message_id = $1 WHERE id = $2`,
                [messageId, logRow.id]
            );
        } catch (publishErr) {
            logger.error('[scheduleShowReminder] QStash publish failed', { bookingId, channel, message: publishErr.message });
        }
    }

    return notification;
}

/**
 * Cancel any show_reminder scheduled for this booking (called when a show is
 * cancelled) so a stale reminder doesn't fire after the show no longer runs.
 * Safe to call even if no reminder was ever scheduled (e.g. booking made too
 * close to showtime) — it just finds nothing to cancel.
 */
export async function cancelShowReminder(bookingId) {
    const { rows } = await pool.query(
        `SELECT d.id, d.qstash_message_id
         FROM notification_dispatch_log d
         JOIN notifications n ON n.id = d.notification_id
         WHERE n.booking_id = $1 AND n.event = 'show_reminder'
           AND d.status = 'queued' AND d.qstash_message_id IS NOT NULL`,
        [bookingId]
    );

    for (const row of rows) {
        try {
            await cancelScheduledMessage(row.qstash_message_id);
            await pool.query(`UPDATE notification_dispatch_log SET status = 'skipped' WHERE id = $1`, [row.id]);
        } catch (err) {
            // Message may have already fired or expired — not fatal either way.
            logger.warn('[cancelShowReminder] Failed to cancel scheduled message', { bookingId, message: err.message });
        }
    }
}
