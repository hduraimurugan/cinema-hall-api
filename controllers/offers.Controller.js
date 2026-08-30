import db from "../db.js";
import logger from '../utils/logger.js';
import { resolveOrgId } from '../middleware/requirePermission.js';
import { recordAuditLog } from '../utils/auditLog.js';
import { announceOffer } from '../services/notification/announce.js';

// ─────────────────────────────────────────────────────────────
// Shared validation helper (used by validateOffer + createOrder)
// ─────────────────────────────────────────────────────────────

/**
 * Validates an offer code and calculates the discount amount.
 * Returns { offer, discountAmount } on success, throws Error on failure.
 *
 * @param {object} params
 * @param {string} params.offer_code
 * @param {string} params.show_id
 * @param {number} params.total_amount  - grand total BEFORE discount (ticket + conv + gst)
 * @param {string} params.customer_id
 */
export async function validateOfferCode({ offer_code, show_id, total_amount, customer_id }) {
    // 1. Find the offer (case-insensitive)
    const offerResult = await db.query(
        `SELECT * FROM offers WHERE UPPER(code) = UPPER($1)`,
        [offer_code]
    );

    if (offerResult.rowCount === 0) {
        throw Object.assign(new Error("Invalid offer code."), { status: 400 });
    }

    const offer = offerResult.rows[0];

    // 2. is_active check
    if (!offer.is_active) {
        throw Object.assign(new Error("This offer is no longer active."), { status: 400 });
    }

    // 3. Expiry check
    if (new Date(offer.valid_until) < new Date()) {
        throw Object.assign(new Error("This offer has expired."), { status: 400 });
    }

    // 4. Minimum booking amount
    if (parseFloat(total_amount) < parseFloat(offer.min_booking_amount)) {
        throw Object.assign(
            new Error(`Minimum booking amount of ₹${offer.min_booking_amount} required for this offer.`),
            { status: 400 }
        );
    }

    // 5. Hall-scoped offer check
    if (offer.scope === 'hall') {
        const showResult = await db.query(
            `SELECT sc.cinema_hall_id FROM shows sh JOIN screens sc ON sc.id = sh.screen_id WHERE sh.id = $1`,
            [show_id]
        );
        if (showResult.rowCount === 0) {
            throw Object.assign(new Error("Show not found."), { status: 404 });
        }
        if (showResult.rows[0].cinema_hall_id !== offer.cinema_hall_id) {
            throw Object.assign(new Error("This offer is not valid for this cinema hall."), { status: 400 });
        }
    }

    // 6. User eligibility check
    if (offer.user_eligibility === 'joined_after') {
        const customerResult = await db.query(
            `SELECT created_at FROM customers WHERE id = $1`,
            [customer_id]
        );
        if (customerResult.rowCount === 0) {
            throw Object.assign(new Error("Customer not found."), { status: 404 });
        }
        if (new Date(customerResult.rows[0].created_at) <= new Date(offer.user_joined_after)) {
            throw Object.assign(
                new Error("This offer is only available to users who joined after a specific date."),
                { status: 400 }
            );
        }
    }

    // 7. Prior redemption check
    const redemptionCheck = await db.query(
        `SELECT id FROM offer_redemptions WHERE offer_id = $1 AND customer_id = $2`,
        [offer.id, customer_id]
    );
    if (redemptionCheck.rowCount > 0) {
        throw Object.assign(new Error("You have already used this offer."), { status: 400 });
    }

    // 8. Calculate discount
    let discountAmount;
    if (offer.discount_type === 'fixed') {
        discountAmount = parseFloat(offer.discount_value);
    } else {
        const raw = parseFloat(total_amount) * (parseFloat(offer.discount_value) / 100);
        discountAmount = offer.max_discount_amount
            ? Math.min(raw, parseFloat(offer.max_discount_amount))
            : raw;
    }
    discountAmount = +discountAmount.toFixed(2);

    // Discount cannot exceed total amount
    discountAmount = Math.min(discountAmount, parseFloat(total_amount));

    return { offer, discountAmount };
}


