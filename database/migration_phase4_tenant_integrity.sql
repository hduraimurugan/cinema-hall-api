-- ============================================================
-- Phase 4: Tenant Integrity
--
-- Makes multi-tenancy a database invariant instead of a convention.
-- Until now nothing stopped a role or a hall from one organization
-- being attached to a member of another, and deleting a single admin
-- user cascaded away that org's halls -> screens -> shows -> bookings.
--
-- Idempotent — safe to re-run. Wrapped in a single transaction so a
-- failure leaves the schema untouched.
--
-- Usage:
--   psql -U postgres -d cinema_hall_db -f migration_phase4_tenant_integrity.sql
-- ============================================================


-- ------------------------------------------------------------
-- 0. PRE-FLIGHT AUDIT (read-only)
--
-- The constraints below refuse to be created while violating rows
-- exist. Run these FIRST and remediate anything they return.
-- ------------------------------------------------------------

-- 0.a Members holding a role that belongs to a different organization.
--     Blocks step 2. Remediate by reassigning them to the same-org role
--     with the matching key, or to that org's 'auditor' role.
--
-- SELECT om.id AS member_id, om.org_id AS member_org, r.org_id AS role_org, r.key
--   FROM organization_members om
--   JOIN roles r ON r.id = om.role_id
--  WHERE r.org_id <> om.org_id;

-- 0.b Hall assignments spanning two organizations. Blocks step 3.
--     Remediate by deleting the offending assignment rows.
--
-- SELECT ha.id, om.org_id AS member_org, ch.org_id AS hall_org
--   FROM hall_assignments ha
--   JOIN organization_members om ON om.id = ha.org_member_id
--   JOIN cinema_hall ch         ON ch.id = ha.hall_id
--  WHERE om.org_id <> ch.org_id;

-- 0.c Halls with no organization. Blocks step 3's backfill.
--     Phase 3 should have eliminated these — verify.
--
-- SELECT id, name, admin_id FROM cinema_hall WHERE org_id IS NULL;

-- 0.d Duplicate (org_id, admin_id) pairs that would collide under the
--     new partial unique index in step 5.
--
-- SELECT org_id, admin_id, COUNT(*)
--   FROM organization_members
--  WHERE status <> 'removed'
--  GROUP BY org_id, admin_id
-- HAVING COUNT(*) > 1;

-- 0.e Owners holding more than one active organization. Not fatal, but
--     resolveOrgId() assumes exactly one and will pick arbitrarily.
--
-- SELECT owner_id, COUNT(*)
--   FROM organizations
--  WHERE is_active = TRUE AND owner_id IS NOT NULL
--  GROUP BY owner_id
-- HAVING COUNT(*) > 1;


BEGIN;

-- ------------------------------------------------------------
-- 1. Composite-key anchors
--
-- A plain FK to roles(id) cannot express "and it must belong to my
-- org". These UNIQUE (id, org_id) constraints give the composite FKs
-- in steps 2 and 3 something to point at. They are redundant with the
-- primary keys by design — that is what makes the correlation possible.
-- ------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_id_org_key') THEN
    ALTER TABLE roles ADD CONSTRAINT roles_id_org_key UNIQUE (id, org_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cinema_hall_id_org_key') THEN
    ALTER TABLE cinema_hall ADD CONSTRAINT cinema_hall_id_org_key UNIQUE (id, org_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_members_id_org_key') THEN
    ALTER TABLE organization_members ADD CONSTRAINT organization_members_id_org_key UNIQUE (id, org_id);
  END IF;
END $$;


-- ------------------------------------------------------------
-- 2. A member's role must belong to the member's own organization
--
-- Replaces organization_members.role_id -> roles(id) with a composite
-- FK. ON DELETE RESTRICT preserves the existing behaviour (roles with
-- members cannot be deleted — see roles.Controller.js deleteRole).
-- ------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'organization_members_role_id_fkey'
       AND conrelid = 'organization_members'::regclass
  ) THEN
    ALTER TABLE organization_members DROP CONSTRAINT organization_members_role_id_fkey;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_members_role_same_org_fkey') THEN
    ALTER TABLE organization_members
      ADD CONSTRAINT organization_members_role_same_org_fkey
      FOREIGN KEY (role_id, org_id) REFERENCES roles(id, org_id) ON DELETE RESTRICT;
  END IF;
END $$;


-- ------------------------------------------------------------
-- 3. A hall assignment must join a member and a hall from the SAME org
--
-- hall_assignments had no org column at all, so the member's org and
-- the hall's org could differ freely. Adding org_id lets both sides be
-- correlated through composite FKs.
-- ------------------------------------------------------------

ALTER TABLE hall_assignments ADD COLUMN IF NOT EXISTS org_id UUID;

-- Backfill from the owning member (authoritative — the member row is
-- what the assignment was created against).
UPDATE hall_assignments ha
   SET org_id = om.org_id
  FROM organization_members om
 WHERE om.id = ha.org_member_id
   AND ha.org_id IS NULL;

-- Drop any assignment that still has no org (orphaned member row).
DELETE FROM hall_assignments WHERE org_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'hall_assignments' AND column_name = 'org_id' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE hall_assignments ALTER COLUMN org_id SET NOT NULL;
  END IF;

  -- Replace the plain member FK with the org-correlated one.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'hall_assignments_org_member_id_fkey'
       AND conrelid = 'hall_assignments'::regclass
  ) THEN
    ALTER TABLE hall_assignments DROP CONSTRAINT hall_assignments_org_member_id_fkey;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hall_assignments_member_same_org_fkey') THEN
    ALTER TABLE hall_assignments
      ADD CONSTRAINT hall_assignments_member_same_org_fkey
      FOREIGN KEY (org_member_id, org_id)
      REFERENCES organization_members(id, org_id) ON DELETE CASCADE;
  END IF;

  -- Replace the plain hall FK with the org-correlated one.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'hall_assignments_hall_id_fkey'
       AND conrelid = 'hall_assignments'::regclass
  ) THEN
    ALTER TABLE hall_assignments DROP CONSTRAINT hall_assignments_hall_id_fkey;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hall_assignments_hall_same_org_fkey') THEN
    ALTER TABLE hall_assignments
      ADD CONSTRAINT hall_assignments_hall_same_org_fkey
      FOREIGN KEY (hall_id, org_id)
      REFERENCES cinema_hall(id, org_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hall_assignments_org ON hall_assignments(org_id);


-- ------------------------------------------------------------
-- 4. Deleting an admin user must not destroy the org's data
--
-- cinema_hall.admin_id was ON DELETE CASCADE, so removing one admin
-- cascaded halls -> screens -> shows -> bookings. The organization owns
-- the hall (org_id, NOT NULL since phase 3); admin_id is now only a
-- record of who created it.
--
-- The column keeps its name for now; renaming it to created_by is a
-- separate change that touches middleware, controllers and tests.
-- ------------------------------------------------------------

ALTER TABLE cinema_hall ALTER COLUMN admin_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cinema_hall_admin_id_fkey'
       AND conrelid = 'cinema_hall'::regclass
  ) THEN
    ALTER TABLE cinema_hall DROP CONSTRAINT cinema_hall_admin_id_fkey;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cinema_hall_admin_id_fkey') THEN
    ALTER TABLE cinema_hall
      ADD CONSTRAINT cinema_hall_admin_id_fkey
      FOREIGN KEY (admin_id) REFERENCES cinema_admin_user(id) ON DELETE SET NULL;
  END IF;
