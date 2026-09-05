import jwt from 'jsonwebtoken'
import pool from '../db.js'
import db from "../db.js";
import logger from '../utils/logger.js';
import { hashToken } from '../utils/hashToken.js';
import { resolveApiKey } from '../utils/apiKeyAuth.js';

const isProduction = process.env.NODE_ENV === 'production'

// Reads a Bearer token from the Authorization header, if present.
// Used as a fallback for clients (e.g. React Native) that cannot rely on
// httpOnly cookies the way the web app does.
const bearerFrom = req =>
  req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
    ? req.headers.authorization.split(' ')[1]
    : null

// A personal API key (e.g. minted for the cinemax MCP server) is checked
// first — it's the credential a machine client presents, and it never
// collides with a real JWT (different prefix, verified against a DB hash
// rather than jwt.verify). Falls through to normal cookie/Bearer JWT auth
// when no key header is present at all.
const apiKeyFrom = req => {
  const key = req.headers['x-api-key']
  return typeof key === 'string' && key.startsWith('cmk_') ? key : null
}

// ✅ Middleware to verify Access Token
export const verifyCinemaAdminAccessToken = async (req, res, next) => {
  const apiKey = apiKeyFrom(req)
  if (apiKey) {
    const admin = await resolveApiKey(apiKey)
    if (!admin) return res.status(401).json({ message: 'Invalid or expired API key' })
    req.admin = admin
    req.viaApiKey = true
    return next()
  }

  let token = req.cookies.accessToken
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1]
  }
  if (!token) {
    return res.status(401).json({ message: 'Access token missing' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.admin = decoded
    next()
  } catch (err) {
    logger.error('❌ Access Token Error:', { message: err.message })
    return res.status(403).json({ message: 'Invalid or expired access token' })
  }
}

// ✅ Middleware to verify Refresh Token (with session revocation check)
export const verifyCinemaAdminRefreshToken = async (req, res, next) => {
  const token = req.cookies.refreshToken
  if (!token) {
    return res.status(401).json({ message: 'Refresh token missing' })
  }

  try {
    const decoded = jwt.verify(token, process.env.REFRESH_SECRET)

    // Check that the session has not been revoked in the DB
    const tokenHash = hashToken(token)
    const sessionResult = await pool.query(
      `SELECT id, is_revoked FROM admin_sessions WHERE refresh_token_hash = $1`,
      [tokenHash]
    )

    if (sessionResult.rows.length === 0 || sessionResult.rows[0].is_revoked) {
      return res.status(401).json({ message: 'Session has been revoked. Please log in again.' })
    }

    // Update last_used_at
    pool.query(
      `UPDATE admin_sessions SET last_used_at = now() WHERE refresh_token_hash = $1`,
      [tokenHash]
    ).catch(() => {})

    req.admin = decoded
    next()
  } catch (err) {
    logger.error('❌ Refresh Token Error:', { message: err.message })
    return res.status(403).json({ message: 'Invalid or expired refresh token' })
  }
}

// ✅ Middleware to verify Super Admin Access
export const verifySuperAdmin = async (req, res, next) => {
  const apiKey = apiKeyFrom(req)
  if (apiKey) {
    const admin = await resolveApiKey(apiKey)
    if (!admin) return res.status(401).json({ message: 'Invalid or expired API key' })
    if (admin.role !== 'superAdmin') {
      return res.status(403).json({ message: 'Access denied: Super admin only' })
    }
    req.admin = admin
    req.viaApiKey = true
    return next()
  }

  let token = req.cookies.accessToken
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1]
  }
  if (!token) {
    return res.status(401).json({ message: 'Access token missing' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // Check if the user is a super admin
    if (decoded.role !== 'superAdmin') {
      return res.status(403).json({ message: 'Access denied: Super admin only' })
    }

    req.admin = decoded // attach the user payload
    next()
  } catch (err) {
    logger.error('❌ Super Admin Token Error:', { message: err.message })
    return res.status(403).json({ message: 'Invalid or expired access token' })
  }
}

// ✅ Verify Cinema Hall
export const verifyCinemaHall = async (req, res, next) => {
  let token = req.cookies.accessToken
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1]
  }

  if (!token) {
    return res.status(401).json({ message: 'Access token missing' })
  }

  try {
    // 1. Decode token
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.admin = decoded // you can access req.admin.id or email later

    // 2. Fetch cinema hall(s) for this admin
    const client = await pool.connect()
    try {
      const { rows } = await client.query(
        `SELECT ch.* FROM cinema_hall ch
         LEFT JOIN hall_assignments ha ON ha.hall_id = ch.id
         LEFT JOIN organization_members om ON om.id = ha.org_member_id
         WHERE ch.admin_id = $1 OR (om.admin_id = $1 AND om.status = 'active')
         ORDER BY ch.name`,
        [decoded.id]
      )

      // Deduplicate by id (LEFT JOIN can produce duplicates if a hall matches both conditions)
      const seen = new Set()
      const deduped = rows.filter(row => {
        if (seen.has(row.id)) return false
        seen.add(row.id)
        return true
      })

      if (deduped.length === 0) {
        return res.status(404).json({ message: 'Cinema hall not found for admin' })
      }

      // 3. If only one hall per admin, send as object. If multiple, send array.
      req.my_cinema_hall = deduped.length === 1 ? deduped[0] : deduped
    } finally {
      client.release()
    }

    next()
  } catch (err) {
    logger.error('❌ Access Token or DB Error:', { message: err.message })
    return res.status(403).json({ message: 'Invalid or expired access token' })
  }
}

