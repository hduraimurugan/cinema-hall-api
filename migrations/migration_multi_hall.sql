-- =============================================================================
-- Migration: Multi-Hall Multi-Tenant Support
-- Date: 2026-05-24
--
-- Purpose:
--   Prepares the database for a 1-admin : N-halls architecture.
--   The FK chain (admin → cinema_hall → screens → shows → bookings) is already
--   correct — no structural changes are needed there.
--
--   This migration:
--     1. Adds `is_active` to cinema_hall (hall lifecycle management).
--     2. Adds `phone` and `description` to cinema_hall (management UI fields).
--     3. Adds performance indexes for hall-scoped queries.
--     4. Verifies FK constraints are in place via DO block assertions.
--
-- Idempotent: safe to re-run (uses IF NOT EXISTS / IF EXISTS / ON CONFLICT).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. cinema_hall — new columns
-- ---------------------------------------------------------------------------

-- Allow admins to soft-deactivate a hall without deleting it.
-- Active halls show in the switcher; inactive ones are hidden.
ALTER TABLE cinema_hall
  ADD COLUMN IF NOT EXISTS is_active    BOOLEAN      NOT NULL DEFAULT TRUE;

-- Contact number for the hall (shown on booking confirmation emails).
ALTER TABLE cinema_hall
  ADD COLUMN IF NOT EXISTS phone        TEXT;

-- Optional short description shown in the management UI.
ALTER TABLE cinema_hall
  ADD COLUMN IF NOT EXISTS description  TEXT;


-- ---------------------------------------------------------------------------
-- 2. Performance indexes
--    All queries from the new requireActiveHall middleware will hit these.
-- ---------------------------------------------------------------------------

-- Fast lookup: "get all halls owned by this admin"
CREATE INDEX IF NOT EXISTS idx_cinema_hall_admin_id
  ON cinema_hall(admin_id);

-- Fast lookup: "get all screens in this hall"
CREATE INDEX IF NOT EXISTS idx_screens_cinema_hall_id
  ON screens(cinema_hall_id);

-- Fast lookup: shows → screen → hall chain used in dashboard stats
CREATE INDEX IF NOT EXISTS idx_shows_screen_id
  ON shows(screen_id);

-- Booking stats filtered by show (show → screen → hall chain)
CREATE INDEX IF NOT EXISTS idx_bookings_show_id
  ON bookings(show_id);


-- ---------------------------------------------------------------------------
-- 3. Verify FK chain (assertion — raises an error if any FK is missing)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- cinema_hall.admin_id → cinema_admin_user(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = rc.constraint_name
    WHERE kcu.table_name = 'cinema_hall'
      AND kcu.column_name = 'admin_id'
  ) THEN
    RAISE EXCEPTION 'MISSING FK: cinema_hall.admin_id must reference cinema_admin_user(id)';
  END IF;

  -- screens.cinema_hall_id → cinema_hall(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = rc.constraint_name
    WHERE kcu.table_name = 'screens'
      AND kcu.column_name = 'cinema_hall_id'
  ) THEN
    RAISE EXCEPTION 'MISSING FK: screens.cinema_hall_id must reference cinema_hall(id)';
  END IF;

  -- shows.screen_id → screens(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = rc.constraint_name
    WHERE kcu.table_name = 'shows'
      AND kcu.column_name = 'screen_id'
  ) THEN
    RAISE EXCEPTION 'MISSING FK: shows.screen_id must reference screens(id)';
  END IF;

  -- bookings.show_id → shows(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = rc.constraint_name
    WHERE kcu.table_name = 'bookings'
      AND kcu.column_name = 'show_id'
  ) THEN
    RAISE EXCEPTION 'MISSING FK: bookings.show_id must reference shows(id)';
  END IF;

  RAISE NOTICE 'FK chain verified: admin → cinema_hall → screens → shows → bookings ✓';
END;
$$;


-- ---------------------------------------------------------------------------
-- 4. Update docs/db_setup.sql companion changes
--    (Apply these ALTER TABLE lines to db_setup.sql manually after this runs)
--
--    ALTER TABLE cinema_hall ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT TRUE;
--    ALTER TABLE cinema_hall ADD COLUMN IF NOT EXISTS phone       TEXT;
--    ALTER TABLE cinema_hall ADD COLUMN IF NOT EXISTS description TEXT;
-- ---------------------------------------------------------------------------

-- End of migration_multi_hall.sql
