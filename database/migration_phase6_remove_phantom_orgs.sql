-- ============================================================
-- Phase 6: Remove phantom organizations
--
-- Rule enforced: only cinema_admin_user rows with platform role 'admin' or
-- 'superAdmin' own an organization. Staff exist purely as members of
-- someone else's org.
--
-- An older backfill in docs/db_setup.sql minted one org per admin row,
-- testing only "does this user already own an org" — so every staff member
-- invited into someone else's org also got a hall-less shell org with
-- themselves as Owner. Because that shell made them its 'owner', org
-- resolution ranked it above their real membership and they signed in as
-- Owner of an empty tenant with every permission.
--
-- RUN database/audit_org_ownership.sql FIRST and compare its section A with
-- the RETURNING output below. Idempotent: once clean, re-running deletes
-- nothing.
--
-- ⚠ cinema_hall.org_id is ON DELETE CASCADE. Deleting an org that has halls
--   destroys its screens, shows and bookings. That single fact is why every
--   guard below exists — they are inlined in the DELETE so they cannot be
--   bypassed by running only part of this file.
--
-- Full cascade on DELETE FROM organizations:
--   cinema_hall           → screens → shows → bookings
--   roles                 → role_permissions
--   organization_members  → hall_assignments
--   organization_settings
-- ============================================================

BEGIN;

DELETE FROM organizations o
USING cinema_admin_user cau
WHERE cau.id = o.owner_id

  -- the rule: staff never own an organization
  AND cau.role = 'staff'

  -- guard: never cascade into halls (and thence screens/shows/bookings)
  AND NOT EXISTS (
    SELECT 1 FROM cinema_hall ch WHERE ch.org_id = o.id
  )

  -- guard: never remove an org anyone else belongs to
  AND NOT EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.org_id = o.id AND om.admin_id <> o.owner_id
  )

  -- guard: never strand the owner with no organization at all — without
  -- another active membership they would fail login with
  -- "No organization found"
  AND EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.admin_id = cau.id
      AND om.org_id <> o.id
      AND om.status = 'active'
  )

RETURNING o.id, o.name;

-- Inspect the RETURNING output above before committing. To abandon the
-- change instead, run ROLLBACK.
COMMIT;

-- ── After committing, confirm no collateral damage ────────────
--   SELECT count(*) FROM cinema_hall;   -- unchanged
--   SELECT count(*) FROM bookings;      -- unchanged
--
-- and that every remaining member kept their real membership, e.g.
--   SELECT cau.email, o.name, r.key
--   FROM organization_members om
--   JOIN cinema_admin_user cau ON cau.id = om.admin_id
--   JOIN organizations o ON o.id = om.org_id
--   JOIN roles r ON r.id = om.role_id
--   WHERE cau.role = 'staff';
