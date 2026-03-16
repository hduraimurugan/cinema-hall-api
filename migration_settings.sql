CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO settings (key, value) VALUES
  ('convenience_fee_per_ticket', '15'),
  ('gst_percentage', '18')
ON CONFLICT (key) DO NOTHING;
