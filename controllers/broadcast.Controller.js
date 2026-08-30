import pool from '../db.js';
import logger from '../utils/logger.js';
import { resolveAudience, sendBroadcastNow, scheduleBroadcastFor, deleteBroadcast as deleteBroadcastRecords } from '../services/notification/broadcast.js';

const AUDIENCE_TYPES = ['all_customers', 'all_admins', 'custom', 'hall_customers'];
const CHANNEL_TYPES = ['push', 'email'];

// GET /api/notifications/device-tokens?type=customer|admin&id=<uuid> — Super Admin only
// Powers the "pick specific devices" step of the broadcast composer.
export const getDeviceTokensForPicker = async (req, res) => {
    const { type, id } = req.query;
    if (!['customer', 'admin'].includes(type) || !id) {
        return res.status(400).json({ error: 'type (customer|admin) and id are required' });
    }

    try {
        const idCol = type === 'customer' ? 'customer_id' : 'admin_id';
        const { rows } = await pool.query(
            `SELECT id, platform, last_seen_at, created_at FROM device_tokens WHERE ${idCol} = $1 ORDER BY last_seen_at DESC`,
            [id]
        );
        return res.status(200).json({ tokens: rows });
    } catch (err) {
        logger.error('❌ getDeviceTokensForPicker error:', { message: err.message });
        return res.status(500).json({ error: 'Failed to fetch device tokens' });
    }
};

// POST /api/notifications/broadcast — Super Admin only
// Body: { title, body, imageUrl, audienceType, customerIds?, adminIds?, deviceTokenFilter?, cinemaHallId?, channels?, scheduledFor? }
export const createBroadcast = async (req, res) => {
    const {
        title, body, imageUrl, audienceType,
        customerIds = [], adminIds = [], deviceTokenFilter = {},
        cinemaHallId, channels, scheduledFor,
    } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'title is required' });
    }
    if (!AUDIENCE_TYPES.includes(audienceType)) {
        return res.status(400).json({ error: `audienceType must be one of ${AUDIENCE_TYPES.join(', ')}` });
    }
    if (audienceType === 'custom' && customerIds.length === 0 && adminIds.length === 0) {
        return res.status(400).json({ error: 'Select at least one person for a custom audience' });
    }
    if (audienceType === 'hall_customers' && !cinemaHallId) {
        return res.status(400).json({ error: 'cinemaHallId is required for a hall_customers audience' });
    }
    if (typeof deviceTokenFilter !== 'object' || Array.isArray(deviceTokenFilter) || deviceTokenFilter === null) {
        return res.status(400).json({ error: 'deviceTokenFilter must be an object' });
    }
    // In-app is implicit and always fires, so only push/email are stored —
    // default to push so existing callers (and pre-channel-picker clients)
    // keep behaving exactly as before.
    const resolvedChannels = channels === undefined ? ['push'] : channels;
    if (!Array.isArray(resolvedChannels) || resolvedChannels.some((c) => !CHANNEL_TYPES.includes(c))) {
        return res.status(400).json({ error: `channels must be a subset of ${CHANNEL_TYPES.join(', ')}` });
    }

    let scheduledDate = null;
    if (scheduledFor) {
        scheduledDate = new Date(scheduledFor);
        if (Number.isNaN(scheduledDate.getTime())) {
            return res.status(400).json({ error: 'scheduledFor is not a valid date' });
        }
    }
    const isFutureSend = scheduledDate && scheduledDate.getTime() > Date.now();

    try {
        const recipients = await resolveAudience({ audienceType, customerIds, adminIds, deviceTokenFilter, cinemaHallId });

        const { rows } = await pool.query(
            `INSERT INTO admin_broadcasts
               (created_by, title, body, image_url, audience_type, recipient_customer_ids, recipient_admin_ids, device_token_filter, target_count, scheduled_for, channels, source, cinema_hall_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manual', $12)
             RETURNING *`,
            [
                req.admin.id,
                title.trim(),
                body || null,
                imageUrl || null,
                audienceType,
                audienceType === 'custom' ? customerIds : [],
                audienceType === 'custom' ? adminIds : [],
                audienceType === 'custom' ? JSON.stringify(deviceTokenFilter) : '{}',
                recipients.length,
                isFutureSend ? scheduledDate : null,
                resolvedChannels,
                audienceType === 'hall_customers' ? cinemaHallId : null,
            ]
        );
        const broadcast = rows[0];

        if (isFutureSend) {
            await scheduleBroadcastFor(broadcast, recipients, scheduledDate);
            return res.status(201).json({ broadcast: { ...broadcast, status: 'scheduled' } });
        }

        const { sent, failed } = await sendBroadcastNow(broadcast, recipients);
        return res.status(201).json({ broadcast: { ...broadcast, status: 'sent', sent_count: sent, failed_count: failed } });
    } catch (err) {
        logger.error('❌ createBroadcast error:', { message: err.message });
        return res.status(500).json({ error: 'Failed to create broadcast' });
    }
};