END $$;


-- ------------------------------------------------------------
-- 5. Removed members must be re-invitable
--
-- UNIQUE (org_id, admin_id) was unconditional, so a member set to
-- 'removed' permanently occupied the slot and re-inviting them threw
-- 23505 (surfacing as a 500 from inviteMember). A partial unique index
-- keeps one live membership per org while allowing removed history.
-- ------------------------------------------------------------

ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

-- Backfill removed_at for rows already in the removed state.
UPDATE organization_members
   SET removed_at = COALESCE(removed_at, joined_at, created_at, now())
 WHERE status = 'removed' AND removed_at IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'organization_members_org_id_admin_id_key'
       AND conrelid = 'organization_members'::regclass
  ) THEN
    ALTER TABLE organization_members DROP CONSTRAINT organization_members_org_id_admin_id_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_org_member
  ON organization_members(org_id, admin_id)
  WHERE status <> 'removed';


-- ------------------------------------------------------------
-- 6. Organizations: protect the owner link, maintain updated_at
--
-- owner_id was ON DELETE SET NULL, which silently produced ownerless
-- organizations. RESTRICT forces ownership to be transferred before an
-- owner can be deleted.
--
-- owner_id stays NULLABLE — test fixtures create organizations without
-- an owner (tests/setup/factories.js createSetting).
-- ------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'organizations_owner_id_fkey'
       AND conrelid = 'organizations'::regclass
  ) THEN
    ALTER TABLE organizations DROP CONSTRAINT organizations_owner_id_fkey;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_owner_id_fkey') THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_owner_id_fkey
      FOREIGN KEY (owner_id) REFERENCES cinema_admin_user(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- organizations.updated_at existed but nothing ever set it. Reuse the
-- shared trigger function already defined for customers.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_organizations_updated_at ON organizations;
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ------------------------------------------------------------
-- 7. Guarantee the "owner is a member" invariant
--
-- resolveOrgId now resolves an admin's organization through
-- organization_members alone (it used to also check organizations.owner_id,
-- which meant two competing sources of truth). Any organization whose owner
-- lacks a membership row would leave that owner unable to reach their own
-- org, so backfill them here.
-- ------------------------------------------------------------

INSERT INTO organization_members (org_id, admin_id, role_id, status, joined_at)
SELECT o.id, o.owner_id, r.id, 'active', now()
FROM organizations o
JOIN roles r ON r.org_id = o.id AND r.key = 'owner'
WHERE o.owner_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM organization_members om
     WHERE om.org_id = o.id AND om.admin_id = o.owner_id AND om.status <> 'removed'
  );

COMMIT;


-- ------------------------------------------------------------
-- 7. POST-MIGRATION ASSERTIONS
--
-- Every one of these must return zero rows. Run them after COMMIT.
-- ------------------------------------------------------------

-- 7.a No cross-org role assignments remain (now structurally impossible).
-- SELECT om.id FROM organization_members om
--   JOIN roles r ON r.id = om.role_id
--  WHERE r.org_id <> om.org_id;

-- 7.b No cross-org hall assignments remain.
-- SELECT ha.id FROM hall_assignments ha
--   JOIN organization_members om ON om.id = ha.org_member_id
--   JOIN cinema_hall ch         ON ch.id = ha.hall_id
--  WHERE om.org_id <> ch.org_id OR ha.org_id <> om.org_id;

-- 7.c Every hall assignment carries an org.
-- SELECT id FROM hall_assignments WHERE org_id IS NULL;

-- 7.d cinema_hall.admin_id no longer cascades. Expect 'a' (SET NULL).
-- SELECT confdeltype FROM pg_constraint WHERE conname = 'cinema_hall_admin_id_fkey';

-- 7.e The partial unique index exists.
-- SELECT indexname FROM pg_indexes WHERE indexname = 'uniq_active_org_member';
