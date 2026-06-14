import bcrypt from 'bcrypt'
import { query } from './db.js'

export async function createAdmin(overrides = {}) {
  const defaults = {
    name: 'Test Admin',
    email: `admin_${Date.now()}@test.com`,
    password: await bcrypt.hash('TestPass123!', 12),
    role: 'admin',
    is_verified: true,
    is_active: true,
  }
  const data = { ...defaults, ...overrides }

  const result = await query(
    `INSERT INTO cinema_admin_user (name, email, password, role, is_verified, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [data.name, data.email, data.password, data.role, data.is_verified, data.is_active]
  )
  return result.rows[0]
}

export async function createSuperAdmin(overrides = {}) {
  return createAdmin({ ...overrides, role: 'superAdmin' })
}

export async function createHall(adminId, overrides = {}) {
  const defaults = {
    name: 'Test Cinema Hall',
    location: 'Test City',
    is_active: true,
  }
  const data = { ...defaults, ...overrides }

  const result = await query(
    `INSERT INTO cinema_hall (admin_id, name, location, is_active)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [adminId, data.name, data.location, data.is_active]
  )
  return result.rows[0]
}

export async function createScreen(hallId, overrides = {}) {
  const defaults = {
    name: 'Screen 1',
    capacity: 100,
    layout: JSON.stringify({ rows: 10, cols: 10, seats: [] }),
  }
  const data = { ...defaults, ...overrides }

  const result = await query(
    `INSERT INTO screens (hall_id, name, capacity, layout)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING *`,
    [hallId, data.name, data.capacity, data.layout]
  )
  return result.rows[0]
}

export async function createMovie(overrides = {}) {
  const defaults = {
    title: 'Test Movie',
    language: 'English',
    genre: JSON.stringify(['Action']),
    duration: 120,
    poster_url: 'https://example.com/poster.jpg',
    rating: '7.5',
  }
  const data = { ...defaults, ...overrides }

  const result = await query(
    `INSERT INTO movies (title, language, genre, duration, poster_url, rating)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)
     RETURNING *`,
    [data.title, data.language, data.genre, data.duration, data.poster_url, data.rating]
  )
  return result.rows[0]
}

export async function createShow(screenId, movieId, overrides = {}) {
  const defaults = {
    show_time: new Date(Date.now() + 86400000).toISOString(),
    price: 200,
    status: 'scheduled',
  }
  const data = { ...defaults, ...overrides }

  const result = await query(
    `INSERT INTO shows (screen_id, movie_id, show_time, price, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [screenId, movieId, data.show_time, data.price, data.status]
  )
  return result.rows[0]
}

export async function createCustomer(overrides = {}) {
  const defaults = {
    name: 'Test Customer',
    email: `customer_${Date.now()}@test.com`,
    password: await bcrypt.hash('CustomerPass123!', 12),
    phone: '9876543210',
    is_active: true,
  }
  const data = { ...defaults, ...overrides }

  const result = await query(
    `INSERT INTO customers (name, email, password, phone, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [data.name, data.email, data.password, data.phone, data.is_active]
  )
  return result.rows[0]
}

export async function createBooking(customerId, showId, overrides = {}) {
  const defaults = {
    seats: JSON.stringify(['A1', 'A2']),
    total_amount: 400,
    status: 'confirmed',
  }
  const data = { ...defaults, ...overrides }

  const result = await query(
    `INSERT INTO bookings (customer_id, show_id, seats, total_amount, status)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     RETURNING *`,
    [customerId, showId, data.seats, data.total_amount, data.status]
  )
  return result.rows[0]
}

export async function createPaymentOrder(showId, customerId, overrides = {}) {
  const defaults = {
    razorpay_order_id: `order_${Date.now()}`,
    amount: 400,
    currency: 'INR',
    status: 'created',
  }
  const data = { ...defaults, ...overrides }

  const result = await query(
    `INSERT INTO payment_orders (show_id, customer_id, razorpay_order_id, amount, currency, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [showId, customerId, data.razorpay_order_id, data.amount, data.currency, data.status]
  )
  return result.rows[0]
}

export async function createSetting(key, value) {
  const result = await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2
     RETURNING *`,
    [key, value]
  )
  return result.rows[0]
}

export async function createOffer(hallId, adminId, overrides = {}) {
  const defaults = {
    code: `OFFER${Date.now()}`,
    discount_type: 'percentage',
    discount_value: 10,
    min_amount: 100,
    max_discount: 50,
    valid_from: new Date(Date.now() - 86400000).toISOString(),
    valid_until: new Date(Date.now() + 86400000 * 30).toISOString(),
    usage_limit: 100,
    is_active: true,
  }
  const data = { ...defaults, ...overrides }

  const result = await query(
    `INSERT INTO offers (cinema_hall_id, created_by, code, discount_type, discount_value, min_amount, max_discount, valid_from, valid_until, usage_limit, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [hallId, adminId, data.code, data.discount_type, data.discount_value, data.min_amount, data.max_discount, data.valid_from, data.valid_until, data.usage_limit, data.is_active]
  )
  return result.rows[0]
}
