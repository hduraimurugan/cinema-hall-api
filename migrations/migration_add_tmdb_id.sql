-- Add TMDB movie ID column for duplicate detection and TMDB data tracking
ALTER TABLE movies ADD COLUMN IF NOT EXISTS tmdb_id INT UNIQUE;
