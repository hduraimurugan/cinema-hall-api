-- ============================================================
-- Phase 8: Personal API keys for admin users
-- Idempotent — all statements use IF NOT EXISTS
--
-- Lets an admin (owner, admin, or any staff role) mint a personal credential
-- for machine clients (e.g. the cinemax MCP server) to act on their behalf.
-- Follows the "store the hash, hand out the raw" pattern already used by
-- admin_sessions/admin_verification_tokens (see utils/hashToken.js) — the raw
-- key is shown to the user exactly once at creation and never persisted.
--
-- A key is deliberately NOT a JWT: it carries no embedded role/permissions,
-- so a role edit or hall reassignment takes effect on the very next request
-- (resolved fresh from organization_members/roles at request time) rather
-- than waiting for the key to be reissued.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_api_keys (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID        NOT NULL REFERENCES cinema_admin_user(id) ON DELETE CASCADE,
  org_id        UUID        REFERENCES organizations(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  token_hash    VARCHAR(64) NOT NULL UNIQUE,
  prefix        VARCHAR(20) NOT NULL,
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- token_hash's UNIQUE constraint above already indexes the hot lookup path.
CREATE INDEX IF NOT EXISTS idx_admin_api_keys_admin
  ON admin_api_keys(admin_id) WHERE revoked_at IS NULL;
