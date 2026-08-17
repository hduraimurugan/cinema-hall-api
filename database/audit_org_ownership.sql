-- ============================================================
-- Organization ownership audit — READ ONLY, safe to run anywhere
--
-- Run this BEFORE migration_phase6_remove_phantom_orgs.sql and compare
-- section A against that script's RETURNING output.
--
-- The invariant being checked: only cinema_admin_user rows with platform
-- role 'admin' or 'superAdmin' own an organization. Staff exist purely as
-- members of someone else's org.
--
-- An older backfill in docs/db_setup.sql minted one org per admin row —
-- its only test was "does this user already own an org" — so every staff
-- member invited into someone else's org also got a hall-less shell org
-- with themselves as Owner.
-- ============================================================


-- ── A. DELETION CANDIDATES ────────────────────────────────────
-- Orgs owned by a platform 'staff' user.
--
-- The cleanup script SKIPS any row here showing halls > 0, other_members > 0,
-- or other_memberships = 0. Those need a decision by hand:
--   halls > 0             → real data lives here; deleting cascades into
--                           screens, shows and bookings
--   other_members > 0     → other people belong to this org
--   other_memberships = 0 → deleting would leave the owner with no org at
--                           all, and they would fail login with
--                           "No organization found"
SELECT
  o.id,
  o.name                                   AS org,
  cau.email                                AS owner,
  cau.role                                 AS platform_role,
  (SELECT count(*) FROM cinema_hall ch
     WHERE ch.org_id = o.id)::int          AS halls,
  (SELECT count(*) FROM organization_members om
     WHERE om.org_id = o.id
       AND om.admin_id <> o.owner_id)::int AS other_members,
  (SELECT count(*) FROM organization_members om
     WHERE om.admin_id = cau.id
       AND om.org_id <> o.id
       AND om.status = 'active')::int      AS other_memberships,
  o.created_at
FROM organizations o
JOIN cinema_admin_user cau ON cau.id = o.owner_id
WHERE cau.role = 'staff'
ORDER BY halls DESC, o.name;


-- ── B. INVARIANT VIOLATIONS ───────────────────────────────────
-- Platform 'admin' / 'superAdmin' users who are an active member of an org
-- they do NOT own.
--
-- The cleanup script never touches these. Resolve each by hand: either
-- demote the account to 'staff' (it is really a team member), or remove the
-- membership (it was added by mistake).
SELECT
  cau.email,
  cau.role      AS platform_role,
  o.name        AS member_of_org,
  r.key         AS role_key,
  om.status,
  owner.email   AS org_owned_by
FROM organization_members om
JOIN cinema_admin_user cau  ON cau.id = om.admin_id
JOIN organizations o        ON o.id = om.org_id
JOIN roles r                ON r.id = om.role_id
LEFT JOIN cinema_admin_user owner ON owner.id = o.owner_id
WHERE cau.role IN ('admin', 'superAdmin')
  AND o.owner_id IS DISTINCT FROM cau.id
ORDER BY cau.email;


-- ── C. REPORT ONLY ────────────────────────────────────────────
-- Hall-less orgs owned by an 'admin' / 'superAdmin'.
--
-- NEVER auto-deleted: this is usually a legitimate tenant part-way through
-- onboarding, and deleting it would discard their setup. Review by hand.
SELECT
  o.id,
  o.name        AS org,
  cau.email     AS owner,
  cau.role      AS platform_role,
  o.is_active,
  (SELECT count(*) FROM organization_members om
     WHERE om.org_id = o.id)::int AS members,
  o.created_at
FROM organizations o
JOIN cinema_admin_user cau ON cau.id = o.owner_id
WHERE cau.role IN ('admin', 'superAdmin')
  AND NOT EXISTS (SELECT 1 FROM cinema_hall ch WHERE ch.org_id = o.id)
ORDER BY o.created_at;


-- ── D. ORPHANS ────────────────────────────────────────────────
-- Orgs with no owner at all. Not created by any normal code path.
SELECT
  o.id,
  o.name AS org,
  o.is_active,
  (SELECT count(*) FROM cinema_hall ch WHERE ch.org_id = o.id)::int          AS halls,
  (SELECT count(*) FROM organization_members om WHERE om.org_id = o.id)::int AS members,
  o.created_at
FROM organizations o
WHERE o.owner_id IS NULL
ORDER BY o.created_at;