// ─────────────────────────────────────────────────────────────
// GET /api/offers/cinema-halls  (halls the caller may assign an offer to)
// ─────────────────────────────────────────────────────────────
export const getAllCinemaHalls = async (req, res) => {
    try {
        if (req.admin.role === 'superAdmin') {
            const result = await db.query(`SELECT id, name FROM cinema_hall ORDER BY name ASC`);
            return res.status(200).json({ halls: result.rows });
        }

        const orgId = await resolveOrgId(req.admin.id);
        if (!orgId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        const result = await db.query(
            `SELECT id, name FROM cinema_hall WHERE org_id = $1 ORDER BY name ASC`,
            [orgId]
        );
        return res.status(200).json({ halls: result.rows });
    } catch (error) {
        logger.error("❌ getAllCinemaHalls error:", { error });
        return res.status(500).json({ error: "Failed to fetch cinema halls." });
    }
};


// ─────────────────────────────────────────────────────────────
// GET /api/offers  (superAdmin sees all; others see only offers they created)
// ─────────────────────────────────────────────────────────────
export const getAllOffers = async (req, res) => {
    const { scope, is_active, search, page = 1 } = req.query;
    const limit = 50;
    const offset = (parseInt(page) - 1) * limit;
    const isSuperAdmin = req.admin.role === 'superAdmin';

    try {
        const params = [
            scope || null,
            is_active !== undefined ? is_active : null,
            search || null,
            isSuperAdmin ? null : req.admin.id,
        ];

        const result = await db.query(`
            SELECT o.*,
                   ch.name AS cinema_hall_name,
                   cau.name AS created_by_name,
                   cau.email AS created_by_email,
                   CASE WHEN cau.role = 'superAdmin' THEN 'Super Admin' ELSE creator_role.role_key END AS created_by_role
            FROM offers o
            LEFT JOIN cinema_hall ch ON ch.id = o.cinema_hall_id
            LEFT JOIN cinema_admin_user cau ON cau.id = o.created_by
            LEFT JOIN LATERAL (
                SELECT r.key AS role_key
                FROM organization_members om
                JOIN roles r ON r.id = om.role_id
                JOIN organizations org ON org.id = om.org_id
                WHERE om.admin_id = o.created_by AND om.status = 'active' AND org.is_active = TRUE
                ORDER BY EXISTS (SELECT 1 FROM cinema_hall ch2 WHERE ch2.org_id = org.id) DESC,
                         (org.owner_id = o.created_by) DESC,
                         om.created_at ASC
                LIMIT 1
            ) creator_role ON true
            WHERE ($1::text IS NULL OR o.scope = $1)
              AND ($2::boolean IS NULL OR o.is_active = $2)
              AND ($3::text IS NULL OR UPPER(o.code) LIKE '%' || UPPER($3) || '%'
                                    OR LOWER(o.title) LIKE '%' || LOWER($3) || '%')
              AND ($4::uuid IS NULL OR o.created_by = $4)
            ORDER BY o.created_at DESC
            LIMIT ${limit} OFFSET $5
        `, [...params, offset]);

        const countResult = await db.query(`
            SELECT COUNT(*) AS total FROM offers o
            WHERE ($1::text IS NULL OR o.scope = $1)
              AND ($2::boolean IS NULL OR o.is_active = $2)
              AND ($3::text IS NULL OR UPPER(o.code) LIKE '%' || UPPER($3) || '%'
                                    OR LOWER(o.title) LIKE '%' || LOWER($3) || '%')
              AND ($4::uuid IS NULL OR o.created_by = $4)
        `, params);

        return res.status(200).json({
            offers: result.rows,
            total: parseInt(countResult.rows[0].total),
            page: parseInt(page),
        });
    } catch (error) {
        logger.error("❌ getAllOffers error:", { error });
        return res.status(500).json({ error: "Failed to fetch offers." });
    }
};


// ─────────────────────────────────────────────────────────────
// POST /api/offers/create  (superAdmin)
// ─────────────────────────────────────────────────────────────
export const createOffer = async (req, res) => {
    const admin_id = req.admin?.id;
    const {
        code, title, description,
        discount_type, discount_value, max_discount_amount,
        min_booking_amount,
        is_active, valid_until,
        scope, cinema_hall_id,
        user_eligibility, user_joined_after,
        notify,
    } = req.body;

    if (!code || !title || !discount_type || !discount_value || !valid_until) {
        return res.status(400).json({ error: "code, title, discount_type, discount_value, and valid_until are required." });
    }

    if (!['percentage', 'fixed'].includes(discount_type)) {
        return res.status(400).json({ error: "discount_type must be 'percentage' or 'fixed'." });
    }

    const isSuperAdmin = req.admin?.role === 'superAdmin';
    const resolvedScope = scope || 'global';

    if (resolvedScope === 'global' && !isSuperAdmin) {
        return res.status(403).json({ error: "Only Super Admin can create global offers." });
    }

    if (resolvedScope === 'hall' && !isSuperAdmin) {
        if (!cinema_hall_id) {
            return res.status(400).json({ error: "cinema_hall_id is required for hall-scoped offers." });
        }
        const orgId = await resolveOrgId(admin_id);
        if (!orgId) {
            return res.status(403).json({ error: 'No organization found' });
        }
        const hallResult = await db.query(`SELECT org_id FROM cinema_hall WHERE id = $1`, [cinema_hall_id]);
        if (hallResult.rowCount === 0 || hallResult.rows[0].org_id !== orgId) {
            return res.status(403).json({ error: "You can only create offers for your own cinema hall." });
        }
    }

    try {
        const result = await db.query(`
            INSERT INTO offers
              (code, title, description, discount_type, discount_value, max_discount_amount,
               min_booking_amount, is_active, valid_until, scope, cinema_hall_id,
               user_eligibility, user_joined_after, created_by)
            VALUES
              (UPPER($1), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *
        `, [
            code, title, description || null,
            discount_type, discount_value, max_discount_amount || null,
            min_booking_amount || 0,
            is_active !== undefined ? is_active : true,
            valid_until,
            scope || 'global',
            scope === 'hall' ? cinema_hall_id : null,
            user_eligibility || 'all',
            user_eligibility === 'joined_after' ? user_joined_after : null,
            admin_id || null,
        ]);

        await recordAuditLog(req, {
            action: 'offers.create',
            resourceType: 'offer',
            resourceId: result.rows[0].id,
            resourceLabel: result.rows[0].code,
            hallId: result.rows[0].cinema_hall_id,
        });

        let announced = false;
        if (notify?.enabled) {
            try {
                await announceOffer(result.rows[0], {
                    adminId: admin_id,
                    channels: notify.channels,
                    title: notify.title,
                    body: notify.body,
                });
                announced = true;
            } catch (notifyErr) {
                // Never fail offer creation over a dead FCM token or SMTP
                // hiccup — the offer already exists, only the announcement failed.
                logger.error("❌ announceOffer (on create) error:", { message: notifyErr.message });
            }
        }

        return res.status(201).json({ offer: result.rows[0], announced });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: "An offer with this code already exists." });
        }
        logger.error("❌ createOffer error:", { error });
        return res.status(500).json({ error: "Failed to create offer." });
    }
};


