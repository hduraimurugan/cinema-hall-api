-- Fix: prevent_overlapping_shows trigger incorrectly rejects midnight-crossing shows
-- e.g. 22:30–01:15 was being treated as 01:15–22:30 by PostgreSQL's OVERLAPS operator,
-- causing false conflicts with every other show in the same day.
-- Run this once on your Neon DB.

CREATE OR REPLACE FUNCTION prevent_overlapping_shows()
RETURNS TRIGGER AS $$
DECLARE
  new_crosses_midnight BOOLEAN := NEW.end_time < NEW.start_time;
BEGIN
  IF EXISTS (
    SELECT 1 FROM shows
    WHERE screen_id = NEW.screen_id
      AND show_date = NEW.show_date
      AND id IS DISTINCT FROM NEW.id
      AND (
        CASE
          -- Neither show crosses midnight: standard range overlap
          WHEN NOT new_crosses_midnight AND end_time >= start_time THEN
            NEW.start_time < end_time AND start_time < NEW.end_time

          -- NEW show crosses midnight (e.g. 22:30–01:15)
          WHEN new_crosses_midnight AND end_time >= start_time THEN
            start_time >= NEW.start_time OR end_time <= NEW.end_time

          -- Existing show crosses midnight
          WHEN NOT new_crosses_midnight AND end_time < start_time THEN
            NEW.start_time >= start_time OR NEW.end_time <= end_time

          -- Both cross midnight — always overlap
          ELSE TRUE
        END
      )
  ) THEN
    RAISE EXCEPTION 'Show overlaps with an existing show on the same screen.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
