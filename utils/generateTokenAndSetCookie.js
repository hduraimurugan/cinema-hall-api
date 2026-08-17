import jwt from 'jsonwebtoken'
import pool from '../db.js'
import { hashToken } from './hashToken.js'
import logger from './logger.js'

const isProduction = process.env.NODE_ENV === 'production'

/**
 * Resolve an admin's current org context straight from the database.
 *
 * Resolved through membership, not organizations.owner_id — staff and other
 * non-owner members belong to an org too and need it in their token.
 *
 * Always re-read rather than carried over from a previous token: roleKey and
 * permissionsVersion change when an owner edits a role, and a token that
 * copies its own stale permissionsVersion forward can never clear the
 * TOKEN_STALE check that prompted the refresh.
 *
 * Ordering: an org that actually has halls outranks an empty one. A member can
 * end up owning a hall-less shell org (older backfills minted one per admin),
 * and with ownership as the first key that shell would hijack their session —
 * signing them in as Owner of an empty tenant instead of into the org they
 * really work in. Ownership still decides between two real orgs.
 *
 * This is the single resolver for login, token refresh and /me, so all three
 * agree on which organization the caller is acting in.
 *
 * @returns {Promise<{ orgId: string|null, roleKey: string|null, permissionsVersion: number|null }>}
 */
export const resolveOrgContext = async (adminId) => {
    try {
        const { rows } = await pool.query(
            `SELECT om.org_id, r.key AS role_key, r.permissions_version
             FROM organization_members om
             JOIN roles r ON r.id = om.role_id
             JOIN organizations o ON o.id = om.org_id
             WHERE om.admin_id = $1 AND om.status = 'active' AND o.is_active = TRUE
             ORDER BY EXISTS (SELECT 1 FROM cinema_hall ch WHERE ch.org_id = o.id) DESC,
                      (o.owner_id = $1) DESC,
                      om.created_at ASC
             LIMIT 1`,
            [adminId]
        );
        if (rows.length === 0) return { orgId: null, roleKey: null, permissionsVersion: null };
        return {
            orgId: rows[0].org_id,
            roleKey: rows[0].role_key,
            permissionsVersion: rows[0].permissions_version,
        };
    } catch (err) {
        logger.error('Failed to resolve org context:', { message: err.message });
        return { orgId: null, roleKey: null, permissionsVersion: null };
    }
}

/**
 * Issue access + refresh tokens for an admin, set HttpOnly cookies,
 * and persist the refresh token hash in admin_sessions for revocation support.
 *
 * The resolved organization context is RETURNED as well as embedded in the
 * token — callers need it to build their login response. (It used to be
 * resolved into a local only, so every caller reporting orgId/roleKey read
 * undefined.)
 *
 * @param {import('express').Response} res
 * @param {object} admin  - { id, email, name, role }
 * @param {object} [meta] - { ip, userAgent } for session record
 * @returns {Promise<{ accessToken: string, refreshToken: string, orgId: string|null, roleKey: string|null, permissionsVersion: number|null }>}
 */
export const generateTokenAndSetCookie = async (res, admin, meta = {}) => {
    let orgId = admin.orgId ?? null,
        roleKey = admin.roleKey ?? null,
        permissionsVersion = admin.permissionsVersion ?? null;

    if (!orgId) {
        const ctx = await resolveOrgContext(admin.id);
        if (ctx.orgId) {
            orgId = ctx.orgId;
            roleKey = ctx.roleKey;
            permissionsVersion = ctx.permissionsVersion;
        }
    }

    const payload = {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        orgId,
        roleKey,
        permissionsVersion,
    }

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: '1d',
    })

    const refreshToken = jwt.sign(payload, process.env.REFRESH_SECRET, {
        expiresIn: '30d',
    })

    // Store hashed refresh token in admin_sessions for server-side revocation
    try {
        const tokenHash = hashToken(refreshToken)
        await pool.query(
            `INSERT INTO admin_sessions (admin_id, refresh_token_hash, ip_address, user_agent)
             VALUES ($1, $2, $3, $4)`,
            [admin.id, tokenHash, meta.ip || null, meta.userAgent || null]
        )
    } catch (err) {
        logger.error('❌ Failed to store admin session:', { message: err.message })
    }

    res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 1 * 24 * 60 * 60 * 1000, // 1 day
    })

    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    })

    return { accessToken, refreshToken, orgId, roleKey, permissionsVersion }
}

export const generateCustomerTokenAndSetCookie = async (res, customer, meta = {}) => {
    const payload = {
        id: customer.id,
        email: customer.email,
        name: customer.name,
    }

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: "1d",
    })

    const refreshToken = jwt.sign(payload, process.env.REFRESH_SECRET, {
        expiresIn: "30d",
    })

    // Store hashed refresh token in customer_sessions for server-side revocation
    try {
        const tokenHash = hashToken(refreshToken)
        await pool.query(
            `INSERT INTO customer_sessions (customer_id, refresh_token_hash, ip_address, user_agent)
             VALUES ($1, $2, $3, $4)`,
            [customer.id, tokenHash, meta.ip || null, meta.userAgent || null]
        )
    } catch (err) {
        logger.error('❌ Failed to store customer session:', { message: err.message })
    }

    res.cookie("cusAccessToken", accessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 1 * 24 * 60 * 60 * 1000, // 1 day
    })

    res.cookie("cusRefreshToken", refreshToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    })

    return { accessToken, refreshToken }
}