-- Consolidated test schema: base tables + all migration columns
-- Created for test database setup

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================
-- CINEMA ADMIN USER
-- ============================
CREATE TABLE IF NOT EXISTS cinema_admin_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password TEXT,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  is_verified BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at TIMESTAMPTZ,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  account_locked_until TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  auth_providers TEXT[] NOT NULL DEFAULT ARRAY['local'],
  provider_ids JSONB NOT NULL DEFAULT '{}',
  avatar TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================
-- ORGANIZATIONS
-- ============================
CREATE TABLE IF NOT EXISTS organizations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  slug              TEXT UNIQUE NOT NULL,
  owner_id          UUID REFERENCES cinema_admin_user(id) ON DELETE SET NULL,
  default_timezone  TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  default_currency  TEXT NOT NULL DEFAULT 'INR',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  plan              TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','enterprise')),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ============================
-- ROLES
-- ============================
CREATE TABLE IF NOT EXISTS roles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key               VARCHAR(50) NOT NULL,
  label             VARCHAR(100) NOT NULL,
  description       TEXT,
  is_system         BOOLEAN NOT NULL DEFAULT FALSE,
  permissions_version INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, key)
);

-- ============================
-- PERMISSIONS
-- ============================
CREATE TABLE IF NOT EXISTS permissions (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key       VARCHAR(100) UNIQUE NOT NULL,
  label     VARCHAR(200) NOT NULL,
  resource  VARCHAR(50) NOT NULL
);

-- ============================
-- ROLE PERMISSIONS
-- ============================
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ============================
-- ORGANIZATION MEMBERS
-- ============================
CREATE TABLE IF NOT EXISTS organization_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  admin_id    UUID NOT NULL REFERENCES cinema_admin_user(id) ON DELETE CASCADE,
  role_id     UUID NOT NULL REFERENCES roles(id),
  status      VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','removed')),
  invited_by  UUID REFERENCES cinema_admin_user(id),
  invited_at  TIMESTAMPTZ,
  joined_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, admin_id)
);

-- ============================
-- CINEMA HALL
-- ============================
CREATE TABLE IF NOT EXISTS cinema_hall (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES cinema_admin_user(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  district TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  phone TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================
-- HALL ASSIGNMENTS
-- ============================
CREATE TABLE IF NOT EXISTS hall_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_member_id   UUID NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  hall_id         UUID NOT NULL REFERENCES cinema_hall(id) ON DELETE CASCADE,
  scope           VARCHAR(20) NOT NULL DEFAULT 'full' CHECK (scope IN ('full','read_only','limited')),
  assigned_by     UUID REFERENCES cinema_admin_user(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_member_id, hall_id)
);

CREATE INDEX IF NOT EXISTS idx_cinema_hall_admin_id ON cinema_hall(admin_id);

-- ============================
-- SCREENS
-- ============================
CREATE TABLE IF NOT EXISTS screens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cinema_hall_id UUID REFERENCES cinema_hall(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  total_seats INT NOT NULL DEFAULT 0,
  premium_seats INT NOT NULL DEFAULT 0,
  gold_seats INT NOT NULL DEFAULT 0,
  silver_seats INT NOT NULL DEFAULT 0,
  premium_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  gold_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  silver_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  rows INT NOT NULL DEFAULT 0,
  columns INT NOT NULL DEFAULT 0,
  screen_position TEXT NOT NULL DEFAULT '',
  layout JSONB,
  capacity INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_screens_cinema_hall_id ON screens(cinema_hall_id);

-- ============================
-- MOVIES
-- ============================
CREATE TABLE IF NOT EXISTS movies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  poster_url TEXT,
  trailer_url TEXT,
  duration_mins INT,
  genre TEXT[] DEFAULT '{}',
  language TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'upcoming',
  release_date DATE,
  tmdb_id INT UNIQUE,
  "cast" JSONB DEFAULT '[]',
  vote_average NUMERIC(4,2),
  vote_count INT,
  rating TEXT,
  duration INT,
  backdrop_path TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================
-- CUSTOMERS
-- ============================
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password TEXT,
  name TEXT,
  phone TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  district TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  failed_login_attempts INT NOT NULL DEFAULT 0,
  account_locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  auth_providers TEXT[] NOT NULL DEFAULT ARRAY['local'],
  provider_ids JSONB NOT NULL DEFAULT '{}',
  avatar TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================
-- SHOWS
-- ============================
CREATE TABLE IF NOT EXISTS shows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  show_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  language_version TEXT NOT NULL DEFAULT 'Original',
  price_override JSONB,
  price NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_screen_showtime UNIQUE (screen_id, show_date, start_time)
);

CREATE INDEX IF NOT EXISTS idx_shows_screen_id ON shows(screen_id);

-- Overlap prevention
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
          WHEN NOT new_crosses_midnight AND end_time >= start_time THEN
            NEW.start_time < end_time AND start_time < NEW.end_time
          WHEN new_crosses_midnight AND end_time >= start_time THEN
            start_time >= NEW.start_time OR end_time <= NEW.end_time
          WHEN NOT new_crosses_midnight AND end_time < start_time THEN
            NEW.start_time >= start_time OR NEW.end_time <= end_time
          ELSE TRUE
        END
      )
  ) THEN
    RAISE EXCEPTION 'Show overlaps with an existing show on the same screen.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_overlap ON shows;
