-- Phase 1: Settings Module Foundation
-- Tables: organizations, organization_settings, hall_settings, user_settings
-- Data migration: move legacy settings + auto-create orgs for existing admins
--
-- Run this file directly. All statements use IF NOT EXISTS / WHERE NOT EXISTS
-- so the migration is idempotent and safe to re-run after partial failures.


-- ── organizations ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  slug              TEXT UNIQUE NOT NULL,
  owner_id          UUID REFERENCES cinema_admin_user(id) ON DELETE SET NULL,
  default_timezone  TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  default_currency  TEXT NOT NULL DEFAULT 'INR',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  plan              TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','enterprise')),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ── Auto-create an org for every admin who belongs to NO organization ──
--
-- Only for admins with no organization at all. Testing ownership alone minted a
-- hall-less shell org for every staff member who had been invited into someone
-- else's org, and because that shell made them its 'owner' it then outranked
-- their real membership at sign-in — they landed in an empty tenant with full
-- owner permissions. Platform 'staff' never get an org of their own; they exist
-- only as members of one.
--
-- Audit any database with database/audit_org_ownership.sql; clean up with
-- database/migration_phase6_remove_phantom_orgs.sql.
-- organization_members does not exist yet on a fresh in-order run (phase 2
-- creates it), so the membership guard is applied through dynamic SQL only
-- when the table is present — i.e. when this file is re-run against an
-- already-migrated database, which is the case that actually needs it.
DO $$
BEGIN
  IF to_regclass('public.organization_members') IS NULL THEN
    EXECUTE $q$
      INSERT INTO organizations (name, slug, owner_id)
      SELECT
        COALESCE(cau.name, cau.email) || '''s Cinema',
        LOWER(REPLACE(COALESCE(cau.name, cau.email), ' ', '-')) || '-' || LEFT(cau.id::text, 8),
        cau.id
      FROM cinema_admin_user cau
      WHERE cau.role <> 'staff'
        AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.owner_id = cau.id)
    $q$;
  ELSE
    EXECUTE $q$
      INSERT INTO organizations (name, slug, owner_id)
      SELECT
        COALESCE(cau.name, cau.email) || '''s Cinema',
        LOWER(REPLACE(COALESCE(cau.name, cau.email), ' ', '-')) || '-' || LEFT(cau.id::text, 8),
        cau.id
      FROM cinema_admin_user cau
      WHERE cau.role <> 'staff'
        AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.owner_id = cau.id)
        AND NOT EXISTS (
          SELECT 1 FROM organization_members om
          WHERE om.admin_id = cau.id
            AND om.status IN ('active', 'invited', 'suspended')
        )
    $q$;
  END IF;
END $$;

-- ── organization_settings ────────────────────────────────────────
-- One row per org per section.  JSONB typed per section (zod on write).
CREATE TABLE IF NOT EXISTS organization_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  section         TEXT NOT NULL,              -- 'general','payment','tickets','security','notifications','branding','integrations','advanced'
  value           JSONB NOT NULL DEFAULT '{}',
  schema_version  INT NOT NULL DEFAULT 1,
  updated_by      UUID REFERENCES cinema_admin_user(id),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, section)
);
CREATE INDEX IF NOT EXISTS idx_org_settings_org_section ON organization_settings(org_id, section);

-- ── hall_settings (per-branch) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS hall_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hall_id         UUID NOT NULL REFERENCES cinema_hall(id) ON DELETE CASCADE,
  section         TEXT NOT NULL,              -- 'cinema_profile','showtimes','booking','offers'
  value           JSONB NOT NULL DEFAULT '{}',
  schema_version  INT NOT NULL DEFAULT 1,
  updated_by      UUID REFERENCES cinema_admin_user(id),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (hall_id, section)
);
CREATE INDEX IF NOT EXISTS idx_hall_settings_hall_section ON hall_settings(hall_id, section);

-- ── user_settings (per-admin preferences) ────────────────────────
CREATE TABLE IF NOT EXISTS user_settings (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id  UUID NOT NULL REFERENCES cinema_admin_user(id) ON DELETE CASCADE,
  section   TEXT NOT NULL,                    -- 'notifications','analytics','appearance'
  value     JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (admin_id, section)
);
CREATE INDEX IF NOT EXISTS idx_user_settings_admin ON user_settings(admin_id);

-- ── Migrate legacy settings keys into organization_settings ──────
-- Copy convenience_fee_per_ticket and gst_percentage into the 'payment' section
-- for every organization that does not yet have a payment section row.
INSERT INTO organization_settings (org_id, section, value, updated_at)
SELECT o.id, 'payment',
  jsonb_build_object(
    'convenience_fee', jsonb_build_object('model', 'per_ticket', 'amount', COALESCE((SELECT value::numeric FROM settings WHERE key='convenience_fee_per_ticket'), 15)),
    'gst_percentage', COALESCE((SELECT value::numeric FROM settings WHERE key='gst_percentage'), 18),
    'gst_applies_to', 'convenience_fee',
    'state_taxes', '[]'::jsonb
  ),
  now()
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM organization_settings os WHERE os.org_id = o.id AND os.section = 'payment'
);

-- ── Seed default org-level sections for every org (if missing) ───
INSERT INTO organization_settings (org_id, section, value)
SELECT o.id, 'general', '{"org_name":"","timezone":"Asia/Kolkata","currency":"INR","language":"en"}'::jsonb
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM organization_settings os WHERE os.org_id = o.id AND os.section = 'general');

INSERT INTO organization_settings (org_id, section, value)
SELECT o.id, 'tickets', '{"booking_id_prefix":"CINE","qr_error_correction":"M","pdf_footer_text":""}'::jsonb
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM organization_settings os WHERE os.org_id = o.id AND os.section = 'tickets');

INSERT INTO organization_settings (org_id, section, value)
SELECT o.id, 'security', '{"password_policy":{"min_length":8,"require_upper":true,"require_lower":true,"require_digit":true,"require_special":true,"prevent_reuse_count":5,"expiry_days":null},"lockout_policy":{"thresholds":[{"attempts":5,"minutes":15},{"attempts":10,"minutes":60},{"attempts":15,"minutes":1440}]},"session_timeout_minutes":null,"mfa_required":false,"invite_expiry_hours":72}'::jsonb
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM organization_settings os WHERE os.org_id = o.id AND os.section = 'security');

INSERT INTO organization_settings (org_id, section, value)
SELECT o.id, 'notifications', '{"email":{"provider":"smtp","from":"","enabled":true},"sms":{"provider":"","from":"","enabled":false},"whatsapp":{"provider":"","enabled":false},"push":{"provider":"fcm","enabled":false}}'::jsonb
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM organization_settings os WHERE os.org_id = o.id AND os.section = 'notifications');

INSERT INTO organization_settings (org_id, section, value)
SELECT o.id, 'branding', '{"logo_url":"","logo_dark_url":"","banner_url":"","primary_color":"","accent_color":"","font_family":"","app_name":"Cinemax","default_theme":"dark","white_label":false}'::jsonb
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM organization_settings os WHERE os.org_id = o.id AND os.section = 'branding');
