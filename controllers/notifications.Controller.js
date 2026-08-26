import db from '../db.js';
import logger from '../utils/logger.js';
import { DEFAULT_EVENT_PREFERENCES } from '../services/notification/defaultPreferences.js';

const recipientColumn = (type) => (type === 'customer' ? 'customer_id' : 'admin_id');

// GET /api/notifications?page=&limit=
export const listNotifications = async (req, res) => {
    try {
        const { type, id } = req.recipient;
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const offset = (page - 1) * limit;

        const { rows } = await db.query(
            `SELECT id, event, title, body, data, booking_id, show_id, refund_id, read_at, created_at
             FROM notifications
             WHERE ${recipientColumn(type)} = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [id, limit, offset]
        );

        return res.status(200).json({ notifications: rows, page, limit });
    } catch (error) {
        logger.error('❌ listNotifications error:', { message: error.message });
        return res.status(500).json({ error: 'Failed to fetch notifications' });
    }
};

// GET /api/notifications/unread-count
export const getUnreadCount = async (req, res) => {
    try {
        const { type, id } = req.recipient;
        const { rows } = await db.query(
            `SELECT COUNT(*)::int AS count FROM notifications WHERE ${recipientColumn(type)} = $1 AND read_at IS NULL`,
            [id]
        );
        return res.status(200).json({ count: rows[0].count });
    } catch (error) {
        logger.error('❌ getUnreadCount error:', { message: error.message });
        return res.status(500).json({ error: 'Failed to fetch unread count' });
    }
};

// PATCH /api/notifications/:id/read
export const markAsRead = async (req, res) => {
    try {
        const { type, id: recipientId } = req.recipient;
        const { id: notificationId } = req.params;

        const { rowCount } = await db.query(
            `UPDATE notifications SET read_at = now()
             WHERE id = $1 AND ${recipientColumn(type)} = $2 AND read_at IS NULL`,
            [notificationId, recipientId]
        );

        return res.status(200).json({ updated: rowCount > 0 });
    } catch (error) {
        logger.error('❌ markAsRead error:', { message: error.message });
        return res.status(500).json({ error: 'Failed to mark notification as read' });
    }
};

// PATCH /api/notifications/read-all
export const markAllRead = async (req, res) => {
    try {
        const { type, id } = req.recipient;
        const { rowCount } = await db.query(
            `UPDATE notifications SET read_at = now() WHERE ${recipientColumn(type)} = $1 AND read_at IS NULL`,
            [id]
        );
        return res.status(200).json({ updated: rowCount });
    } catch (error) {
        logger.error('❌ markAllRead error:', { message: error.message });
        return res.status(500).json({ error: 'Failed to mark all notifications as read' });
    }
};

// GET /api/notifications/preferences
export const getPreferences = async (req, res) => {
    try {
        const { type, id } = req.recipient;
        const table = type === 'customer' ? 'customer_settings' : 'user_settings';

        const { rows } = await db.query(
            `SELECT value FROM ${table} WHERE ${recipientColumn(type)} = $1 AND section = 'notifications'`,
            [id]
        );
        const stored = rows[0]?.value || {};
        const preferences = { ...DEFAULT_EVENT_PREFERENCES, ...stored };

        return res.status(200).json({ preferences });
    } catch (error) {
        logger.error('❌ getPreferences error:', { message: error.message });
        return res.status(500).json({ error: 'Failed to fetch notification preferences' });
    }
};

// POST /api/notifications/device-token
// Body: { token, platform: 'web'|'android'|'ios' }
export const registerDeviceToken = async (req, res) => {
    const { token, platform } = req.body;
    if (!token || !['web', 'android', 'ios'].includes(platform)) {
        return res.status(400).json({ error: 'token and a valid platform are required' });
    }

    try {
        const { type, id } = req.recipient;
        // ON CONFLICT (token) — a token is globally unique. If the same device
        // re-registers (browser refresh, app relaunch) or logs in as a
        // different account, re-point it to the current recipient.
        await db.query(
            `INSERT INTO device_tokens (customer_id, admin_id, token, platform, last_seen_at)
             VALUES ($1, $2, $3, $4, now())
             ON CONFLICT (token) DO UPDATE
               SET customer_id = EXCLUDED.customer_id,
                   admin_id = EXCLUDED.admin_id,
                   platform = EXCLUDED.platform,
                   last_seen_at = now()`,
            [type === 'customer' ? id : null, type === 'admin' ? id : null, token, platform]
        );
        return res.status(200).json({ registered: true });
    } catch (error) {
        logger.error('❌ registerDeviceToken error:', { message: error.message });
        return res.status(500).json({ error: 'Failed to register device token' });
    }
};

// DELETE /api/notifications/device-token
// Body: { token }
export const unregisterDeviceToken = async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token is required' });

    try {
        await db.query(`DELETE FROM device_tokens WHERE token = $1`, [token]);
        return res.status(200).json({ unregistered: true });
    } catch (error) {
        logger.error('❌ unregisterDeviceToken error:', { message: error.message });
        return res.status(500).json({ error: 'Failed to unregister device token' });
    }
};

// PATCH /api/notifications/preferences
// Body: { patch: { <event>: { email, sms, whatsapp, push }, ... } }
export const updatePreferences = async (req, res) => {
    const { patch } = req.body;
    if (!patch || typeof patch !== 'object') {
        return res.status(400).json({ error: 'patch (object) is required' });
    }

    try {
        const { type, id } = req.recipient;
        const table = type === 'customer' ? 'customer_settings' : 'user_settings';
        const idCol = recipientColumn(type);

        const { rows } = await db.query(
            `SELECT value FROM ${table} WHERE ${idCol} = $1 AND section = 'notifications'`,
            [id]
        );
        const merged = { ...(rows[0]?.value || {}), ...patch };

        await db.query(
            `INSERT INTO ${table} (${idCol}, section, value, updated_at)
             VALUES ($1, 'notifications', $2, now())
             ON CONFLICT (${idCol}, section) DO UPDATE
               SET value = EXCLUDED.value, updated_at = now()`,
            [id, JSON.stringify(merged)]
        );

        return res.status(200).json({ preferences: { ...DEFAULT_EVENT_PREFERENCES, ...merged } });
    } catch (error) {
        logger.error('❌ updatePreferences error:', { message: error.message });
        return res.status(500).json({ error: 'Failed to update notification preferences' });
    }
};
