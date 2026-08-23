-- ============================================================
-- Phase 7: Organization audit log
-- Idempotent — all statements use IF NOT EXISTS
--
-- Business-action trail (who did what to which resource), distinct from
-- admin_security_logs which only covers auth/login events. org_id/admin_id
-- are FKs for integrity, but actor_name/actor_role_key are denormalized
-- snapshots so a row stays legible after the admin is renamed or removed.
-- Requires organizations, cinema_admin_user and cinema_hall to already exist.
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  admin_id        UUID        REFERENCES cinema_admin_user(id) ON DELETE SET NULL,
  actor_name      TEXT,
  actor_role_key  TEXT,
  action          TEXT        NOT NULL,
  resource_type   TEXT        NOT NULL,
  resource_id     UUID,
  resource_label  TEXT,
  hall_id         UUID        REFERENCES cinema_hall(id) ON DELETE SET NULL,
  metadata        JSONB       NOT NULL DEFAULT '{}',
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created
  ON audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin
  ON audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource
  ON audit_logs(org_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_hall
  ON audit_logs(hall_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs(org_id, action);