// ─────────────────────────────────────────────────────────────
// GET /api/offers/:id  (superAdmin sees any; others only their own)
// ─────────────────────────────────────────────────────────────
export const getOfferById = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query(`
            SELECT o.*, ch.name AS cinema_hall_name, cau.name AS created_by_name
            FROM offers o
            LEFT JOIN cinema_hall ch ON ch.id = o.cinema_hall_id
            LEFT JOIN cinema_admin_user cau ON cau.id = o.created_by
            WHERE o.id = $1
        `, [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Offer not found." });
        }
        const offer = result.rows[0];
        if (req.admin.role !== 'superAdmin' && offer.created_by !== req.admin.id) {
            return res.status(403).json({ error: "You can only view offers you created." });
        }
        return res.status(200).json({ offer });
    } catch (error) {
        logger.error("❌ getOfferById error:", { error });
        return res.status(500).json({ error: "Failed to fetch offer." });
    }
};


// ─────────────────────────────────────────────────────────────
// PUT /api/offers/update/:id  (superAdmin, or the offer's creator)
// ─────────────────────────────────────────────────────────────
export const updateOffer = async (req, res) => {
    const { id } = req.params;
    const {
        code, title, description,
        discount_type, discount_value, max_discount_amount,
        min_booking_amount, is_active, valid_until,
        scope, cinema_hall_id,
        user_eligibility, user_joined_after,
    } = req.body;

    const isSuperAdmin = req.admin.role === 'superAdmin';
    const resolvedScope = scope || 'global';

    try {
        const existing = await db.query(`SELECT created_by FROM offers WHERE id = $1`, [id]);
        if (existing.rowCount === 0) {
            return res.status(404).json({ error: "Offer not found." });
        }
        if (!isSuperAdmin && existing.rows[0].created_by !== req.admin.id) {
            return res.status(403).json({ error: "You can only edit offers you created." });
        }

        if (resolvedScope === 'global' && !isSuperAdmin) {
            return res.status(403).json({ error: "Only Super Admin can create global offers." });
        }

        if (resolvedScope === 'hall' && !isSuperAdmin) {
            if (!cinema_hall_id) {
                return res.status(400).json({ error: "cinema_hall_id is required for hall-scoped offers." });
            }
            const orgId = await resolveOrgId(req.admin.id);
            if (!orgId) {
                return res.status(403).json({ error: 'No organization found' });
            }
            const hallResult = await db.query(`SELECT org_id FROM cinema_hall WHERE id = $1`, [cinema_hall_id]);
            if (hallResult.rowCount === 0 || hallResult.rows[0].org_id !== orgId) {
                return res.status(403).json({ error: "You can only create offers for your own cinema hall." });
            }
        }

        const result = await db.query(`
            UPDATE offers SET
                code = UPPER($1),
                title = $2,
                description = $3,
                discount_type = $4,
                discount_value = $5,
                max_discount_amount = $6,
                min_booking_amount = $7,
                is_active = $8,
                valid_until = $9,
                scope = $10,
                cinema_hall_id = $11,
                user_eligibility = $12,
                user_joined_after = $13,
                updated_at = NOW()
            WHERE id = $14
            RETURNING *
        `, [
            code, title, description || null,
            discount_type, discount_value, max_discount_amount || null,
            min_booking_amount || 0,
            is_active,
            valid_until,
            scope || 'global',
            scope === 'hall' ? cinema_hall_id : null,
            user_eligibility || 'all',
            user_eligibility === 'joined_after' ? user_joined_after : null,
            id,
        ]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Offer not found." });
        }

        await recordAuditLog(req, {
            action: 'offers.update',
            resourceType: 'offer',
            resourceId: result.rows[0].id,
            resourceLabel: result.rows[0].code,
            hallId: result.rows[0].cinema_hall_id,
        });

        return res.status(200).json({ offer: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: "An offer with this code already exists." });
        }
        logger.error("❌ updateOffer error:", { error });
        return res.status(500).json({ error: "Failed to update offer." });
    }
};


