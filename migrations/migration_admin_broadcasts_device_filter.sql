-- Migration: per-recipient device/token selection for admin broadcasts
-- Lets a Super Admin narrow a "custom" broadcast recipient down to specific
-- registered devices (e.g. only their Android app, not their web session)
-- instead of always fanning out to every device_tokens row for that person.
-- Shape: { "customer:<id>": ["<device_tokens.id>", ...], "admin:<id>": [...] }
-- — a key is present only when the admin explicitly narrowed that person's
-- devices; an absent key means "all of this person's devices" (the default).

ALTER TABLE admin_broadcasts ADD COLUMN IF NOT EXISTS device_token_filter JSONB NOT NULL DEFAULT '{}';