// ✅ Verify Screen Ownership
export const verifyScreenOwnership = async (req, res, next) => {
  try {
    const screenIds = req.body.screen_ids || (req.body.screen_id ? [req.body.screen_id] : null);

    if (!screenIds || screenIds.length === 0) {
      return res.status(400).json({ message: "Screen ID(s) are required" });
    }

    // Prefer currentHallId (set by requireActiveHall) for strict hall isolation.
    // Falls back to my_cinema_hall for legacy routes that still use verifyCinemaHall.
    const allowedHallIds = req.currentHallId
      ? [req.currentHallId]
      : Array.isArray(req.my_cinema_hall)
        ? req.my_cinema_hall.map(hall => hall.id)
        : [req.my_cinema_hall?.id].filter(Boolean);

    // 🧠 Query all screen_id’s cinema_hall_id in one go
    const result = await db.query(
      `SELECT id, cinema_hall_id FROM screens WHERE id = ANY($1::uuid[])`,
      [screenIds]
    );

    const foundScreens = result.rows;

    if (foundScreens.length !== screenIds.length) {
      return res.status(404).json({ message: "Some screens were not found" });
    }

    const unauthorizedScreens = foundScreens.filter(
      (screen) => !allowedHallIds.includes(screen.cinema_hall_id)
    );

    if (unauthorizedScreens.length > 0) {
      return res.status(403).json({
        message: "You do not own one or more of the specified screens",
        unauthorized_screen_ids: unauthorizedScreens.map(s => s.id),
      });
    }

    // ✅ All checks passed
    next();
  } catch (err) {
    logger.error("verifyScreenOwnership error:", { message: err.message });
    res.status(500).json({ message: "Internal error verifying screen ownership" });
  }
};

