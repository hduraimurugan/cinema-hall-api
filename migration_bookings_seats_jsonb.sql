-- ============================================================
-- Migration: Convert bookings.seats from text[] to jsonb
-- Date: 2026-06-14
-- Purpose: Bring the local/production database schema in line
--          with the codebase design (JSONB seats list).
-- ============================================================

-- 1. Alter seats column type in bookings table
ALTER TABLE bookings 
  ALTER COLUMN seats TYPE jsonb 
  USING to_jsonb(seats);

-- 2. Ensure bookings unique index on payment_id exists
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_payment_id 
  ON bookings (payment_id);