// ─────────────────────────────────────────────────────────────
// DELETE /api/offers/delete/:id  (superAdmin, or the offer's creator)
// ─────────────────────────────────────────────────────────────
export const deleteOffer = async (req, res) => {
    const { id } = req.params;
    try {
        const existing = await db.query(`SELECT created_by FROM offers WHERE id = $1`, [id]);
        if (existing.rowCount === 0) {
            return res.status(404).json({ error: "Offer not found." });
        }
        if (req.admin.role !== 'superAdmin' && existing.rows[0].created_by !== req.admin.id) {
            return res.status(403).json({ error: "You can only delete offers you created." });
        }

        const result = await db.query(`DELETE FROM offers WHERE id = $1 RETURNING id, code, cinema_hall_id`, [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Offer not found." });
        }

        await recordAuditLog(req, {
            action: 'offers.delete',
            resourceType: 'offer',
            resourceId: result.rows[0].id,
            resourceLabel: result.rows[0].code,
            hallId: result.rows[0].cinema_hall_id,
        });

        return res.status(200).json({ message: "Offer deleted." });
    } catch (error) {
        logger.error("❌ deleteOffer error:", { error });
        return res.status(500).json({ error: "Failed to delete offer." });
    }
};


// ─────────────────────────────────────────────────────────────
// POST /api/offers/:id/announce  (superAdmin, or the offer's creator)
// Re-usable "Announce" action for an offer that already exists — the same
// ownership/scope guard updateOffer applies, since sending a promo blast is
// at least as consequential as editing the offer.
// ─────────────────────────────────────────────────────────────
export const announceOfferById = async (req, res) => {
    const { id } = req.params;
    const { channels, title, body } = req.body || {};
    const isSuperAdmin = req.admin.role === 'superAdmin';

    try {
        const existing = await db.query(`SELECT * FROM offers WHERE id = $1`, [id]);
        if (existing.rowCount === 0) {
            return res.status(404).json({ error: "Offer not found." });
        }
        const offer = existing.rows[0];
        if (!isSuperAdmin && offer.created_by !== req.admin.id) {
            return res.status(403).json({ error: "You can only announce offers you created." });
        }
        if (offer.scope === 'hall' && !isSuperAdmin) {
            const orgId = await resolveOrgId(req.admin.id);
            const hallResult = await db.query(`SELECT org_id FROM cinema_hall WHERE id = $1`, [offer.cinema_hall_id]);
            if (!orgId || hallResult.rowCount === 0 || hallResult.rows[0].org_id !== orgId) {
                return res.status(403).json({ error: "You can only announce offers for your own cinema hall." });
            }
        }

        const { broadcast } = await announceOffer(offer, {
            adminId: req.admin.id,
            channels,
            title,
            body,
        });

        await recordAuditLog(req, {
            action: 'offers.announce',
            resourceType: 'offer',
            resourceId: offer.id,
            resourceLabel: offer.code,
            hallId: offer.cinema_hall_id,
        });

        return res.status(201).json({ broadcast });
    } catch (error) {
        logger.error("❌ announceOfferById error:", { message: error.message });
        return res.status(500).json({ error: "Failed to announce offer." });
    }
};


// ─────────────────────────────────────────────────────────────
// GET /api/offers/active  (verifyCustomer — eligible offers for this user)
// ─────────────────────────────────────────────────────────────
export const getActiveOffers = async (req, res) => {
    const customer_id = req.customer.id;

    try {
        // Get customer join date
        const customerResult = await db.query(
            `SELECT created_at FROM customers WHERE id = $1`,
            [customer_id]
        );
        const customerJoinedAt = customerResult.rows[0]?.created_at;

        // Get redeemed offer IDs for this customer
        const redeemedResult = await db.query(
            `SELECT offer_id FROM offer_redemptions WHERE customer_id = $1`,
            [customer_id]
        );
        const redeemedIds = redeemedResult.rows.map(r => r.offer_id);

        // Fetch all active, non-expired offers
        const offersResult = await db.query(`
            SELECT o.*, ch.name AS cinema_hall_name
            FROM offers o
            LEFT JOIN cinema_hall ch ON ch.id = o.cinema_hall_id
            WHERE o.is_active = true
              AND o.valid_until > NOW()
            ORDER BY o.created_at DESC
        `);

        // Filter by user eligibility; mark redeemed ones instead of removing them
        const eligible = offersResult.rows
            .filter(offer => {
                if (offer.user_eligibility === 'joined_after') {
                    if (!customerJoinedAt || new Date(customerJoinedAt) <= new Date(offer.user_joined_after)) {
                        return false;
                    }
                }
                return true;
            })
            .map(offer => ({
                ...offer,
                is_redeemed: redeemedIds.includes(offer.id),
            }))
            .sort((a, b) => a.is_redeemed - b.is_redeemed); // available first, redeemed last

        return res.status(200).json({ offers: eligible });
    } catch (error) {
        logger.error("❌ getActiveOffers error:", { error });
        return res.status(500).json({ error: "Failed to fetch offers." });
    }
};


// ─────────────────────────────────────────────────────────────
// POST /api/offers/validate  (verifyCustomer — preview discount)
// ─────────────────────────────────────────────────────────────
export const validateOffer = async (req, res) => {
    const customer_id = req.customer.id;
    const { offer_code, show_id, total_amount } = req.body;

    if (!offer_code || !show_id || total_amount === undefined) {
        return res.status(400).json({ error: "offer_code, show_id, and total_amount are required." });
    }

    try {
        const { offer, discountAmount } = await validateOfferCode({
            offer_code,
            show_id,
            total_amount: parseFloat(total_amount),
            customer_id,
        });

        return res.status(200).json({
            offer_id: offer.id,
            offer_code: offer.code,
            offer_title: offer.title,
            discount_amount: discountAmount,
            final_amount: +(parseFloat(total_amount) - discountAmount).toFixed(2),
        });
    } catch (error) {
        return res.status(error.status || 400).json({ error: error.message });
    }
};
