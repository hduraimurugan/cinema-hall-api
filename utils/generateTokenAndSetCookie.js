import jwt from 'jsonwebtoken'
import pool from '../db.js'
import { hashToken } from './hashToken.js'
import logger from './logger.js'

const isProduction = process.env.NODE_ENV === 'production'

/**
 * Issue access + refresh tokens for an admin, set HttpOnly cookies,
 * and persist the refresh token hash in admin_sessions for revocation support.
 * @param {import('express').Response} res
 * @param {object} admin  - { id, email, name, role }
 * @param {object} [meta] - { ip, userAgent } for session record
 * @returns {Promise<{ accessToken: string, refreshToken: string }>}
 */
export const generateTokenAndSetCookie = async (res, admin, meta = {}) => {
    let orgId = admin.orgId, roleKey = admin.roleKey, permissionsVersion = admin.permissionsVersion;
    if (!orgId) {
        try {
            const orgResult = await pool.query(
                `SELECT id FROM organizations WHERE owner_id = $1 AND is_active = TRUE LIMIT 1`,
                [admin.id]
            );
            if (orgResult.rows.length > 0) {
                orgId = orgResult.rows[0].id;
                const memResult = await pool.query(
                    `SELECT r.key as role_key, r.permissions_version
                     FROM organization_members om
                     JOIN roles r ON r.id = om.role_id
                     WHERE om.admin_id = $1 AND om.org_id = $2 AND om.status = 'active'
                     LIMIT 1`,
                    [admin.id, orgId]
                );
                if (memResult.rows.length > 0) {
                    roleKey = memResult.rows[0].role_key;
                    permissionsVersion = memResult.rows[0].permissions_version;
                }
            }
        } catch (err) {
            logger.error('Failed to resolve org for token:', { message: err.message });
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

    return { accessToken, refreshToken }
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