// GET /api/notifications/broadcast?source=manual|offer|ad — Super Admin only
// Defaults to 'manual' so the Notifications page's Manual tab excludes the
// auto rows an Offer/Ad announcement generates — see getNotificationActivity
// for those.
export const listBroadcasts = async (req, res) => {
    const { source = 'manual' } = req.query;
    if (!['manual', 'offer', 'ad', 'all'].includes(source)) {
        return res.status(400).json({ error: "source must be one of manual, offer, ad, all" });
    }
    try {
        const { rows } = await pool.query(
            `SELECT b.*, a.name AS created_by_name
             FROM admin_broadcasts b
             LEFT JOIN cinema_admin_user a ON a.id = b.created_by
             WHERE $1 = 'all' OR b.source = $1
             ORDER BY b.created_at DESC
             LIMIT 100`,
            [source]
        );
        return res.status(200).json({ broadcasts: rows });
    } catch (err) {
        logger.error('❌ listBroadcasts error:', { message: err.message });
        return res.status(500).json({ error: 'Failed to fetch broadcasts' });
    }
};

// GET /api/notifications/activity — Super Admin only
// Powers the Notifications page's Auto tab: a unified feed of everything the
// system sent on its own — offer/ad announcements (admin_broadcasts rows
// with source IN ('offer','ad')) and individual event notifications
// (booking_confirmed, show_reminder, refund_*, ...) that were never part of
// a broadcast. Same shape for both so the frontend renders one table.
export const getNotificationActivity = async (req, res) => {
    const { source = 'all', event, status, page = 1 } = req.query;
    const limit = 50;
    const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * limit;

    if (!['all', 'offer', 'ad', 'event'].includes(source)) {
        return res.status(400).json({ error: 'source must be one of all, offer, ad, event' });
    }

    const includeBroadcasts = source === 'all' || source === 'offer' || source === 'ad';
    const includeEvents = source === 'all' || source === 'event';
    const broadcastSourceFilter = source === 'offer' || source === 'ad' ? source : null;

    try {
        const rows = [];
        let total = 0;

        if (includeBroadcasts) {
            const { rows: broadcastRows } = await pool.query(
                `SELECT b.id, b.title, b.body, b.source, b.id AS origin_id, b.audience_type,
                        b.channels, b.status, b.sent_count, b.failed_count, b.target_count,
                        b.created_at, a.name AS created_by_name
                 FROM admin_broadcasts b
                 LEFT JOIN cinema_admin_user a ON a.id = b.created_by
                 WHERE b.source IN ('offer','ad') AND ($1::text IS NULL OR b.source = $1)
                 ORDER BY b.created_at DESC`,
                [broadcastSourceFilter]
            );
            rows.push(...broadcastRows.map((r) => ({
                kind: 'broadcast',
                id: r.id,
                title: r.title,
                body: r.body,
                event: r.source === 'offer' ? 'offer_announcement' : 'ad_announcement',
                source: r.source,
                origin_id: r.origin_id,
                recipient_label: audienceLabelForRow(r),
                recipient_email: null,
                channels: ['in_app', ...(r.channels || [])],
                status: r.status,
                sent_count: r.sent_count,
                failed_count: r.failed_count,
                target_count: r.target_count,
                created_at: r.created_at,
                created_by_name: r.created_by_name,
            })));
        }

        if (includeEvents) {
            const { rows: eventRows } = await pool.query(
                `SELECT n.id, n.event, n.title, n.body, n.created_at,
                        COALESCE(c.name, ad.name) AS recipient_name,
                        COALESCE(c.email, ad.email) AS recipient_email,
                        COALESCE(
                          (SELECT array_agg(DISTINCT d.channel) FROM notification_dispatch_log d WHERE d.notification_id = n.id),
                          '{}'
                        ) AS channels,
                        (
                          SELECT CASE
                            WHEN bool_or(d.status = 'failed') THEN 'failed'
                            WHEN bool_or(d.status = 'queued') THEN 'queued'
                            WHEN count(d.id) > 0 THEN 'sent'
                            ELSE 'in_app_only'
                          END
                          FROM notification_dispatch_log d WHERE d.notification_id = n.id
                        ) AS status
                 FROM notifications n
                 LEFT JOIN customers c ON c.id = n.customer_id
                 LEFT JOIN cinema_admin_user ad ON ad.id = n.admin_id
                 WHERE n.broadcast_id IS NULL
                   AND ($1::text IS NULL OR n.event = $1)
                 ORDER BY n.created_at DESC
                 LIMIT 500`,
                [event || null]
            );
            rows.push(...eventRows.map((r) => ({
                kind: 'event',
                id: r.id,
                title: r.title,
                body: r.body,
                event: r.event,
                source: 'event',
                origin_id: null,
                recipient_label: r.recipient_name || r.recipient_email || '—',
                recipient_email: r.recipient_email,
                channels: ['in_app', ...(r.channels || [])],
                status: r.status,
                sent_count: null,
                failed_count: null,
                target_count: 1,
                created_at: r.created_at,
                created_by_name: null,
            })));
        }

        let filtered = rows;
        if (status) {
            filtered = filtered.filter((r) => r.status === status);
        }
        filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        total = filtered.length;
        const page_rows = filtered.slice(offset, offset + limit);

        return res.status(200).json({ activity: page_rows, total, page: Number(page), limit });
    } catch (err) {
        logger.error('❌ getNotificationActivity error:', { message: err.message });
        return res.status(500).json({ error: 'Failed to fetch notification activity' });
    }
};

