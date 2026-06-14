# Cinema Hall API — Test Suite

## Overview

Automated test suite for the cinema-hall-api backend (Express 5 + PostgreSQL ESM).

**Test runner**: [Vitest](https://vitest.dev/) v4  
**HTTP testing**: [Supertest](https://github.com/ladjs/supertest)  
**Coverage**: [@vitest/coverage-v8](https://www.npmjs.com/package/@vitest/coverage-v8)

## Test Strategy

| Layer | Approach | DB |
|-------|----------|-----|
| **Utils** (hashToken, passwordPolicy, oauthRateLimit) | Mock `db.js` via `vi.mock` | ❌ |
| **Middleware** (verifyCinemaAdmin) | Mock `db.js` via `vi.mock` | ❌ |
| **Controllers** (simple → complex) | Real test DB via `tests/setup/db.js` | ✅ |
| **Integration** (full request-response) | Real test DB + Supertest | ✅ |

- External services (Razorpay, Nodemailer, OAuth, TMDB) are mocked via `tests/mocks/`
- Token helper (`generateTokenAndSetCookie`) mocks `db.js` directly (no source refactoring)

## Test Infrastructure

### Database

Dedicated PostgreSQL database: `cinema_hall_test`

```
postgresql://postgres:Durai@1234@localhost:5432/cinema_hall_test
```

> Note: Password contains `@` — `pg-connection-string` correctly handles this by splitting on last `@`.

| File | Role |
|------|------|
| `tests/setup/globalSetup.js` | Drops all tables/functions, runs consolidated `schema.sql` |
| `tests/setup/globalTeardown.js` | Drops all tables/functions after all tests |
| `tests/setup/env.js` | Sets `NODE_ENV=test`, test DB URL, fake API keys |
| `tests/setup/schema.sql` | Consolidated schema (20+ tables, all migration columns) |
| `tests/setup/db.js` | `getPool()`, `query()`, `getClient()`, `cleanupTable()`, `cleanupAll()`, `closePool()` |

### Factories

`tests/setup/factories.js` provides factory functions for inserting test data:

| Factory | Tables Populated |
|---------|-----------------|
| `createAdmin()` | `cinema_admin_user` |
| `createSuperAdmin()` | `cinema_admin_user` (role: superAdmin) |
| `createHall(adminId)` | `cinema_hall` |
| `createScreen(hallId)` | `screens` |
| `createMovie()` | `movies` |
| `createShow(screenId, movieId)` | `shows` |
| `createCustomer()` | `customers` |
| `createBooking(customerId, showId)` | `bookings` |
| `createPaymentOrder(showId, customerId)` | `payment_orders` |
| `createSetting(key, value)` | `settings` (upsert) |
| `createOffer(hallId, adminId)` | `offers` |

Factory conventions:
- Unique emails use `Date.now()` + random suffix to avoid collisions across test files
- UUIDs use real PG-generated values (no `'other-id'` strings)
- Arrays stored as `text[]` or `jsonb` per schema (e.g., `genre::text[]`)

### Mocks

`tests/mocks/` provides mock factory functions for external services:

| File | Service | Functions |
|------|---------|-----------|
| `razorpay.js` | Razorpay payments | `setupRazorpayMock()`, `resetRazorpayMocks()` |
| `oauth.js` | OAuth providers | Google OAuth mock |
| `email.js` | Nodemailer | Email transport mock |

## Running Tests

```bash
npm test              # Interactive (watch mode)
npm run test:run      # Single run
npm run test:watch    # Explicit watch mode
npm run test:coverage # With coverage report
```

Run specific file:
```bash
npx vitest run tests/unit/controllers/settings.test.js
npx vitest run tests/unit/middleware/verifyCinemaAdmin.test.js
```

## Configuration (`vitest.config.js`)

```js
{
  globals: true,
  environment: 'node',
  globalSetup: ['./tests/setup/globalSetup.js'],
  globalTeardown: ['./tests/setup/globalTeardown.js'],
  setupFiles: ['./tests/setup/env.js'],
  testMatch: ['tests/**/*.test.js'],
  coverage: {
    provider: 'v8',
    reporter: ['text', 'html', 'lcov'],
    include: ['controllers/**', 'middleware/**', 'utils/**'],
  },
  hookTimeout: 30000,
  testTimeout: 15000,
}
```

## Test Patterns

### Utils / Middleware (Mocked DB)

```js
import { vi, describe, it, expect } from 'vitest'

vi.mock('../../db.js', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}))

import { myUtil } from '../../utils/myUtil.js'

describe('myUtil', () => {
  it('handles success', async () => {
    // Mock returns what you need
    const result = await myUtil(input)
    expect(result).toBe(expected)
  })
})
```

### Controllers (Real DB)

```js
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { getPool } from '../../setup/db.js'
import { createAdmin } from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import { getMyHalls } from '../../../controllers/halls.Controller.js'

function mockReqRes(overrides = {}) {
  const req = { body: {}, params: {}, admin: { id: 'none' }, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

let admin
beforeAll(async () => { admin = await createAdmin() })
afterEach(async () => {
  const p = getPool()
  await p.query(`DELETE FROM cinema_hall WHERE admin_id = $1`, [admin.id])
})

it('returns halls owned by admin', async () => {
  const { req, res } = mockReqRes({ admin: { id: admin.id } })
  await getMyHalls(req, res)
  expect(res.status).toHaveBeenCalledWith(200)
  expect(res.json.mock.calls[0][0].halls).toHaveLength(1)
})
```

### Mock Pattern (Controller test)

```js
function mockReqRes(overrides = {}) {
  const req = { body: {}, params: {}, query: {}, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}
```

Key: Many controllers use `res.json(...)` without explicit `res.status(200)`. Tests check `res.json` body directly instead of asserting `res.status(200).toHaveBeenCalled()`.

## Progress

### Status

| Phase | Description | Tests | Status |
|-------|-------------|-------|--------|
| 1 | Infrastructure (vitest, DB, schema, factories, mocks) | — | ✅ Done |
| 2 | Utils (hashToken 5, passwordPolicy 12, oauthRateLimit 6) | **23/23** | ✅ Passing |
| 3 | Middleware (verifyCinemaAdmin — 8 exports) | **30/30** | ✅ Passing |
| 4A | Simple controllers (settings 7, halls 10, ads 11, customers 5, screens 7, refund 7) | **47/47** | ✅ Passing |
| 4B | Medium controllers (movies 19, offers 13, userMovies 18, dashboard 7, tmdb 10, otp 9) | **76/76** | ✅ Passing |
| 4C | Auth controllers (auth 45, customerAuth 23) | **68/68** | ✅ Passing |
| 4D | Complex controllers (booking 16, shows 19, payment 10) | **45/45** | ✅ Passing |
| 5 | Integration (full request-response via Supertest) | **7/7** | ✅ Passing |
| 6 | Edge case & concurrency | — | ❌ Not started |
| 7 | Coverage tuning | — | ❌ Not started |

### Phase 2 — Utils (23/23)

| File | Tests | Description |
|------|-------|-------------|
| `hashToken.test.js` | 5 | Token hashing and comparison |
| `passwordPolicy.test.js` | 12 | Password strength, validation rules, edge cases |
| `oauthRateLimit.test.js` | 6 | OAuth rate limiting logic |

### Phase 3 — Middleware (30/30)

| File | Tests | Description |
|------|-------|-------------|
| `verifyCinemaAdmin.test.js` | 30 | All 8 exported middleware functions (auth, roles, hall access, etc.) |

### Phase 4A — Simple Controllers (47/47)

| File | Tests | Description |
|------|-------|-------------|
| `settings.test.js` | 7 | `getSettings` (1), `updateSettings` (6) — validation + DB update |
| `halls.test.js` | 10 | `getMyHalls` (2), `createHall` (3), `updateHall` (3), `deleteHall` (2) |
| `ads.test.js` | 11 | `getAllAds` (2), `createAd` (2), `updateAd` (2), `deleteAd` (1), `getActiveAds` (2), `recordClick` (1), `getAdClicks` (1) |
| `customers.test.js` | 5 | `getAllCustomers` (3), `getCustomerDetails` (2) |
| `screens.test.js` | 7 | `createScreen` (1), `getMyScreens` (1), `editScreen` (3), `deleteScreen` (2) |
| `refund.test.js` | 7 | `getRefunds` (2 — empty list + filter), `getRefundByBooking` (2), `manuallySettleRefund` (3) |

### Phase 4B — Medium Controllers (76/76)

| File | Tests | Description |
|------|-------|-------------|
| `movies.test.js` | 19 | `getAllMovies` (3), `getMovieById` (2), `createMovie` (2), `updateMovie` (2), `deleteMovie` (1), `bulkCreateMovies` (3), `bulkDeleteMovies` (2), `getMovieShows` (2), server error paths (2) |
| `offers.test.js` | 13 | `getAllCinemaHalls` (1), `getAllOffers` (1), `createOffer` (5), `getOfferById` (2), `updateOffer` (2), `deleteOffer` (2) |
| `userMovies.test.js` | 18 | End-user movie browsing: filtering, sorting, search, pagination, upcoming/now-showing |
| `dashboard.test.js` | 7 | `getAdminDashboard`, `getSalesAnalytics`, `getBookingTrends`, `getMovieStats`, `getHallOccupancy`, `getRevenueSummary`, `getAdminNotifications` |
| `tmdb.test.js` | 10 | TMDB proxy endpoints: search movies, popular, trending, details, credits, recommendations |
| `otp.test.js` | 9 | `sendOtp`, `verifyOtp` — rate limiting, expiration, attempts, verified OTP reuse + server error path |

### Phase 4C — Auth Controllers (68/68)

| File | Tests | Description |
|------|-------|-------------|
| `auth.test.js` | 45 | Admin auth: register, login, email verification, password reset, OAuth (Google/GitHub), provider linking, security info, session management, hall updates |
| `customerAuth.test.js` | 23 | Customer auth: register, login, profile updates, password change, OTP-based password reset, Google OAuth, set password |

Auth test strategy:
- Real DB for SQL queries (same pattern as Phase 4A/B)
- Mocked: `jsonwebtoken`, `generateTokenAndSetCookie`, `oauthProviders`, `oauthRateLimit`, email functions, `logger`
- Real: `bcrypt`, `hashToken`, `validatePassword`, `crypto`
- Dedicated shared admin/customer created in `beforeAll` for login/refresh/getMe tests
- Each `afterEach` cleans auth tables (`admin_security_logs`, `admin_password_reset_tokens`, `admin_verification_tokens`, `admin_sessions`)
- OTP-based password reset tested by inserting known SHA-256 hashed OTPs

### Phase 4D — Complex Controllers (45/45)

| File | Tests | Description |
|------|-------|-------------|
| `booking.test.js` | 16 | `holdSeats` (4), `confirmBooking` (4), `releaseSeats` (1), `getMyBookings` (2), `verifyBookingById` (3), `getBookingDetails` (2) |
| `shows.test.js` | 19 | `createShow` (2), `createMultipleShows` (2), `editShow` (2), `deleteShow` (1), `deleteMultipleShows` (2), `getShowsByDate` (1), `getShowById` (2), `updateShowBookingStatus` (3), `cancelShow` (2), `bulkOpenBooking` (1), `getShowBookingCount` (1) |
| `payment.test.js` | 10 | `createOrder` (4 — success, no-hold, dedup, offer), `verifyPayment` (2 — success, bad sig), `getPaymentOrders` (2), `handleWebhook` (2 — bad sig, captured event) |

Key details:
- All external services mocked: `razorpay` (orders create, payments refund), `crypto` (native, used for HMAC), `validateOfferCode`
- Settings `convenience_fee_per_ticket` and `gst_percentage` seeded in `beforeAll` for pricing tests
- `cancelShow` test verifies both the mock refund call AND the DB refund record
- Webhook tests pass a `Buffer` as `req.body` to match `express.raw()` middleware

#### Source Bugs Fixed in Phase 4D

| Bug | Location | Fix |
|-----|----------|-----|
| `ANY(b.seats)` on JSONB | booking & refund controllers | Replaced with `IN (SELECT jsonb_array_elements_text(b.seats))` |
| JS array passed as JSONB param | `payment.Controller.js` `verifyPayment` | Added `JSON.stringify(seats)` for the bookings INSERT |
| Missing `payment_signature` column | `schema.sql` `payment_orders` table | Added `payment_signature TEXT` column |
| Non-unique index on `bookings(payment_id)` | `schema.sql` | Changed to `CREATE UNIQUE INDEX` for `ON CONFLICT (payment_id)` |

### Phase 5 — Integration (7/7)

| File | Tests | Description |
|------|-------|-------------|
| `api.test.js` | 7 | Public routes (ping, root, 404), protected routes with mocked auth (halls, auth/me, settings), error handling (/debug-sentry) |

Integration test strategy:
- Uses real test DB via `tests/setup/db.js`
- Middleware (`verifyCinemaAdmin.js`) mocked at module level via `vi.mock` to inject test admin/customer data without token verification
- All external services mocked: Razorpay, Sentry, logger
- `server.js` auto-listens on `PORT=0` (random OS-assigned port) — Supertest creates its own server, so the `app.listen` call is harmless
- Admin + hall seeded in `beforeAll` via factories for protected route tests
- Halls test creates its own admin + halls, cleans up, restores original admin/hall for subsequent tests

#### Key Mocking Pattern (Integration)

Middleware is mocked BEFORE importing `app` from `server.js`:

```js
let currentAdminId = null

vi.mock('../../middleware/verifyCinemaAdmin.js', () => ({
  verifyCinemaAdminAccessToken: (req, res, next) => {
    req.admin = { id: currentAdminId || '00000000-0000-0000-0000-000000000000', role: 'admin' }
    next()
  },
  // ...
}))

import app from '../../server.js'
```

This pattern allows tests to set `currentAdminId` to a real DB-inserted admin UUID before hitting protected routes.

### Known Issues

1. **`requireActiveHall` middleware**: `pool.connect()` is called outside try-catch — unhandled rejection on connection failure.
2. **Controller res.status pattern**: Many controllers call `res.json()` without `res.status(200)`, relying on Express default 200. Tests compensate by checking `res.json` body instead.
3. **`movies.Controller.js` missing `logger` import**: `logger.error()` in catch blocks throws `ReferenceError` before `res.status(500)` can be called.
4. **Auth test password mutation**: Tests that modify the shared admin's password (e.g., `changePassword` success test) mutate state for subsequent tests in the same describe block. Mitigated by ordering tests so error-path tests run after success-path tests.

### Fixes Applied

| Issue | Fix |
|-------|-----|
| Schema missing `latitude`/`longitude` | Added to `cinema_hall` in `schema.sql` |
| Factory `createScreen` wrong column | `hall_id` → `cinema_hall_id` |
| Factory `createMovie` type mismatch | Genre/language cast as `text[]` instead of `jsonb` |
| Factory `createShow` column mismatch | Uses `show_date`/`start_time`/`end_time` |
| Factory `createPaymentOrder` | Uses `order_id` + `seats`, removed non-existent `currency` |
| Factory `createAdmin`/`createCustomer` emails | Added random suffix for uniqueness |
| UUID format in tests | Replaced `'other-id'` with `'00000000-...'` UUIDs |
| Import naming conflicts | Renamed `createHall`/`createAd` imports to avoid shadowing factories |
| `res.status(200)` assertions | Removed for controllers that call `res.json()` without explicit status |
| `ANY(b.seats)` on JSONB (dashboard + booking + refund) | Changed to `IN (SELECT jsonb_array_elements_text(b.seats))` |
| JS array → JSONB in `verifyPayment` | `JSON.stringify(seats)` before passing to pg |
| Factory `createMovie` missing `status` | Added `status` column to INSERT |
| Factory columns mismatched | Added `district`/`state` to `createHall`; fixed `createOffer` column names to match schema |
| `otp_verifications` missing UNIQUE constraint | Added `UNIQUE (email, type)` — required by `ON CONFLICT (email, type)` |
| Factory `createAdmin` missing `email_verified` | Added `email_verified` and `account_locked_until` columns to INSERT |
| Factory `createAdmin` missing `auth_providers` | Added `auth_providers` column to INSERT for provider link/unlink tests |
| Missing `payment_signature` column | Added to `payment_orders` table in `schema.sql` |
| Non-unique index on `bookings(payment_id)` | Replaced with `CREATE UNIQUE INDEX` for `ON CONFLICT` support |

## Adding New Tests

1. Create test file in `tests/unit/controllers/` (controllers) or `tests/unit/utils/` (utils)
2. For controller tests that use real DB:
   - Import `getPool` from `../../setup/db.js`
   - Import factories from `../../setup/factories.js`
   - Mock logger: `vi.mock('../../../utils/logger.js', ...)`
   - Use `beforeAll` to seed data, `afterEach` to clean
   - Use `mockReqRes()` pattern for controller invocation
3. Run the test file in isolation first
4. Run full suite when confident
