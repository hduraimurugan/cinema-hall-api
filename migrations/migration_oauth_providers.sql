-- =============================================================================
-- OAuth Providers Migration
-- Adds OAuth support columns to cinema_admin_user and customers tables.
-- Idempotent: uses ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ADMIN TABLE — OAuth columns
-- ---------------------------------------------------------------------------

-- Auth providers array (e.g. ARRAY['local', 'google', 'github'])
ALTER TABLE cinema_admin_user ADD COLUMN IF NOT EXISTS auth_providers TEXT[] NOT NULL DEFAULT ARRAY['local'];

-- Provider external IDs as JSON (e.g. {"google": "123...", "github": "456..."})
ALTER TABLE cinema_admin_user ADD COLUMN IF NOT EXISTS provider_ids JSONB NOT NULL DEFAULT '{}';

-- Avatar URL from OAuth provider
ALTER TABLE cinema_admin_user ADD COLUMN IF NOT EXISTS avatar TEXT;

-- Make password nullable for OAuth-only accounts
ALTER TABLE cinema_admin_user ALTER COLUMN password DROP NOT NULL;

-- Backfill existing rows: ensure all have 'local' in auth_providers
UPDATE cinema_admin_user
  SET auth_providers = ARRAY['local']
  WHERE auth_providers = ARRAY[]::TEXT[] OR auth_providers IS NULL;

-- Partial unique indexes: prevent same OAuth ID linking to multiple accounts
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_google_provider_id
  ON cinema_admin_user ((provider_ids->>'google'))
  WHERE provider_ids->>'google' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_github_provider_id
  ON cinema_admin_user ((provider_ids->>'github'))
  WHERE provider_ids->>'github' IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 2. CUSTOMERS TABLE — OAuth columns
-- ---------------------------------------------------------------------------

-- Auth providers array
ALTER TABLE customers ADD COLUMN IF NOT EXISTS auth_providers TEXT[] NOT NULL DEFAULT ARRAY['local'];

-- Provider external IDs
ALTER TABLE customers ADD COLUMN IF NOT EXISTS provider_ids JSONB NOT NULL DEFAULT '{}';

-- Avatar URL
ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar TEXT;

-- Make password nullable for OAuth-only accounts
ALTER TABLE customers ALTER COLUMN password DROP NOT NULL;

-- Make name nullable for OAuth accounts that might not have a name initially
ALTER TABLE customers ALTER COLUMN name DROP NOT NULL;

-- Backfill existing rows
UPDATE customers
  SET auth_providers = ARRAY['local']
  WHERE auth_providers = ARRAY[]::TEXT[] OR auth_providers IS NULL;

-- Partial unique index for Google provider ID
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_google_provider_id
  ON customers ((provider_ids->>'google'))
  WHERE provider_ids->>'google' IS NOT NULL;
