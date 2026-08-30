-- Migration: multi-channel broadcasts + offer/ad announcements
-- Adds the channel selection the composer now exposes (in-app is implicit and
-- always fires, so only push/email are stored), a `source` discriminator that
-- separates composer-created broadcasts from ones an Offer/Ad generated, and a
-- hall_customers audience for hall-scoped offers.
-- Run this after migration_admin_broadcasts.sql.

ALTER TABLE admin_broadcasts ADD COLUMN IF NOT EXISTS channels TEXT[] NOT NULL DEFAULT '{push}';
ALTER TABLE admin_broadcasts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
-- Deliberately not a FK: an announcement should outlive the offer/ad that spawned
-- it, the same way notification_dispatch_log outlives a deleted broadcast.
ALTER TABLE admin_broadcasts ADD COLUMN IF NOT EXISTS origin_id UUID;
ALTER TABLE admin_broadcasts ADD COLUMN IF NOT EXISTS cinema_hall_id UUID REFERENCES cinema_hall(id) ON DELETE SET NULL;

-- Widen the audience CHECK to admit hall_customers (customers who have booked
-- at a given hall) — see resolveAudience() in services/notification/broadcast.js.
ALTER TABLE admin_broadcasts DROP CONSTRAINT IF EXISTS admin_broadcasts_audience_type_check;
ALTER TABLE admin_broadcasts ADD CONSTRAINT admin_broadcasts_audience_type_check
  CHECK (audience_type IN ('all_customers','all_admins','custom','hall_customers'));

ALTER TABLE admin_broadcasts DROP CONSTRAINT IF EXISTS admin_broadcasts_source_check;
ALTER TABLE admin_broadcasts ADD CONSTRAINT admin_broadcasts_source_check
  CHECK (source IN ('manual','offer','ad'));

CREATE INDEX IF NOT EXISTS idx_admin_broadcasts_source ON admin_broadcasts(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_broadcasts_origin ON admin_broadcasts(origin_id) WHERE origin_id IS NOT NULL;
-- Powers the Auto tab's event feed (notifications with no broadcast_id).
CREATE INDEX IF NOT EXISTS idx_notifications_event_created ON notifications(event, created_at DESC);
