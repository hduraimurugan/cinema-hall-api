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

--screens
CREATE TABLE screens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hall_id UUID REFERENCES cinema_hall(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  total_seats INT NOT NULL,
  layout JSONB, -- Optional: stores layout data for rows, cols, and seat map
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE movies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  poster_url TEXT,
  duration_mins INT,
  genre TEXT,
  language TEXT,
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
