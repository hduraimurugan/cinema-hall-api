# Cinema Hall API — Test Suite Guide

**352 tests across 30 files — all passing.**

## Quick Start

```bash
npm test              # Interactive watch mode
npm run test:run      # Single run (CI-friendly)
npm run test:coverage # With coverage report (thresholds enforced)
```

Run a single file:

```bash
npx vitest run tests/unit/controllers/booking.test.js
npx vitest run tests/integration/api.test.js
```

## Test Infrastructure

### Database

Dedicated PostgreSQL database `cinema_hall_test` (configured in `tests/setup/env.js`).

| File | Purpose |
|------|---------|
| `tests/setup/globalSetup.js` | Drops all tables, runs `schema.sql` once per run |
| `tests/setup/globalTeardown.js` | Cleans up after all tests |
| `tests/setup/env.js` | Sets `NODE_ENV=test`, test DB URL, fake API keys |
| `tests/setup/schema.sql` | Consolidated schema (20+ tables) |
| `tests/setup/db.js` | `getPool()`, `query()`, `getClient()`, helpers |

### Factories (`tests/setup/factories.js`)

| Factory | Table | Uniqueness |
|---------|-------|------------|
| `createAdmin()` | `cinema_admin_user` | Email: `Date.now()` + random suffix |
| `createSuperAdmin()` | `cinema_admin_user` | Role: `superAdmin` |
| `createHall(adminId)` | `cinema_hall` | — |
| `createScreen(hallId)` | `screens` | Layout as JSON |
| `createMovie()` | `movies` | Genre/language as `text[]` |
| `createShow(screenId, movieId)` | `shows` | Checks overlap |
| `createCustomer()` | `customers` | Email: random suffix |
| `createBooking(customerId, showId)` | `bookings` | — |
| `createPaymentOrder(showId, customerId)` | `payment_orders` | — |
| `createSetting(key, value)` | `settings` | Upsert |
| `createOffer(hallId, adminId)` | `offers` | Code: auto-generated |

### Mocks (`tests/mocks/`)

| File | Service | What It Replaces |
|------|---------|-----------------|
| `razorpay.js` | Razorpay payments | `orders.create`, `payments.refund` |
| `oauth.js` | OAuth providers | Google OAuth flow |
| `email.js` | Nodemailer | Email transport |

### Configuration (`vitest.config.js`)

```js
{
  globals: true,
  environment: 'node',
  globalSetup: './tests/setup/globalSetup.js',
  globalTeardown: './tests/setup/globalTeardown.js',
  setupFiles: './tests/setup/env.js',
  testMatch: ['tests/**/*.test.js'],
  coverage: {
    provider: 'v8',
    include: ['controllers/**', 'middleware/**', 'utils/**'],
    exclude: ['**/generateTokenAndSetCookie.js', '**/oauthProviders.js'],
    thresholds: { statements: 75, branches: 65, functions: 80, lines: 75 },
  },
}
```

---

## Test Coverage by Phase

### Phase 1 — Infrastructure (Setup)

- Vitest + global setup/teardown
- Consolidated `schema.sql` (20+ tables, indexes, constraints)
- Factory functions with real PG-generated UUIDs
- Mock factories for Razorpay, OAuth, Nodemailer

### Phase 2 — Utils (23 tests)

| File | Tests | What It Covers |
|------|-------|----------------|
| `hashToken.test.js` | 5 | Token hashing, comparison, edge cases |
| `passwordPolicy.test.js` | 12 | Password strength, validation rules, all error paths |
| `oauthRateLimit.test.js` | 6 | Rate limit window, reset, max attempts |

**Pattern**: Mock `db.js` via `vi.mock`. Pure function tests.

### Phase 3 — Middleware (30 tests)

| File | Tests | What It Covers |
|------|-------|----------------|
| `verifyCinemaAdmin.test.js` | 30 | All 8 exported middleware functions: access token, refresh token, super admin, customer, cinema hall, screen ownership, customer refresh |