CREATE TRIGGER trigger_prevent_overlap
BEFORE INSERT OR UPDATE ON shows
FOR EACH ROW EXECUTE FUNCTION prevent_overlapping_shows();

-- ============================
-- SHOW BOOKED SEATS
-- ============================
CREATE TABLE IF NOT EXISTS show_booked_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  seat_id TEXT NOT NULL,
  seat_label TEXT NOT NULL,
  row_label TEXT NOT NULL,
  column_number INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'AVAILABLE'
    CHECK (status IN ('AVAILABLE', 'HELD', 'BOOKED')),
  held_by UUID REFERENCES customers(id) ON DELETE SET NULL,
  hold_expires_at TIMESTAMPTZ,
  booked_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (show_id, seat_id)
);

CREATE INDEX IF NOT EXISTS idx_show_booked_seats_expires
  ON show_booked_seats(status, hold_expires_at) WHERE status = 'HELD';

-- ============================
-- BOOKINGS
-- ============================
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  show_id UUID REFERENCES shows(id) ON DELETE CASCADE,
  user_email TEXT,
  seats JSONB NOT NULL,
  total_amount NUMERIC(10, 2) NOT NULL,
  status TEXT DEFAULT 'booked',
  payment_id TEXT,
  payment_status VARCHAR(20) DEFAULT 'pending',
  booking_status VARCHAR(20) DEFAULT 'confirmed',
  convenience_fee DECIMAL(10, 2) NOT NULL DEFAULT 0,
  gst_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  offer_code VARCHAR(50),
  discount_amount NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_show_id ON bookings(show_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(booking_status);

-- ============================
-- PAYMENT ORDERS
-- ============================
CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT UNIQUE NOT NULL,
  show_id UUID REFERENCES shows(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  seats JSONB NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  payment_id TEXT,
  payment_signature TEXT,
  convenience_fee DECIMAL(10, 2) NOT NULL DEFAULT 0,
  gst_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  offer_code VARCHAR(50),
  discount_amount NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_order_id ON payment_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_customer ON payment_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);

-- ============================
-- OTP VERIFICATIONS
-- ============================
CREATE TABLE IF NOT EXISTS otp_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  otp TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'signup',
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  otp_attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_customer_email FOREIGN KEY (email) REFERENCES customers(email) ON DELETE CASCADE,
  UNIQUE (email, type)
);

-- ============================
-- ORGANIZATION SETTINGS
-- ============================
CREATE TABLE IF NOT EXISTS organization_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  section         TEXT NOT NULL,
  value           JSONB NOT NULL DEFAULT '{}',
  schema_version  INT NOT NULL DEFAULT 1,
  updated_by      UUID REFERENCES cinema_admin_user(id),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, section)
);
CREATE INDEX IF NOT EXISTS idx_org_settings_org_section ON organization_settings(org_id, section);

-- ============================
-- HALL SETTINGS
-- ============================
CREATE TABLE IF NOT EXISTS hall_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hall_id         UUID NOT NULL REFERENCES cinema_hall(id) ON DELETE CASCADE,
  section         TEXT NOT NULL,
  value           JSONB NOT NULL DEFAULT '{}',
  schema_version  INT NOT NULL DEFAULT 1,
  updated_by      UUID REFERENCES cinema_admin_user(id),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (hall_id, section)
);
CREATE INDEX IF NOT EXISTS idx_hall_settings_hall_section ON hall_settings(hall_id, section);

-- ============================
-- USER SETTINGS
-- ============================
CREATE TABLE IF NOT EXISTS user_settings (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id  UUID NOT NULL REFERENCES cinema_admin_user(id) ON DELETE CASCADE,
  section   TEXT NOT NULL,
  value     JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (admin_id, section)
);
CREATE INDEX IF NOT EXISTS idx_user_settings_admin ON user_settings(admin_id);

