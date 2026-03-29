-- Migration: Show Status Lifecycle
-- Updates show statuses from old values (scheduled/running/cancelled/completed)
-- to new lifecycle values (scheduled/booking_started/in_progress/show_ended/cancelled)

-- Step 1: Drop old constraint (handles any auto-generated name too)
DO $$
DECLARE
  con_name text;
BEGIN
  FOR con_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'shows'::regclass AND contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE shows DROP CONSTRAINT IF EXISTS %I', con_name);
  END LOOP;
END$$;

-- Step 2: Migrate existing data BEFORE adding the new constraint
UPDATE shows SET status = 'in_progress' WHERE status = 'running';
UPDATE shows SET status = 'show_ended'  WHERE status = 'completed';

-- Step 3: Add new constraint (all rows are now valid)
ALTER TABLE shows ADD CONSTRAINT shows_status_check
  CHECK (status IN ('scheduled', 'booking_started', 'in_progress', 'show_ended', 'cancelled'));
