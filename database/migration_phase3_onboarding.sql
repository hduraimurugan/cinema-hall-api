-- ============================================================
-- Phase 3: Organization-Scoped Onboarding Schema Updates
-- ============================================================

-- 1. Ensure organizations exist for any admin user who owns a hall but has no organization.
-- (This ensures the backfill has organizations to map to.)
--
-- Narrower than the phase 1 backfill — it only covers admins who already own a
-- hall — but it still must exclude platform 'staff'. A staff member who happens
-- to be a hall's admin_id would otherwise be handed an organization of their
-- own, and owning one outranks their real membership at sign-in.
INSERT INTO organizations (name, slug, owner_id)
SELECT
  COALESCE(cau.name, cau.email) || '''s Cinema',
  LOWER(REPLACE(COALESCE(cau.name, cau.email), ' ', '-')) || '-' || LEFT(cau.id::text, 8),
  cau.id
FROM cinema_admin_user cau
WHERE cau.id IN (SELECT DISTINCT admin_id FROM cinema_hall)
  AND cau.role <> 'staff'
  AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.owner_id = cau.id)
ON CONFLICT (slug) DO NOTHING;

-- 2. Add org_id column to cinema_hall table (nullable initially)
ALTER TABLE cinema_hall ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- 3. Backfill org_id for existing cinema_hall rows.
-- Map each hall to the organization owned by its admin, or organization where its admin is a member,
-- or fallback to the first organization.
UPDATE cinema_hall ch
SET org_id = COALESCE(
  (SELECT id FROM organizations o WHERE o.owner_id = ch.admin_id LIMIT 1),
  (SELECT org_id FROM organization_members om WHERE om.admin_id = ch.admin_id LIMIT 1),
  (SELECT id FROM organizations LIMIT 1)
)
WHERE org_id IS NULL;

-- 4. Alter cinema_hall.org_id to be NOT NULL now that it is backfilled
ALTER TABLE cinema_hall ALTER COLUMN org_id SET NOT NULL;

-- 5. Drop the legacy settings table
DROP TABLE IF EXISTS settings;
