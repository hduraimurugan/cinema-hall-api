-- ============================================================
-- Migration: Customer Auth Security Improvements
-- Adds: account lockout columns, OTP type column, customer_sessions table
-- Run once against your PostgreSQL database.
-- ============================================================

-- 1. Security columns on customers
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS failed_login_attempts INT    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS account_locked_until  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_changed_at   TIMESTAMPTZ;

-- 2. Add type to otp_verifications so signup & password_reset can coexist per email
ALTER TABLE otp_verifications
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'signup';

-- Drop old unique(email) constraint so we can upsert per (email, type)
ALTER TABLE otp_verifications
  DROP CONSTRAINT IF EXISTS otp_verifications_email_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'otp_verifications_email_type_key'
  ) THEN
    ALTER TABLE otp_verifications
      ADD CONSTRAINT otp_verifications_email_type_key UNIQUE (email, type);
  END IF;
END$$;

-- Track per-OTP wrong-guess attempts to prevent brute force
ALTER TABLE otp_verifications
  ADD COLUMN IF NOT EXISTS otp_attempts INT NOT NULL DEFAULT 0;

-- 3. Customer sessions table for server-side refresh token revocation
CREATE TABLE IF NOT EXISTS customer_sessions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  refresh_token_hash TEXT        NOT NULL UNIQUE,
  ip_address         TEXT,
  user_agent         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_revoked         BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer_id ON customer_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_token_hash  ON customer_sessions(refresh_token_hash);