-- ============================
-- ADMIN SESSIONS
-- ============================
CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES cinema_admin_user(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id ON admin_sessions(admin_id);

-- ============================
-- ADMIN VERIFICATION TOKENS
-- ============================
CREATE TABLE IF NOT EXISTS admin_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES cinema_admin_user(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_verification_tokens_admin_id
  ON admin_verification_tokens(admin_id);

-- ============================
-- ADMIN PASSWORD RESET TOKENS
-- ============================
CREATE TABLE IF NOT EXISTS admin_password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES cinema_admin_user(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_password_reset_tokens_admin_id
  ON admin_password_reset_tokens(admin_id);

-- ============================
-- ADMIN SECURITY LOGS
-- ============================
CREATE TABLE IF NOT EXISTS admin_security_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES cinema_admin_user(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_security_logs_admin_id ON admin_security_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_security_logs_created_at ON admin_security_logs(created_at DESC);

-- ============================
-- CUSTOMER SESSIONS
-- ============================
CREATE TABLE IF NOT EXISTS customer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer_id ON customer_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_token_hash  ON customer_sessions(refresh_token_hash);

-- ============================
-- WEBHOOK EVENTS
-- ============================
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events(event_id);

-- ============================
-- ADS
-- ============================
CREATE TABLE IF NOT EXISTS ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  image_url TEXT NOT NULL,
  click_url TEXT,
  placement VARCHAR(20) NOT NULL DEFAULT 'banner',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ad_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id UUID REFERENCES ads(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  clicked_at TIMESTAMP DEFAULT NOW()
);

-- ============================
-- OFFERS
-- ============================
CREATE TABLE IF NOT EXISTS offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT '',
  description TEXT,
  discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value NUMERIC(10,2) NOT NULL,
  max_discount_amount NUMERIC(10,2),
  min_booking_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  valid_until TIMESTAMPTZ NOT NULL,
  scope VARCHAR(10) NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'hall')),
  cinema_hall_id UUID REFERENCES cinema_hall(id) ON DELETE CASCADE,
  user_eligibility VARCHAR(20) NOT NULL DEFAULT 'all' CHECK (user_eligibility IN ('all', 'joined_after')),
  user_joined_after TIMESTAMPTZ,
  created_by UUID REFERENCES cinema_admin_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS offer_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id),
  discount_applied NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (offer_id, customer_id)
);

-- ============================
-- REFUNDS
-- ============================
CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  payment_id VARCHAR(255) NOT NULL,
  razorpay_refund_id VARCHAR(255),
  amount DECIMAL(10, 2) NOT NULL,
  refund_status VARCHAR(30) NOT NULL DEFAULT 'initiated',
  initiated_at TIMESTAMPTZ DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refunds_booking_id ON refunds(booking_id);
CREATE INDEX IF NOT EXISTS idx_refunds_razorpay_refund_id ON refunds(razorpay_refund_id);
CREATE INDEX IF NOT EXISTS idx_refunds_payment_id ON refunds(payment_id);

-- ============================
-- SHOW STATUS CHECK CONSTRAINT
-- ============================
ALTER TABLE shows DROP CONSTRAINT IF EXISTS shows_status_check;
ALTER TABLE shows ADD CONSTRAINT shows_status_check
  CHECK (status IN ('scheduled', 'booking_started', 'in_progress', 'show_ended', 'cancelled'));

-- ============================
-- BOOKING CONSTRAINTS
-- ============================
DROP INDEX IF EXISTS idx_bookings_payment_id;
CREATE UNIQUE INDEX idx_bookings_payment_id ON bookings(payment_id);

-- ============================
-- PAYMENT ORDERS COMPOSITE INDEX
-- ============================
CREATE INDEX IF NOT EXISTS idx_payment_orders_customer_show
  ON payment_orders (customer_id, show_id, status);

-- ============================
-- AUTO-UPDATE TRIGGER
-- ============================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = now();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
CREATE TRIGGER update_customers_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================
-- OAUTH INDEXES
-- ============================
CREATE INDEX IF NOT EXISTS idx_admin_google_provider_id
  ON cinema_admin_user ((provider_ids->>'google'))
  WHERE provider_ids->>'google' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_github_provider_id
  ON cinema_admin_user ((provider_ids->>'github'))
  WHERE provider_ids->>'github' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_google_provider_id
  ON customers ((provider_ids->>'google'))
  WHERE provider_ids->>'google' IS NOT NULL;
