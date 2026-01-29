-- Migration: Add payment_orders and bookings tables
-- Date: 2026-01-29
-- Purpose: Complete payment and booking flow

-- =============================
-- 1. PAYMENT ORDERS TABLE
-- =============================
CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Razorpay order ID
  order_id VARCHAR(255) UNIQUE NOT NULL,
  
  -- Show and customer info
  show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  
  -- Seats being booked
  seats JSONB NOT NULL,
  
  -- Amount
  amount DECIMAL(10, 2) NOT NULL,
  
  -- Order status
  status VARCHAR(20) DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'expired')),
  
  -- Payment details (filled after verification)
  payment_id VARCHAR(255),
  payment_signature VARCHAR(500),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_order_id ON payment_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_customer ON payment_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);

-- =============================
-- 2. BOOKINGS TABLE
-- =============================
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  
  -- Seats booked (TEXT array)
  seats TEXT[] NOT NULL,
  
  -- Payment details
  total_amount DECIMAL(10, 2) NOT NULL,
  payment_status VARCHAR(20) DEFAULT 'pending',
  payment_id VARCHAR(255),
  
  booking_status VARCHAR(20) DEFAULT 'confirmed' CHECK (booking_status IN ('confirmed', 'cancelled', 'completed')),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_show ON bookings(show_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(booking_status);
