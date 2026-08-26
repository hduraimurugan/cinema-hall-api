-- Migration: Super Admin manual broadcast notifications
-- Adds admin_broadcasts (one row per compose-and-send action) and links it to
-- the existing per-recipient notifications/notification_dispatch_log rows via
-- a nullable broadcast_id, so a single admin action can fan out to many
-- recipients while still being viewable/auditable as one thing.
-- Run this against the Neon DB (and local dev DB) after migration_notifications.sql.

CREATE TABLE IF NOT EXISTS admin_broadcasts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    UUID REFERENCES cinema_admin_user(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  body          TEXT,
  image_url     TEXT,
  audience_type TEXT NOT NULL CHECK (audience_type IN ('all_customers','all_admins','custom')),
  recipient_customer_ids UUID[] NOT NULL DEFAULT '{}',
  recipient_admin_ids    UUID[] NOT NULL DEFAULT '{}',
  target_count  INT NOT NULL DEFAULT 0,
  sent_count    INT NOT NULL DEFAULT 0,
  failed_count  INT NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','cancelled')),
  scheduled_for TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_broadcasts_created ON admin_broadcasts(created_at DESC);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS broadcast_id UUID REFERENCES admin_broadcasts(id) ON DELETE SET NULL;
ALTER TABLE notification_dispatch_log ADD COLUMN IF NOT EXISTS broadcast_id UUID REFERENCES admin_broadcasts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_broadcast ON notifications(broadcast_id) WHERE broadcast_id IS NOT NULL;
