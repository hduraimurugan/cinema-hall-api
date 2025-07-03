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

CREATE TABLE shows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID REFERENCES movies(id) ON DELETE CASCADE,
  screen_id UUID REFERENCES screens(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  price_premium NUMERIC(10, 2),
  price_gold NUMERIC(10, 2),
  price_silver NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT now()
);


CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id UUID REFERENCES shows(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL, -- or customer_id if using auth
  seats JSONB NOT NULL, -- example: [{ row: "B", number: 4, type: "gold" }]
  total_amount NUMERIC(10, 2) NOT NULL,
  status TEXT DEFAULT 'booked', -- booked, cancelled, expired
  created_at TIMESTAMPTZ DEFAULT now()
);


CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
