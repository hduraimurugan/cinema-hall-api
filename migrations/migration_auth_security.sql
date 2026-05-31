-- ============================================================
-- Auth Security Migration
-- Adds email verification, brute-force lockout, session
-- tracking and audit logging to the admin auth system.
-- ============================================================

-- ── 1. Extend cinema_admin_user ──────────────────────────────
ALTER TABLE cinema_admin_user
  ADD COLUMN IF NOT EXISTS email_verified       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_login_attempts INT        NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS account_locked_until  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_changed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at         TIMESTAMPTZ;

-- ── 2. Email verification tokens ────────────────────────────
-- Raw token is sent in email; only the SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS admin_verification_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID        NOT NULL REFERENCES cinema_admin_user(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_verification_tokens_admin_id
  ON admin_verification_tokens(admin_id);

-- ── 3. Password reset tokens ─────────────────────────────────
-- Single-use; marked used=TRUE after redemption.
CREATE TABLE IF NOT EXISTS admin_password_reset_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID        NOT NULL REFERENCES cinema_admin_user(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_password_reset_tokens_admin_id
  ON admin_password_reset_tokens(admin_id);

-- ── 4. Admin sessions (server-side refresh token store) ──────
-- Enables logout-all-devices and token revocation.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id          UUID        NOT NULL REFERENCES cinema_admin_user(id) ON DELETE CASCADE,
  refresh_token_hash TEXT       NOT NULL UNIQUE,
  ip_address        TEXT,
  user_agent        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_revoked        BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id
  ON admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash
  ON admin_sessions(refresh_token_hash) WHERE is_revoked = FALSE;

-- ── 5. Security audit log ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_security_logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID        REFERENCES cinema_admin_user(id) ON DELETE SET NULL,
  action     TEXT        NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_security_logs_admin_id
  ON admin_security_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_security_logs_created_at
  ON admin_security_logs(created_at DESC);
