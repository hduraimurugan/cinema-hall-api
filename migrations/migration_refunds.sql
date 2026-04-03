-- Migration: Create refunds table for tracking per-booking refund lifecycle
-- Run this against the Neon DB after deploying the show cancellation refund feature.

CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  payment_id VARCHAR(255) NOT NULL,          -- Razorpay payment_id (pay_xxx)
  razorpay_refund_id VARCHAR(255),           -- Razorpay refund ID (rfnd_xxx), populated after API call
  amount DECIMAL(10, 2) NOT NULL,
  refund_status VARCHAR(30) NOT NULL DEFAULT 'initiated'
    CHECK (refund_status IN ('initiated', 'settled', 'failed')),
  initiated_at TIMESTAMPTZ DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refunds_booking_id ON refunds(booking_id);
CREATE INDEX IF NOT EXISTS idx_refunds_razorpay_refund_id ON refunds(razorpay_refund_id);
CREATE INDEX IF NOT EXISTS idx_refunds_payment_id ON refunds(payment_id);