**Pattern**: Mock `db.js`. Test each middleware's decision paths (pass/next vs error response).

### Phase 4A — Simple Controllers (47 tests)

| File | Tests | Functions Tested |
|------|-------|-----------------|
| `settings.test.js` | 7 | `getSettings`, `updateSettings` |
| `halls.test.js` | 10 | `getMyHalls`, `createHall`, `updateHall`, `deleteHall` |
| `ads.test.js` | 11 | CRUD + `getActiveAds`, `recordClick`, `getAdClicks` |
| `customers.test.js` | 5 | `getAllCustomers`, `getCustomerDetails` |
| `screens.test.js` | 7 | `createScreen`, `getMyScreens`, `editScreen`, `deleteScreen` |
| `refund.test.js` | 7 | `getRefunds`, `getRefundByBooking`, `manuallySettleRefund` |

### Phase 4B — Medium Controllers (76 tests)

| File | Tests | Functions Tested |
|------|-------|-----------------|
| `movies.test.js` | 19 | CRUD, bulk create/delete, `getMovieShows`, server errors |
| `offers.test.js` | 13 | CRUD, `getAllCinemaHalls`, duplicate code, validation |
| `userMovies.test.js` | 18 | Filtering, sorting, search, pagination, upcoming/now-showing |
| `dashboard.test.js` | 7 | Admin dashboard, sales analytics, booking trends, occupancy, revenue |
| `tmdb.test.js` | 10 | TMDB proxy endpoints (search, popular, trending, details, credits) |
| `otp.test.js` | 9 | `sendOtp`, `verifyOtp` — rate limiting, expiration, attempts |

### Phase 4C — Auth Controllers (68 tests)

| File | Tests | What It Covers |
|------|-------|----------------|
| `auth.test.js` | 45 | Admin register, login, email verification, password reset, OAuth (Google/GitHub), provider linking, sessions |
| `customerAuth.test.js` | 23 | Customer register, login, profile update, password change, OTP reset, Google OAuth |

**Strategy**: Real DB for SQL, mocked `jsonwebtoken`, `generateTokenAndSetCookie`, OAuth providers, email. Real `bcrypt`, `crypto`, `hashToken`.

### Phase 4D — Complex Controllers (45 tests)

| File | Tests | Functions Tested |
|------|-------|-----------------|
| `booking.test.js` | 16 | `holdSeats`, `confirmBooking`, `releaseSeats`, `getMyBookings`, `verifyBookingById`, `getBookingDetails`, `getCinemaHallBookings` |
| `shows.test.js` | 19 | CRUD, bulk create, `getShowsByDate`, `getShowById`, `cancelShow`, `updateShowBookingStatus`, `bulkOpenBooking`, `getShowBookingCount` |
| `payment.test.js` | 10 | `createOrder`, `verifyPayment`, `getPaymentOrders`, `handleWebhook` |

**External mocks**: Razorpay (orders.create, payments.refund), `validateOfferCode`. Real `crypto` for HMAC signature computation.

**Bugs fixed**: `ANY(b.seats)` → `IN (SELECT jsonb_array_elements_text(...))` on JSONB columns; missing `payment_signature` column; non-unique index on `bookings(payment_id)`.

### Phase 5 — Integration (7 tests)

| File | Tests | What It Covers |
|------|-------|----------------|
| `api.test.js` | 7 | Public routes (`/ping`, `/`, 404), protected routes with mocked auth (`/api/halls`, `/api/auth/me`, `/api/settings`), error handling (`/debug-sentry`) |

**Pattern**: Middleware mocked via `vi.mock` **before** importing `app` from `server.js`. Supertest for HTTP request/response.

```js
let currentAdminId = null

vi.mock('../../middleware/verifyCinemaAdmin.js', () => ({
  verifyCinemaAdminAccessToken: (req, res, next) => {
    req.admin = { id: currentAdminId, role: 'admin' }
    next()
  },
  // ...
}))

import app from '../../server.js'
```

### Phase 6 — Edge Case & Concurrency (53 tests)

