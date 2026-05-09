-- ============================================================
-- Migration: Idempotency & Duplicate Booking Prevention
-- Date: 2026-05-09
-- Purpose: Prevent duplicate bookings, double-payment, and
--          replay attacks at the database level.
-- ============================================================

-- ── 1. Unique constraint on bookings.payment_id ──────────────
-- CRITICAL: This is the DB-level backstop that prevents two
-- concurrent verifyPayment calls from both inserting a booking
-- row for the same Razorpay payment_id.
-- NOTE: If you already have duplicate payment_ids, resolve them
-- first: SELECT payment_id, count(*) FROM bookings GROUP BY 1 HAVING count(*) > 1;
ALTER TABLE bookings
  ADD CONSTRAINT uq_bookings_payment_id UNIQUE (payment_id);

-- ── 2. Index on bookings.payment_id for fast idempotency lookups
CREATE INDEX IF NOT EXISTS idx_bookings_payment_id
  ON bookings (payment_id);

-- ── 3. Webhook event deduplication table ─────────────────────
-- Razorpay retries webhooks for up to 24 hours on transient
-- failures. We deduplicate by X-Razorpay-Event-Id header.
-- Fallback: SHA-256 of raw body when the header is absent.
CREATE TABLE IF NOT EXISTS webhook_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        TEXT        UNIQUE NOT NULL,  -- X-Razorpay-Event-Id or body hash
  event_type      TEXT        NOT NULL,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload_hash    TEXT                           -- SHA-256 of raw body (audit trail)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id
  ON webhook_events (event_id);

-- ── 4. Composite index for createOrder dedup lookup ──────────
-- Speeds up: WHERE customer_id = ? AND show_id = ? AND status = 'created'
CREATE INDEX IF NOT EXISTS idx_payment_orders_customer_show
  ON payment_orders (customer_id, show_id, status);