// ✅ Middleware to verify Customer Access Token
export const verifyCustomer = async (req, res, next) => {
  const token = req.cookies.cusAccessToken || bearerFrom(req)
  // console.log("Customer Access Token:", req.cookies);

  if (!token) {
    return res.status(401).json({ message: 'Customer access token missing' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    req.customer = decoded // attach decoded payload → { id, email, name }
    next()
  } catch (err) {
    logger.error('❌ Customer Token Error:', { message: err.message })
    return res.status(403).json({ message: 'Invalid or expired customer access token' })
  }
}

// ✅ requireActiveOrg — organization-scoped data isolation
// Must be placed AFTER verifyCinemaAdminAccessToken so req.admin is populated.
// Reads the X-Org-Id header (falling back to the org baked into the JWT),
// verifies active membership, and sets req.orgId / req.orgRole.
export const requireActiveOrg = async (req, res, next) => {
  const requestedOrgId = req.headers['x-org-id'] || req.admin?.orgId;

  if (!requestedOrgId) {
    return res.status(400).json({ message: 'X-Org-Id header is required' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT om.org_id, r.key AS role_key
       FROM organization_members om
       JOIN roles r ON r.id = om.role_id
       JOIN organizations o ON o.id = om.org_id
       WHERE om.admin_id = $1 AND om.org_id = $2
         AND om.status = 'active' AND o.is_active = TRUE`,
      [req.admin.id, requestedOrgId]
    );

    if (rows.length === 0) {
      return res.status(403).json({ message: 'Organization not found or access denied' });
    }

    req.orgId = rows[0].org_id;
    req.orgRole = rows[0].role_key;
    next();
  } catch (err) {
    logger.error('❌ requireActiveOrg error:', { message: err.message });
    return res.status(500).json({ message: 'Internal error verifying organization access' });
  }
};

// ✅ requireActiveHall — hall-scoped data isolation
// Must be placed AFTER verifyCinemaAdminAccessToken so req.admin is populated.
// Reads X-Hall-Id, resolves the caller's membership in the hall's organization,
// and sets req.currentHallId (plus req.orgId / req.orgRole / req.hallScope).
//
// Access is granted when the caller is an active member of the hall's org AND
// either holds an org-wide role (owner/admin) or has an explicit hall
// assignment. Ownership via cinema_hall.admin_id is still honoured for halls
// created before organizations existed.
//
// Previously this only accepted admin_id ownership or an explicit assignment,
// so an org owner who had not personally created a hall got a 403 for a hall
// that GET /api/halls happily listed for them.
export const requireActiveHall = async (req, res, next) => {
  const hallId = req.headers['x-hall-id'];

  if (!hallId) {
    return res.status(400).json({ message: 'X-Hall-Id header is required' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT ch.id,
              ch.org_id,
              ch.admin_id = $2       AS is_creator,
              r.key                  AS role_key,
              ha.scope               AS assignment_scope
       FROM cinema_hall ch
       JOIN organization_members om
         ON om.org_id = ch.org_id AND om.admin_id = $2 AND om.status = 'active'
       JOIN roles r ON r.id = om.role_id
       LEFT JOIN hall_assignments ha
         ON ha.org_member_id = om.id AND ha.hall_id = ch.id
       WHERE ch.id = $1 AND ch.is_active = TRUE`,
      [hallId, req.admin.id]
    );

    if (rows.length === 0) {
      return res.status(403).json({ message: 'Hall not found or access denied' });
    }

    const hall = rows[0];
    const orgWideRole = hall.role_key === 'owner' || hall.role_key === 'admin';
    const allowed = orgWideRole || hall.is_creator || hall.assignment_scope !== null;

    if (!allowed) {
      return res.status(403).json({ message: 'Hall not found or access denied' });
    }

    req.currentHallId = hallId;
    req.orgId = hall.org_id;
    req.orgRole = hall.role_key;
    // Org-wide roles and the hall's creator always get full scope; otherwise
    // the explicit assignment decides. requirePermission enforces read_only.
    req.hallScope = (orgWideRole || hall.is_creator) ? 'full' : hall.assignment_scope;
    next();
  } catch (err) {
    logger.error('❌ requireActiveHall error:', { message: err.message });
    return res.status(500).json({ message: 'Internal error verifying hall access' });
  }
};

// ✅ Middleware to verify Customer Refresh Token
export const verifyCustomerRefreshToken = async (req, res, next) => {
  const token = req.cookies.cusRefreshToken || req.body?.refreshToken || bearerFrom(req)
  if (!token) {
    return res.status(401).json({ message: 'Customer refresh token missing' })
  }

  try {
    const decoded = jwt.verify(token, process.env.REFRESH_SECRET)

    // Check that the session has not been revoked in the DB
    const tokenHash = hashToken(token)
    const sessionResult = await pool.query(
      `SELECT id, is_revoked FROM customer_sessions WHERE refresh_token_hash = $1`,
      [tokenHash]
    )

    if (sessionResult.rows.length === 0 || sessionResult.rows[0].is_revoked) {
      return res.status(401).json({ message: 'Session has been revoked. Please log in again.' })
    }

    // Update last_used_at (fire-and-forget)
    pool.query(
      `UPDATE customer_sessions SET last_used_at = now() WHERE refresh_token_hash = $1`,
      [tokenHash]
    ).catch(() => {})

    req.customer = decoded
    req.customerRefreshTokenHash = tokenHash // for logout revocation
    next()
  } catch (err) {
    logger.error('❌ Customer Refresh Token Error:', { message: err.message })
    return res.status(403).json({ message: 'Invalid or expired customer refresh token' })
  }
}
