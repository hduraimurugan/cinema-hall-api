-- ============================================================
-- Phase 2: Team Management & RBAC
-- Idempotent — all statements use IF NOT EXISTS / ON CONFLICT
-- ============================================================

-- ── roles ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key               VARCHAR(50) NOT NULL,
  label             VARCHAR(100) NOT NULL,
  description       TEXT,
  is_system         BOOLEAN NOT NULL DEFAULT FALSE,
  permissions_version INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, key)
);

-- ── permissions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS permissions (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key       VARCHAR(100) UNIQUE NOT NULL,
  label     VARCHAR(200) NOT NULL,
  resource  VARCHAR(50) NOT NULL
);

-- ── role_permissions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ── organization_members ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS organization_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  admin_id    UUID NOT NULL REFERENCES cinema_admin_user(id) ON DELETE CASCADE,
  role_id     UUID NOT NULL REFERENCES roles(id),
  status      VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','removed')),
  invited_by  UUID REFERENCES cinema_admin_user(id),
  invited_at  TIMESTAMPTZ,
  joined_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, admin_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_admin ON organization_members(admin_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(org_id);

-- ── hall_assignments ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hall_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_member_id   UUID NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  hall_id         UUID NOT NULL REFERENCES cinema_hall(id) ON DELETE CASCADE,
  scope           VARCHAR(20) NOT NULL DEFAULT 'full' CHECK (scope IN ('full','read_only','limited')),
  assigned_by     UUID REFERENCES cinema_admin_user(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_member_id, hall_id)
);

-- ── Add purpose column to admin_verification_tokens ───────────
ALTER TABLE admin_verification_tokens
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(50) DEFAULT 'email_verification';

-- ── Allow 'staff' role in cinema_admin_user ──────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cinema_admin_user_role_check'
  ) THEN
    ALTER TABLE cinema_admin_user DROP CONSTRAINT cinema_admin_user_role_check;
  END IF;
END $$;
ALTER TABLE cinema_admin_user ADD CONSTRAINT cinema_admin_user_role_check
  CHECK (role IN ('superAdmin', 'admin', 'staff'));

-- ============================================================
-- SEED PERMISSIONS (idempotent)
-- ============================================================
INSERT INTO permissions (key, label, resource) VALUES
  ('movies.create',   'Create Movies',          'movies'),
  ('movies.read',     'Read Movies',            'movies'),
  ('movies.update',   'Update Movies',          'movies'),
  ('movies.delete',   'Delete Movies',          'movies'),
  ('shows.create',    'Create Shows',           'shows'),
  ('shows.read',      'Read Shows',             'shows'),
  ('shows.update',    'Update Shows',           'shows'),
  ('shows.delete',    'Delete Shows',           'shows'),
  ('shows.cancel',    'Cancel Shows',           'shows'),
  ('screens.create',  'Create Screens',         'screens'),
  ('screens.read',    'Read Screens',           'screens'),
  ('screens.update',  'Update Screens',         'screens'),
  ('screens.delete',  'Delete Screens',         'screens'),
  ('bookings.read',   'Read Bookings',          'bookings'),
  ('bookings.verify', 'Verify Bookings',        'bookings'),
  ('bookings.cancel', 'Cancel Bookings',        'bookings'),
  ('bookings.modify', 'Modify Bookings',        'bookings'),
  ('refunds.create',  'Create Refunds',         'refunds'),
  ('refunds.read',    'Read Refunds',           'refunds'),
  ('refunds.settle',  'Settle Refunds',         'refunds'),
  ('offers.create',   'Create Offers',          'offers'),
  ('offers.read',     'Read Offers',            'offers'),
  ('offers.update',   'Update Offers',          'offers'),
  ('offers.delete',   'Delete Offers',          'offers'),
  ('ads.create',      'Create Ads',             'ads'),
  ('ads.read',        'Read Ads',               'ads'),
  ('ads.update',      'Update Ads',             'ads'),
  ('ads.delete',      'Delete Ads',             'ads'),
  ('customers.read',  'Read Customers',         'customers'),
  ('customers.manage','Manage Customers',       'customers'),
  ('payment.read',    'Read Payment',           'payment'),
  ('payment.manage',  'Manage Payment',         'payment'),
  ('payment.settle',  'Settle Payment',         'payment'),
  ('settings.org.read',   'Read Org Settings',     'settings'),
  ('settings.org.update', 'Update Org Settings',   'settings'),
  ('settings.hall.read',  'Read Hall Settings',    'settings'),
  ('settings.hall.update','Update Hall Settings',  'settings'),
  ('settings.user.read',  'Read User Settings',    'settings'),
  ('settings.user.update','Update User Settings',  'settings'),
  ('settings.advanced.manage','Manage Advanced Settings','settings'),
  ('team.manage',    'Manage Team',             'team'),
  ('team.invite',    'Invite Team Members',     'team'),
  ('team.revoke',    'Revoke Team Members',     'team'),
  ('roles.manage',   'Manage Roles',            'roles'),
  ('roles.read',     'Read Roles',              'roles'),
  ('audit.view',     'View Audit Logs',         'audit'),
  ('analytics.view', 'View Analytics',          'analytics'),
  ('analytics.manage','Manage Analytics',       'analytics'),
  ('dashboard.view', 'View Dashboard',          'dashboard'),
  ('verify-ticket.use','Use Verify Ticket',     'verify-ticket'),
  ('integrations.manage','Manage Integrations', 'integrations'),
  ('billing.manage', 'Manage Billing',          'billing'),
  ('org.delete',     'Delete Organization',     'org')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- SEED SYSTEM ROLES per org
