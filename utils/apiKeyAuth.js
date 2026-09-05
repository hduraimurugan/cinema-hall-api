import crypto from 'crypto'
import pool from '../db.js'
import logger from './logger.js'
import { hashToken } from './hashToken.js'
import { resolveOrgContext } from './generateTokenAndSetCookie.js'

const KEY_PREFIX = 'cmk_'

/**
 * Generate a new raw API key plus its storage hash and display prefix.
 * The raw value is returned to the caller exactly once — only the hash is
 * ever persisted, mirroring admin_sessions/admin_verification_tokens.
 */
export function generateApiKey() {
  const raw = KEY_PREFIX + crypto.randomBytes(24).toString('base64url')
  return {
    raw,
    hash: hashToken(raw),
    prefix: raw.slice(0, 12),
  }
}

/**
 * Resolve a raw API key into the same shape verifyCinemaAdminAccessToken
 * produces from a JWT — { id, email, name, role, orgId, roleKey,
 * permissionsVersion } — so every existing route, requirePermission and
 * requireActiveHall check works completely unchanged.
 *
 * Unlike a JWT, org context is re-read fresh on every call (not embedded),
 * so a role edit or org change takes effect on the very next request instead
 * of waiting for TOKEN_STALE / reissue. Returns null for an unknown, expired,
 * or revoked key.
 */
export async function resolveApiKey(rawKey) {
  const tokenHash = hashToken(rawKey)

  const { rows } = await pool.query(
    `SELECT k.id AS key_id, a.id, a.email, a.name, a.role
     FROM admin_api_keys k
     JOIN cinema_admin_user a ON a.id = k.admin_id
     WHERE k.token_hash = $1
       AND k.revoked_at IS NULL
       AND (k.expires_at IS NULL OR k.expires_at > NOW())`,
    [tokenHash]
  )
  if (rows.length === 0) return null

  const row = rows[0]
  const { orgId, roleKey } = await resolveOrgContext(row.id)

  // Fire-and-forget — never let a logging failure block the request.
  pool.query(`UPDATE admin_api_keys SET last_used_at = now() WHERE id = $1`, [row.key_id])
    .catch(err => logger.error('Failed to bump admin_api_keys.last_used_at:', { message: err.message }))

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    orgId,
    roleKey,
    // Deliberately omitted: permissionsVersion. requirePermission's staleness
    // check no-ops when it's undefined/null, and permissions are re-read from
    // the DB on every request anyway — an API key has nothing to go stale.
  }
}
