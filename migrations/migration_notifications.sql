-- Migration: Notification service foundation
-- Tables: notifications (in-app feed), notification_dispatch_log (per-channel
-- send attempts, QStash-driven), device_tokens (push registrations),
-- customer_settings (per-customer preferences, mirrors user_settings).
-- Run this against the Neon DB after deploying the notification service.

-- ── notifications ─────────────────────────────────────────────────
-- One row per recipient per event occurrence. Backs the in-app feed
-- (list, unread count, mark-as-read) for both customers and admins.
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id  UUID REFERENCES customers(id) ON DELETE CASCADE,
  admin_id     UUID REFERENCES cinema_admin_user(id) ON DELETE CASCADE,
  event        TEXT NOT NULL,        -- 'booking_confirmed','booking_cancelled','refund_initiated',
                                      -- 'refund_settled','show_cancelled','show_reminder','daily_report','security_alert'
  title        TEXT NOT NULL,
  body         TEXT,
  data         JSONB NOT NULL DEFAULT '{}',
  booking_id   UUID REFERENCES bookings(id) ON DELETE SET NULL,
  show_id      UUID REFERENCES shows(id) ON DELETE SET NULL,
  refund_id    UUID REFERENCES refunds(id) ON DELETE SET NULL,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notifications_one_recipient CHECK (
    (customer_id IS NOT NULL)::int + (admin_id IS NOT NULL)::int = 1
  )
);
CREATE INDEX IF NOT EXISTS idx_notifications_customer ON notifications(customer_id, created_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_admin    ON notifications(admin_id, created_at DESC) WHERE admin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_unread   ON notifications(customer_id, admin_id) WHERE read_at IS NULL;

-- ── notification_dispatch_log ───────────────────────────────────────
-- One row per (notification, channel) send attempt — the QStash-driven
-- audit trail. Not rendered directly in the UI.
CREATE TABLE IF NOT EXISTS notification_dispatch_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id   UUID REFERENCES notifications(id) ON DELETE SET NULL,
  org_id            UUID REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id       UUID REFERENCES customers(id) ON DELETE CASCADE,
  admin_id          UUID REFERENCES cinema_admin_user(id) ON DELETE CASCADE,
  event             TEXT NOT NULL,
  channel           TEXT NOT NULL CHECK (channel IN ('email','push','in_app','sms','whatsapp')),
  status            TEXT NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued','sent','delivered','failed','skipped')),
  qstash_message_id TEXT,            -- correlates to the Upstash QStash dashboard/logs
  target            TEXT,            -- email address / fcm token actually used for this attempt
  error             TEXT,
  attempted_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dispatch_log_notification ON notification_dispatch_log(notification_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_log_qstash_msg   ON notification_dispatch_log(qstash_message_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_log_status       ON notification_dispatch_log(status) WHERE status IN ('queued','failed');

-- ── device_tokens ────────────────────────────────────────────────
-- Per-recipient push device registrations. 1:many — a user can have a
-- web session and a MyApp (React Native) install registered at once.
CREATE TABLE IF NOT EXISTS device_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID REFERENCES customers(id) ON DELETE CASCADE,
  admin_id     UUID REFERENCES cinema_admin_user(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  platform     TEXT NOT NULL CHECK (platform IN ('web','android','ios')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT device_tokens_one_recipient CHECK (
    (customer_id IS NOT NULL)::int + (admin_id IS NOT NULL)::int = 1
  )
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_customer ON device_tokens(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_device_tokens_admin    ON device_tokens(admin_id) WHERE admin_id IS NOT NULL;

-- ── customer_settings ────────────────────────────────────────────
-- Mirrors user_settings (per-admin preferences) but for customers.
-- Currently only used for the 'notifications' section (per-event channel
-- toggles, same {email,sms,whatsapp,push} shape as USER_DEFAULTS.notifications
-- in cinema-hall-admin/src/lib/settings/settingsDefaults.js).
CREATE TABLE IF NOT EXISTS customer_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  section     TEXT NOT NULL,
  value       JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (customer_id, section)
);
CREATE INDEX IF NOT EXISTS idx_customer_settings_customer ON customer_settings(customer_id);
