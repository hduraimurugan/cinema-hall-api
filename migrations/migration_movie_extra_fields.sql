-- Add cast (JSONB array), vote_average, and vote_count columns to movies table
ALTER TABLE movies ADD COLUMN IF NOT EXISTS "cast" JSONB DEFAULT '[]';
ALTER TABLE movies ADD COLUMN IF NOT EXISTS vote_average NUMERIC(4,2);
ALTER TABLE movies ADD COLUMN IF NOT EXISTS vote_count INT;
