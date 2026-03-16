import db from "../db.js";

/**
 * GET /api/settings
 * Public - returns convenience_fee_per_ticket and gst_percentage
 */
export const getSettings = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT key, value FROM settings WHERE key IN ('convenience_fee_per_ticket', 'gst_percentage')`
        );

        const settings = {};
        result.rows.forEach(({ key, value }) => {
            settings[key] = parseFloat(value);
        });

        return res.status(200).json(settings);
    } catch (error) {
        console.error("❌ Get settings error:", error);
        return res.status(500).json({ error: "Failed to fetch settings" });
    }
};

/**
 * PUT /api/settings
 * Super Admin only - update convenience_fee_per_ticket and/or gst_percentage
 * Body: { convenience_fee_per_ticket?, gst_percentage? }
 */
export const updateSettings = async (req, res) => {
    const { convenience_fee_per_ticket, gst_percentage } = req.body;

    const updates = [];
    if (convenience_fee_per_ticket !== undefined) {
        const val = parseFloat(convenience_fee_per_ticket);
        if (isNaN(val) || val < 0) {
            return res.status(400).json({ error: "Invalid convenience_fee_per_ticket" });
        }
        updates.push({ key: "convenience_fee_per_ticket", value: String(val) });
    }
    if (gst_percentage !== undefined) {
        const val = parseFloat(gst_percentage);
        if (isNaN(val) || val < 0 || val > 100) {
            return res.status(400).json({ error: "Invalid gst_percentage" });
        }
        updates.push({ key: "gst_percentage", value: String(val) });
    }

    if (updates.length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
    }

    try {
        for (const { key, value } of updates) {
            await db.query(
                `UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2`,
                [value, key]
            );
        }

        return res.status(200).json({ message: "Settings updated successfully" });
    } catch (error) {
        console.error("❌ Update settings error:", error);
        return res.status(500).json({ error: "Failed to update settings" });
    }
};
