-- Migration: Add convenience_fee and gst_amount columns
-- Date: 2026-03-20
-- Purpose: Store per-booking fee breakdown for admin stats aggregation

ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS convenience_fee  DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_amount       DECIMAL(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS convenience_fee  DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_amount       DECIMAL(10, 2) NOT NULL DEFAULT 0;
