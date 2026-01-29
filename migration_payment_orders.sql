-- Migration: Add payment_orders table
-- Date: 2026-01-29
-- Purpose: Track Razorpay orders for payment processing

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

CREATE INDEX idx_payment_orders_order_id ON payment_orders(order_id);
CREATE INDEX idx_payment_orders_customer ON payment_orders(customer_id);
CREATE INDEX idx_payment_orders_status ON payment_orders(status);