-- ============================================================
INSERT INTO roles (org_id, key, label, description, is_system)
SELECT o.id, r.key, r.label, r.description, TRUE
FROM organizations o
CROSS JOIN (VALUES
  ('owner',           'Owner',           'Full access to all features including billing and org management'),
  ('admin',           'Admin',           'Full access except billing, org deletion, and role management'),
  ('manager',         'Manager',         'Manage shows, screens, bookings, refunds, and view customers'),
  ('sales',           'Sales',           'Handle bookings, refunds, and customer inquiries'),
  ('finance',         'Finance',         'View bookings, payments, refunds, and analytics'),
  ('marketing',       'Marketing',       'Manage offers, ads, and view customer analytics'),
  ('ticket_operator', 'Ticket Operator',  'Verify tickets and view bookings and shows'),
  ('auditor',         'Auditor',         'Read-only access across all resources')
) AS r(key, label, description)
WHERE NOT EXISTS (
  SELECT 1 FROM roles r2 WHERE r2.org_id = o.id AND r2.key = r.key
);

-- ============================================================
-- SEED ROLE_PERMISSIONS per org
-- ============================================================

-- Helper: map each org's role to its permission set
-- owner → all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.key = 'owner'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- admin → all except org.delete, roles.manage, billing.manage
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.key = 'admin'
  AND p.key NOT IN ('org.delete', 'roles.manage', 'billing.manage')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- manager → shows.*, screens.*, bookings.*, refunds.*, movies.read/update, settings.hall.read/update, customers.read, dashboard.view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.key = 'manager'
  AND p.key IN (
    'shows.create', 'shows.read', 'shows.update', 'shows.delete', 'shows.cancel',
    'screens.create', 'screens.read', 'screens.update', 'screens.delete',
    'bookings.read', 'bookings.verify', 'bookings.cancel', 'bookings.modify',
    'refunds.create', 'refunds.read', 'refunds.settle',
    'movies.read', 'movies.update',
    'settings.hall.read', 'settings.hall.update',
    'customers.read',
    'dashboard.view'
  )
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- sales → bookings.read/cancel, refunds.create/read, dashboard.view, customers.read
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.key = 'sales'
  AND p.key IN (
    'bookings.read', 'bookings.cancel',
    'refunds.create', 'refunds.read',
    'dashboard.view',
    'customers.read'
  )
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- finance → bookings.read, payment.read, refunds.*, analytics.view, dashboard.view, customers.read
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.key = 'finance'
  AND p.key IN (
    'bookings.read',
    'payment.read',
    'refunds.create', 'refunds.read', 'refunds.settle',
    'analytics.view',
    'dashboard.view',
    'customers.read'
  )
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- marketing → offers.*, ads.*, movies.read, customers.read, analytics.view, dashboard.view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.key = 'marketing'
  AND p.key IN (
    'offers.create', 'offers.read', 'offers.update', 'offers.delete',
    'ads.create', 'ads.read', 'ads.update', 'ads.delete',
    'movies.read',
    'customers.read',
    'analytics.view',
    'dashboard.view'
  )
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- ticket_operator → shows.read, bookings.read/verify, verify-ticket.use, customers.read, dashboard.view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.key = 'ticket_operator'
  AND p.key IN (
    'shows.read',
    'bookings.read', 'bookings.verify',
    'verify-ticket.use',
    'customers.read',
    'dashboard.view'
  )
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- auditor → all *.read, audit.view, dashboard.view (no writes)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.key = 'auditor'
  AND (
    p.key LIKE '%.read'
    OR p.key IN ('audit.view', 'dashboard.view')
  )
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- ============================================================
-- BACKFILL: Add existing admins as org members
-- ============================================================
INSERT INTO organization_members (org_id, admin_id, role_id, status, joined_at)
SELECT o.id, o.owner_id, r.id, 'active', now()
FROM organizations o
JOIN roles r ON r.org_id = o.id AND r.key = 'owner'
WHERE o.owner_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM organization_members om WHERE om.org_id = o.id AND om.admin_id = o.owner_id
  );