| File | Tests | What It Covers |
|------|-------|----------------|
| `booking-concurrency.test.js` | 3 | Concurrent `holdSeats` (FOR UPDATE serialization), concurrent `confirmBooking` |
| `booking-edge.test.js` | 7 | Empty seats, partial rollback, nonexistent seat, not-held seat, wrong-owner release, duplicate release idempotency |
| `shows-edge.test.js` | 14 | Invalid UUID, missing screen_id, overlapping time slots, ended/cancelled show guards, expired held seats in layout, zero booking counts |
| `payment-edge.test.js` | 5 | Expired hold, already-paid order idempotency (`_idempotent: true`), unknown webhook event, pagination bounds |

### Phase 7 — Coverage Tuning (24 tests)

| File | Tests | Coverage Gaps Filled |
|------|-------|---------------------|
| `offers-coverage.test.js` | 13 | `validateOfferCode` (all 8 paths — unmocked), `getActiveOffers` eligibility filter, `validateOffer` endpoint errors |
| `shows-coverage.test.js` | 6 | `bulkCancelShows` (mixed states, refunds), `bulkRestoreShows`, `updateShowStatuses` |
| `booking-coverage.test.js` | 5 | `cleanupExpiredHolds`, `getCinemaHallBookings` filters, `getBookingByPaymentId` 404 |

---

## Test Patterns

### Controller Test (Real DB)

```js
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { getPool } from '../../setup/db.js'
import { createAdmin, createHall } from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import { getMyHalls } from '../../../controllers/halls.Controller.js'

function mockReqRes(overrides = {}) {
  const req = { body: {}, params: {}, query: {}, admin: { id: 'none' }, ...overrides }
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
  expect(res.json.mock.calls[0][0].halls).toHaveLength(1)
})
```

### Mocking External Services

```js
const mockRazorpayOrdersCreate = vi.hoisted(() => vi.fn())

vi.mock('razorpay', () => {
  function MockRazorpay() {
    return {
      orders: { create: mockRazorpayOrdersCreate },
      payments: { refund() { return Promise.resolve({ id: 'rfp_test' }) } },
    }
  }
  return { default: MockRazorpay }
})
```

### Concurrency Test Pattern

```js
const results = await Promise.allSettled([
  (async () => {
    const { req, res } = mockReqRes({ customer: { id: customerA.id }, body: { ... } })
    await holdSeats(req, res)
    return { status: res.status.mock.calls[0]?.[0] }
  })(),
  (async () => {
    const { req, res } = mockReqRes({ customer: { id: customerB.id }, body: { ... } })
    await holdSeats(req, res)
    return { status: res.status.mock.calls[0]?.[0] }
  })(),
])

const successes = results.filter(r => r.status === 'fulfilled' && r.value.status === 200)
expect(successes.length).toBe(1)
```

---

## Coverage Report

```text
         | % Stmts | % Branch | % Funcs | % Lines
---------|---------|----------|---------|---------
Overall  |   77.54 |    69.43 |    86.8 |   78.69
controllers | 76.51 |    68.23 |   87.86 |   77.71
middleware  |  92.1 |    95.65 |   76.92 |    92.1
utils       | 90.38 |    76.92 |   81.81 |   90.38
```

Thresholds enforced in CI: Statements ≥75%, Branches ≥65%, Functions ≥80%, Lines ≥75%.

---

## Adding New Tests

1. Create file in `tests/unit/controllers/`, `tests/unit/middleware/`, `tests/unit/utils/`, or `tests/integration/`
2. For controller tests: import `getPool`, use factories, mock logger
3. For integration tests: mock middleware before importing `app`, use Supertest
4. Run in isolation: `npx vitest run tests/unit/controllers/my-test.test.js`
5. Run full suite before committing: `npm run test:run`

### Cleanup Rules

- Each `afterEach` cleans only the tables touched by that test file
- Factory-created data in `beforeAll` is preserved across tests in the same file
- The global teardown drops all tables after the full run completes