function audienceLabelForRow(b) {
    if (b.audience_type === 'all_customers') return 'All customers';
    if (b.audience_type === 'all_admins') return 'All admins';
    if (b.audience_type === 'hall_customers') return 'Hall customers';
    return `${b.target_count} ${b.target_count === 1 ? 'person' : 'people'}`;
}

// GET /api/notifications/broadcast/:id — Super Admin only
export const getBroadcast = async (req, res) => {
    const { id } = req.params;
    try {
        const [broadcastResult, recipientsResult] = await Promise.all([
            pool.query(
                `SELECT b.*, a.name AS created_by_name
                 FROM admin_broadcasts b
                 LEFT JOIN cinema_admin_user a ON a.id = b.created_by
                 WHERE b.id = $1`,
                [id]
            ),
            pool.query(
                `SELECT d.id, d.channel, d.status, d.target, d.error, d.attempted_at, d.created_at,
                        d.customer_id, d.admin_id,
                        COALESCE(c.name, ad.name) AS recipient_name,
                        COALESCE(c.email, ad.email) AS recipient_email
                 FROM notification_dispatch_log d
                 LEFT JOIN customers c ON c.id = d.customer_id
                 LEFT JOIN cinema_admin_user ad ON ad.id = d.admin_id
                 WHERE d.broadcast_id = $1
                 ORDER BY d.created_at DESC`,
                [id]
            ),
        ]);

        if (broadcastResult.rows.length === 0) {
            return res.status(404).json({ error: 'Broadcast not found' });
        }

        return res.status(200).json({ broadcast: broadcastResult.rows[0], recipients: recipientsResult.rows });
    } catch (err) {
        logger.error('❌ getBroadcast error:', { message: err.message });
        return res.status(500).json({ error: 'Failed to fetch broadcast' });
    }
};

// DELETE /api/notifications/broadcast/:id — Super Admin only
// Removes it from every recipient's in-app feed and cancels any pending
// scheduled send.
export const deleteBroadcast = async (req, res) => {
    const { id } = req.params;
    try {
        const deleted = await deleteBroadcastRecords(id);
        if (!deleted) {
            return res.status(404).json({ error: 'Broadcast not found' });
        }
        return res.status(200).json({ deleted: true });
    } catch (err) {
        logger.error('❌ deleteBroadcast error:', { message: err.message });
        return res.status(500).json({ error: 'Failed to delete broadcast' });
    }
};
