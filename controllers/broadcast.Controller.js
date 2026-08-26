import pool from '../db.js';
import logger from '../utils/logger.js';
import { resolveAudience, sendBroadcastNow, scheduleBroadcastFor, deleteBroadcast as deleteBroadcastRecords } from '../services/notification/broadcast.js';

const AUDIENCE_TYPES = ['all_customers', 'all_admins', 'custom'];

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
// Body: { title, body, imageUrl, audienceType, customerIds?, adminIds?, deviceTokenFilter?, scheduledFor? }
export const createBroadcast = async (req, res) => {
    const { title, body, imageUrl, audienceType, customerIds = [], adminIds = [], deviceTokenFilter = {}, scheduledFor } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'title is required' });
    }
    if (!AUDIENCE_TYPES.includes(audienceType)) {
        return res.status(400).json({ error: `audienceType must be one of ${AUDIENCE_TYPES.join(', ')}` });
    }
    if (audienceType === 'custom' && customerIds.length === 0 && adminIds.length === 0) {
        return res.status(400).json({ error: 'Select at least one person for a custom audience' });
    }
    if (typeof deviceTokenFilter !== 'object' || Array.isArray(deviceTokenFilter) || deviceTokenFilter === null) {
        return res.status(400).json({ error: 'deviceTokenFilter must be an object' });
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
        const recipients = await resolveAudience({ audienceType, customerIds, adminIds, deviceTokenFilter });

        const { rows } = await pool.query(
            `INSERT INTO admin_broadcasts
               (created_by, title, body, image_url, audience_type, recipient_customer_ids, recipient_admin_ids, device_token_filter, target_count, scheduled_for)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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

// GET /api/notifications/broadcast — Super Admin only
export const listBroadcasts = async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT b.*, a.name AS created_by_name
             FROM admin_broadcasts b
             LEFT JOIN cinema_admin_user a ON a.id = b.created_by
             ORDER BY b.created_at DESC
             LIMIT 100`
        );
        return res.status(200).json({ broadcasts: rows });
    } catch (err) {
        logger.error('❌ listBroadcasts error:', { message: err.message });
        return res.status(500).json({ error: 'Failed to fetch broadcasts' });
    }
};

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
