-- Add backdrop_path column to movies table
ALTER TABLE movies ADD COLUMN IF NOT EXISTS backdrop_path TEXT;
