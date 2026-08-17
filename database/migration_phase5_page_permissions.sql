-- ============================================================
-- Phase 5: Page-level permissions
-- Idempotent — all statements use ON CONFLICT / WHERE NOT EXISTS
--
-- The "My Halls" page was the only admin page with no permission
-- key behind it, so it could not be granted or revoked per role.
-- ============================================================

INSERT INTO permissions (key, label, resource) VALUES
  ('halls.read',   'Read Halls',   'halls'),
  ('halls.manage', 'Manage Halls', 'halls')
ON CONFLICT (key) DO NOTHING;

-- owner / admin / manager → full hall management
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.key IN ('owner', 'admin', 'manager')
  AND p.key IN ('halls.read', 'halls.manage')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- every other system role → read-only hall access
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.key IN ('sales', 'finance', 'marketing', 'ticket_operator', 'auditor')
  AND p.key = 'halls.read'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- Role permission sets changed above, so every token minted before now is
-- stale. Bumping the version makes requirePermission reject them once and
-- the client silently refreshes.
UPDATE roles
SET permissions_version = permissions_version + 1, updated_at = now()
WHERE key IN ('owner', 'admin', 'manager', 'sales', 'finance', 'marketing', 'ticket_operator', 'auditor');
