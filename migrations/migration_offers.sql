-- =============================================
-- Offers / Coupon System Migration
-- =============================================

-- New table: offers
CREATE TABLE IF NOT EXISTS offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value NUMERIC(10,2) NOT NULL,
    max_discount_amount NUMERIC(10,2),          -- cap for % offers; NULL = no cap
    min_booking_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    valid_until TIMESTAMPTZ NOT NULL,
    scope VARCHAR(10) NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'hall')),
    cinema_hall_id UUID REFERENCES cinema_hall(id) ON DELETE CASCADE,  -- NULL = global
    user_eligibility VARCHAR(20) NOT NULL DEFAULT 'all' CHECK (user_eligibility IN ('all', 'joined_after')),
    user_joined_after TIMESTAMPTZ,              -- set only when user_eligibility = 'joined_after'
    created_by UUID REFERENCES cinema_admin_user(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- New table: offer_redemptions (tracks who used which offer)
CREATE TABLE IF NOT EXISTS offer_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id),
    discount_applied NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (offer_id, customer_id)   -- once per user per offer
);

-- Alter payment_orders: add offer tracking columns
ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS offer_code VARCHAR(50),
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0;

-- Alter bookings: add offer tracking columns
ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS offer_code VARCHAR(50),
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0;
