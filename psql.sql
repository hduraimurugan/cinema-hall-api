-- cinema_admin_user
CREATE TABLE cinema_admin_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL, -- or Supabase auth_user_id
  name TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- cinema_hall
CREATE TABLE cinema_hall (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES cinema_admin_user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE cinema_hall
ADD COLUMN district TEXT NOT NULL DEFAULT '',
ADD COLUMN state TEXT NOT NULL DEFAULT '';


--screens
CREATE TABLE screens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cinema_hall_id UUID REFERENCES cinema_hall(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  total_seats INT NOT NULL,
  premium_seats INT NOT NULL,
  gold_seats INT NOT NULL,
  silver_seats INT NOT NULL,
  premium_price NUMERIC(10,2) NOT NULL,
  gold_price NUMERIC(10,2) NOT NULL,
  silver_price NUMERIC(10,2) NOT NULL,
  rows INT NOT NULL,
  columns INT NOT NULL,
  screen_position TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE screens
ADD COLUMN layout JSONB;

-- movies
CREATE TABLE movies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  poster_url TEXT,
  trailer_url TEXT,
  duration_mins INT,
  genre TEXT,
  language TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming',
  release_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE movies
  ALTER COLUMN genre SET DATA TYPE TEXT[] USING ARRAY[genre],
  ALTER COLUMN language SET DATA TYPE TEXT[] USING ARRAY[language];


-- shows
CREATE TABLE shows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,

  show_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,

  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'running', 'cancelled', 'completed')),

  language_version TEXT NOT NULL DEFAULT 'Original',

  price_override JSONB, 

  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE shows
ADD CONSTRAINT unique_screen_showtime
UNIQUE (screen_id, show_date, start_time);


CREATE OR REPLACE FUNCTION prevent_overlapping_shows()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM shows
    WHERE screen_id = NEW.screen_id
      AND show_date = NEW.show_date
      AND (
        (NEW.start_time, NEW.end_time) OVERLAPS (start_time, end_time)
      )
  ) THEN
    RAISE EXCEPTION 'Show overlaps with an existing show on the same screen.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_overlapping_shows()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM shows
    WHERE screen_id = NEW.screen_id
      AND show_date = NEW.show_date
      AND (
        (NEW.start_time, NEW.end_time) OVERLAPS (start_time, end_time)
      )
      AND (id IS DISTINCT FROM NEW.id)  -- ✅ Exclude same row during UPDATE
  ) THEN
    RAISE EXCEPTION 'Show overlaps with an existing show on the same screen.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;



CREATE TRIGGER trigger_prevent_overlap
BEFORE INSERT OR UPDATE ON shows
FOR EACH ROW
EXECUTE FUNCTION prevent_overlapping_shows();


CREATE TABLE show_booked_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  seat_id TEXT NOT NULL,             
  seat_label TEXT NOT NULL,          

  row_label TEXT NOT NULL,            
  column_number INT NOT NULL,         

  -- ✅ Proper status lifecycle: AVAILABLE → HELD → BOOKED
  status TEXT NOT NULL DEFAULT 'AVAILABLE'
    CHECK (status IN ('AVAILABLE', 'HELD', 'BOOKED')),

  -- ✅ Track who holds the seat
  held_by UUID REFERENCES customers(id) ON DELETE SET NULL,

  -- ✅ Hold expiration (5 minutes)
  hold_expires_at TIMESTAMPTZ,

  -- ✅ Booking timestamp
  booked_at TIMESTAMPTZ DEFAULT now(),

  created_at TIMESTAMPTZ DEFAULT now(),

  -- ✅ One seat per show (prevents double booking at DB level)
  UNIQUE (show_id, seat_id)
);

-- Index for fast expired hold queries
CREATE INDEX idx_show_booked_seats_expires 
  ON show_booked_seats(status, hold_expires_at) 
  WHERE status = 'HELD';



CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id UUID REFERENCES shows(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL, -- or customer_id if using auth
  seats JSONB NOT NULL, -- example: [{ row: "B", number: 4, type: "gold" }]
  total_amount NUMERIC(10, 2) NOT NULL,
  status TEXT DEFAULT 'booked', -- booked, cancelled, expired
  payment_id TEXT, -- Razorpay payment_id
  created_at TIMESTAMPTZ DEFAULT now()
);


-- Payment orders tracking table (for Razorpay integration)
CREATE TABLE payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT UNIQUE NOT NULL,  -- Razorpay order_id
  show_id UUID REFERENCES shows(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  seats JSONB NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'paid', 'failed', 'refunded')),
  payment_id TEXT,  -- Razorpay payment_id (after success)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast order lookup
CREATE INDEX idx_payment_orders_order_id ON payment_orders(order_id);


-- Table: customers (end-users who sign up)
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,  -- hashed password
  name TEXT NOT NULL,
  phone TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE, -- linked with OTP verification
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE customers
ADD COLUMN district TEXT NOT NULL DEFAULT '',
ADD COLUMN state TEXT NOT NULL DEFAULT '';


-- Migration: add 'running' to shows status check constraint
ALTER TABLE shows DROP CONSTRAINT shows_status_check;
ALTER TABLE shows ADD CONSTRAINT shows_status_check
  CHECK (status IN ('scheduled', 'running', 'cancelled', 'completed'));


-- Automatically update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = now();
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_customers_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


-- Table: otp_verifications (stores OTP per email)
CREATE TABLE otp_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  otp TEXT NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL, -- validity window
  CONSTRAINT fk_customer_email FOREIGN KEY (email) REFERENCES customers(email) ON DELETE CASCADE
);

