import bcrypt from 'bcrypt'
import { query } from './db.js'

export async function createAdmin(overrides = {}) {
  const defaults = {
    name: 'Test Admin',
    email: `admin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`,
    password: await bcrypt.hash('TestPass123!', 12),
    role: 'admin',
    is_verified: true,
    email_verified: true,
    is_active: true,
    auth_providers: ['local'],
    account_locked_until: null,
  }
  const data = { ...defaults, ...overrides }

  const result = await query(
    `INSERT INTO cinema_admin_user (name, email, password, role, is_verified, email_verified, is_active, auth_providers, account_locked_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [data.name, data.email, data.password, data.role, data.is_verified, data.email_verified, data.is_active, data.auth_providers, data.account_locked_until]
  )
  return result.rows[0]
}

export async function createSuperAdmin(overrides = {}) {
  return createAdmin({ ...overrides, role: 'superAdmin' })
}

/**
 * Create a fully-formed organization for an admin: org row, system roles, and
 * the owner's membership. The membership matters — resolveOrgId reads
 * organization_members, and every production path (onboarding, the db_setup
 * seed) creates it, so a fixture without one is not a realistic state.
 *
 * Returns the existing org if the admin already owns one.
 */
export async function createOrganization(adminId, overrides = {}) {
  const existing = await query(
    `SELECT id FROM organizations WHERE owner_id = $1 LIMIT 1`,
    [adminId]
  )
  if (existing.rows.length > 0) return existing.rows[0].id

  const uniqueSlug = overrides.slug
    || `test-org-${adminId.toString().slice(0, 8)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const orgResult = await query(
    `INSERT INTO organizations (name, slug, owner_id)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [overrides.name || `Test Org for ${adminId}`, uniqueSlug, adminId]
  )
  const orgId = orgResult.rows[0].id

  for (const [key, label] of [['owner', 'Owner'], ['admin', 'Admin']]) {
    await query(
      `INSERT INTO roles (org_id, key, label, is_system)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT DO NOTHING`,
      [orgId, key, label]
    )
  }

  // Grant the seeded permission sets. Without these the roles exist but hold
  // nothing, and every route behind requirePermission answers 403 — which is
  // correct behaviour, just not the state a fixture means to set up.
  await query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
     WHERE r.org_id = $1 AND r.key = 'owner'
     ON CONFLICT DO NOTHING`,
    [orgId]
  )
  await query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
     WHERE r.org_id = $1 AND r.key = 'admin'
       AND p.key NOT IN ('org.delete', 'roles.manage', 'billing.manage')
     ON CONFLICT DO NOTHING`,
    [orgId]
  )

  const ownerRole = await query(
    `SELECT id FROM roles WHERE org_id = $1 AND key = 'owner'`,
    [orgId]
  )
  if (ownerRole.rows.length > 0) {
    await query(
      `INSERT INTO organization_members (org_id, admin_id, role_id, status, joined_at)
       VALUES ($1, $2, $3, 'active', now())
       ON CONFLICT DO NOTHING`,
      [orgId, adminId, ownerRole.rows[0].id]
    )
  }

  return orgId
}

export async function createHall(adminId, overrides = {}) {
  const defaults = {
    name: 'Test Cinema Hall',
    location: 'Test City',
    district: 'Test District',
    state: 'Test State',
    is_active: true,
  }
  const data = { ...defaults, ...overrides }

  const orgId = data.org_id || await createOrganization(adminId)

  const result = await query(
    `INSERT INTO cinema_hall (admin_id, org_id, name, location, district, state, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [adminId, orgId, data.name, data.location, data.district, data.state, data.is_active]
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
    `INSERT INTO screens (cinema_hall_id, name, capacity, layout)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING *`,
    [hallId, data.name, data.capacity, data.layout]
  )
  return result.rows[0]
}

export async function createMovie(overrides = {}) {
  const defaults = {
    title: 'Test Movie',
    language: '{English}',
    genre: '{Action}',
    duration: 120,
    poster_url: 'https://example.com/poster.jpg',
    rating: '7.5',
    status: 'now_showing',
  }
  const data = { ...defaults, ...overrides }

  const result = await query(
    `INSERT INTO movies (title, language, genre, duration, poster_url, rating, status)
     VALUES ($1, $2::text[], $3::text[], $4, $5, $6, $7)
     RETURNING *`,
    [data.title, data.language, data.genre, data.duration, data.poster_url, data.rating, data.status]
  )
  return result.rows[0]
}

export async function createShow(screenId, movieId, overrides = {}) {
  const now = new Date(Date.now() + 86400000)
  const dateStr = now.toISOString().split('T')[0]
  const defaults = {
    show_date: dateStr,
    start_time: '10:00:00',
    end_time: '12:30:00',
    price: 200,
    status: 'scheduled',
    language_version: 'Original',
  }
  const data = { ...defaults, ...overrides }

  const result = await query(
    `INSERT INTO shows (screen_id, movie_id, show_date, start_time, end_time, price, status, language_version)
     VALUES ($1, $2, $3, $4::time, $5::time, $6, $7, $8)
     RETURNING *`,
    [screenId, movieId, data.show_date, data.start_time, data.end_time, data.price, data.status, data.language_version]
  )
  return result.rows[0]
}

export async function createCustomer(overrides = {}) {
  const defaults = {
    name: 'Test Customer',
    email: `customer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`,
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
    order_id: `order_${Date.now()}`,
    amount: 400,
    status: 'created',
    seats: JSON.stringify(['A1', 'A2']),
  }
  const data = { ...defaults, ...overrides }

  const result = await query(
    `INSERT INTO payment_orders (show_id, customer_id, order_id, amount, status, seats)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING *`,
    [showId, customerId, data.order_id, data.amount, data.status, data.seats]
  )
  return result.rows[0]
}

export async function createSetting(key, value) {
  const orgCheck = await query(`SELECT id FROM organizations LIMIT 1`);
  let orgId;
  if (orgCheck.rows.length > 0) {
    orgId = orgCheck.rows[0].id;
  } else {
    const orgResult = await query(
      `INSERT INTO organizations (name, slug)
       VALUES ('Default Org', 'default-org')
       RETURNING id`
    );
    orgId = orgResult.rows[0].id;
  }

  const current = await query(`SELECT value FROM organization_settings WHERE org_id = $1 AND section = 'payment'`, [orgId]);
  let merged = current.rows[0]?.value || {
    convenience_fee: { model: 'per_ticket', amount: 15 },
    gst_percentage: 18,
    gst_applies_to: 'convenience_fee',
    state_taxes: []
  };

  if (key === 'convenience_fee_per_ticket') {
    merged.convenience_fee = { model: 'per_ticket', amount: parseFloat(value) };
  } else if (key === 'gst_percentage') {
    merged.gst_percentage = parseFloat(value);
  }

  await query(
    `INSERT INTO organization_settings (org_id, section, value)
     VALUES ($1, 'payment', $2::jsonb)
     ON CONFLICT (org_id, section) DO UPDATE SET value = EXCLUDED.value`,
    [orgId, JSON.stringify(merged)]
  );

  return { key, value };
}

export async function createOrgSetting(orgId, section, value) {
  const result = await query(
    `INSERT INTO organization_settings (org_id, section, value) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (org_id, section) DO UPDATE SET value = EXCLUDED.value
     RETURNING *`,
    [orgId, section, JSON.stringify(value)]
  )
  return result.rows[0]
}

export async function createOffer(hallId, adminId, overrides = {}) {
  const defaults = {
    code: `OFFER${Date.now()}`,
    title: 'Test Offer',
    discount_type: 'percentage',
    discount_value: 10,
    max_discount_amount: 50,
    min_booking_amount: 100,
    valid_until: new Date(Date.now() + 86400000 * 30).toISOString(),
    is_active: true,
    scope: 'global',
  }
  const data = { ...defaults, ...overrides }

  const result = await query(
    `INSERT INTO offers (cinema_hall_id, created_by, code, title, discount_type, discount_value, max_discount_amount, min_booking_amount, valid_until, is_active, scope)
     VALUES ($1, $2, UPPER($3), $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [hallId, adminId, data.code, data.title, data.discount_type, data.discount_value, data.max_discount_amount, data.min_booking_amount, data.valid_until, data.is_active, data.scope]
  )
  return result.rows[0]
}
