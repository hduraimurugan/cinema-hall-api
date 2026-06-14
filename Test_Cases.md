# Cinema Hall API — Test Cases Reference

**352 tests across 30 files — all passing.**

## Test Suite Structure

```
tests/
├── setup.test.js                          # DB schema smoke tests (3 tests)
├── TESTING.md                             # Internal testing guide
├── setup/
│   ├── env.js                             # NODE_ENV=test, test DB URL, fake API keys
│   ├── db.js                              # getPool(), query(), getClient(), cleanup helpers
│   ├── globalSetup.js                     # Drops all tables, runs schema.sql once per run
│   ├── globalTeardown.js                  # Cleans up after all tests
│   ├── schema.sql                         # Consolidated schema (20+ tables)
│   └── factories.js                       # 11 factory functions for test data
├── mocks/
│   ├── razorpay.js                        # Razorpay orders.create, payments.refund
│   ├── oauth.js                           # Google OAuth provider mock
│   └── email.js                           # Nodemailer transport mock
├── integration/
│   └── api.test.js                        # Full HTTP request-response tests (7 tests)
└── unit/
    ├── middleware/
    │   └── verifyCinemaAdmin.test.js      # 8 middleware functions (30 tests)
    └── utils/
        ├── hashToken.test.js              # Token hashing (5 tests)
        ├── passwordPolicy.test.js         # Password validation (12 tests)
        └── oauthRateLimit.test.js         # OAuth rate limiting (6 tests)
        └── controllers/
            ├── settings.test.js           # Settings CRUD (7 tests)
            ├── halls.test.js              # Hall CRUD (10 tests)
            ├── ads.test.js                # Ads CRUD + clicks (11 tests)
            ├── customers.test.js          # Customer listing (5 tests)
            ├── screens.test.js            # Screen CRUD (7 tests)
            ├── refund.test.js             # Refund queries (7 tests)
            ├── movies.test.js             # Movie CRUD + bulk (19 tests)
            ├── offers.test.js             # Offer CRUD (13 tests)
            ├── userMovies.test.js         # Movie browsing/filtering (18 tests)
            ├── dashboard.test.js          # Analytics dashboard (7 tests)
            ├── tmdb.test.js               # TMDB proxy (10 tests)
            ├── otp.test.js                # OTP send/verify (9 tests)
            ├── auth.test.js               # Admin auth (45 tests)
            ├── customerAuth.test.js       # Customer auth (23 tests)
            ├── booking.test.js            # Booking flow (16 tests)
            ├── shows.test.js              # Shows CRUD + bulk (19 tests)
            ├── payment.test.js            # Payment flow (10 tests)
            ├── booking-concurrency.test.js # Concurrent holds/confirm (3 tests)
            ├── booking-edge.test.js       # Booking edge cases (7 tests)
            ├── shows-edge.test.js         # Shows edge cases (14 tests)
            ├── payment-edge.test.js       # Payment edge cases (5 tests)
            ├── offers-coverage.test.js    # Offer coverage (13 tests)
            ├── shows-coverage.test.js     # Shows coverage (6 tests)
            └── booking-coverage.test.js   # Booking coverage (5 tests)
```

---

## Phase 1 — Infrastructure (Setup)

### Database (`tests/setup/`)

- Dedicated PostgreSQL database `cinema_hall_test`
- `globalSetup.js` — drops all existing tables, runs consolidated `schema.sql`
- `globalTeardown.js` — cleans up after all tests complete
- `env.js` — sets `NODE_ENV=test`, test DB URL, fake API keys for Razorpay, JWT, TMDB, etc.
- `db.js` — provides `getPool()`, `query()`, `getClient()`, `cleanupTable()`, `cleanupAll()`, `closePool()`

### Factories (`tests/setup/factories.js`)

| Factory | Table | Notes |
|---------|-------|-------|
| `createAdmin()` | `cinema_admin_user` | Unique email via `Date.now()` + random suffix |
| `createSuperAdmin()` | `cinema_admin_user` | Role: `superAdmin` |
| `createHall(adminId)` | `cinema_hall` | Includes `district`, `state` |
| `createScreen(hallId)` | `screens` | Layout as JSON string |
| `createMovie()` | `movies` | Genre/language as `text[]`, includes `status` |
| `createShow(screenId, movieId)` | `shows` | Future date, checks overlap |
| `createCustomer()` | `customers` | Unique email |
| `createBooking(customerId, showId)` | `bookings` | Optional `overrides` for status, amount |
| `createPaymentOrder(showId, customerId)` | `payment_orders` | Seeds `order_id`, `seats` |
| `createSetting(key, value)` | `settings` | Upsert via `ON CONFLICT` |
| `createOffer(hallId, adminId)` | `offers` | Auto-generated code |

### Mocks (`tests/mocks/`)

| File | Service | Mocks |
|------|---------|-------|
| `razorpay.js` | Razorpay | `orders.create`, `orders.fetch`, `payments.fetch`, `payments.refund` |
| `oauth.js` | OAuth | `verifyGoogleToken`, `exchangeGithubCode`, `getGithubUser` |
| `email.js` | Nodemailer | `createTransport`, `sendMail` |

### Configuration (`vitest.config.js`)

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
    include: ['controllers/**', 'middleware/**', 'utils/**'],
    thresholds: { statements: 75, branches: 65, functions: 80, lines: 75 },
  },
  hookTimeout: 30000,
  testTimeout: 15000,
}
```

### Setup Smoke Tests (`setup.test.js`)

| # | Test | What It Verifies |
|---|------|-----------------|
| 1 | `has all expected tables` | 10+ tables exist in public schema |
| 2 | `has columns added by migrations` | `cinema_admin_user` has `role`, `is_verified`, `is_active` |
| 3 | `can insert and query data` | CRUD round-trip on `cinema_admin_user` |

---

## Phase 2 — Utils (23 tests)

### `hashToken.test.js` (5 tests)

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Returns hex string | Any token | `/^[a-f0-9]{64}$/` |
| 2 | Deterministic | Same input twice | Identical hashes |
| 3 | Different inputs differ | `'token-a'` vs `'token-b'` | Different hashes |
| 4 | Handles empty string | `''` | Valid 64-char hex |
| 5 | Known SHA-256 output | `'abc'` | `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` |

### `passwordPolicy.test.js` (12 tests)

| # | Test | Input | Expected Error |
|---|------|-------|----------------|
| 1 | Rejects undefined | — | `Password must be at least 8 characters.` |
| 2 | Rejects null | `null` | `Password must be at least 8 characters.` |
| 3 | Rejects < 8 chars | `'Ab1!xyz'` | `Password must be at least 8 characters.` |
| 4 | Missing lowercase | `'ABCD1234!'` | `must contain at least one lowercase letter.` |
| 5 | Missing uppercase | `'abcd1234!'` | `must contain at least one uppercase letter.` |
| 6 | Missing digit | `'Abcdefgh!'` | `must contain at least one number.` |
| 7 | Missing special char | `'Abcdefgh1'` | `must contain at least one special character.` |
| 8 | Accepts valid | `'TestPass1!'` | `null` (passes) |
| 9-11 | Various valid passwords | `'Test@123'`, etc. | `null` |
| 12 | Returns first failing check | `'Ab1!xy'` → too short | Shortest failing check message |

### `oauthRateLimit.test.js` (6 tests)

Rate limit window, reset behavior, and max attempts enforcement. Each test validates the rate limiter's state transitions and refusal to allow requests beyond configured limits within a time window.

---

## Phase 3 — Middleware (30 tests)

### `verifyCinemaAdmin.test.js` (30 tests)

All 8 exported middleware functions tested across pass/next vs error paths:

| Middleware | Tests | Key Scenarios |
|-----------|-------|---------------|
| `verifyCinemaAdminAccessToken` | 5 | Missing cookie, expired/invalid JWT, invalid signature, valid token passes |
| `verifyCinemaAdminRefreshToken` | 4 | Missing cookie, DB query fails, valid token, revoked token |
| `verifySuperAdmin` | 3 | Non-admin role rejected, superAdmin passes, no admin on request |
| `verifyCustomer` | 4 | Missing cookie, invalid JWT, valid customer, customer not found in DB |
| `verifyCustomerRefreshToken` | 3 | Missing cookie/header, valid refresh, session not found in DB |
| `verifyCinemaHall` | 4 | Missing hall ID, hall not found, hall belongs to different admin, valid hall passes |
| `verifyScreenOwnership` | 4 | Missing screen ID, screen not found, screen belongs to different hall, valid screen |
| `requireActiveHall` | 3 | Missing `currentHallId`, hall not active, active hall passes |

---

## Phase 4A — Simple Controllers (47 tests)

### `settings.test.js` (7 tests)

| Function | Tests | Scenarios |
|----------|-------|-----------|
| `getSettings` | 1 | Returns pricing settings |
| `updateSettings` | 6 | Updates fee, updates GST, updates both, rejects non-admin, server error path |

### `halls.test.js` (10 tests)

| Function | Tests | Scenarios |
|----------|-------|-----------|
| `getMyHalls` | 2 | Returns admin's halls, empty list for admin with no halls |
| `createHall` | 3 | Creates hall with valid data, rejects missing fields, rejects duplicate name |
| `updateHall` | 3 | Updates hall name, rejects unauthorized admin, rejects non-existent hall |
| `deleteHall` | 2 | Deletes own hall, rejects non-existent hall |

### `ads.test.js` (11 tests)

| Function | Tests | Scenarios |
|----------|-------|-----------|
| `getAllAds` | 2 | Returns paginated ads, empty list |
| `createAd` | 2 | Creates ad with valid data, rejects missing fields |
| `updateAd` | 2 | Updates ad, rejects non-existent ad |
| `deleteAd` | 1 | Deletes ad |
| `getActiveAds` | 2 | Returns active ads by placement, empty when none active |
| `recordClick` | 1 | Records click for valid ad |
| `getAdClicks` | 1 | Returns clicks for an ad |

### `customers.test.js` (5 tests)

| Function | Tests | Scenarios |
|----------|-------|-----------|
| `getAllCustomers` | 3 | Returns paginated list, search by name/email, empty results for non-matching search |
| `getCustomerDetails` | 2 | Returns customer by ID, 404 for unknown customer |

### `screens.test.js` (7 tests)

| Function | Tests | Scenarios |
|----------|-------|-----------|
| `createScreen` | 1 | Creates screen with layout JSON |
| `getMyScreens` | 1 | Returns screens for hall |
| `editScreen` | 3 | Updates screen name, rejects invalid layout, rejects non-existent screen |
| `deleteScreen` | 2 | Deletes screen, rejects non-existent screen |

### `refund.test.js` (7 tests)

| Function | Tests | Scenarios |
|----------|-------|-----------|
| `getRefunds` | 2 | Returns empty list, filters by status |
| `getRefundByBooking` | 2 | Returns refund for booking, 404 for non-refunded booking |
| `manuallySettleRefund` | 3 | Settles refund, rejects already settled, rejects non-existent refund |

---

## Phase 4B — Medium Controllers (76 tests)

### `movies.test.js` (19 tests)

| Function | Tests | Scenarios |
|----------|-------|-----------|
| `getAllMovies` | 3 | Returns paginated movies, filters by status, search by title |
| `getMovieById` | 2 | Returns movie by ID, 404 for unknown ID |
| `createMovie` | 2 | Creates movie, rejects missing title |
| `updateMovie` | 2 | Updates movie, rejects non-existent movie |
| `deleteMovie` | 1 | Deletes movie |
| `bulkCreateMovies` | 3 | Bulk creates, rejects empty array, partial failure rollback |
| `bulkDeleteMovies` | 2 | Bulk deletes, rejects empty array |
| `getMovieShows` | 2 | Returns shows for movie, empty for movie with no shows |
| Server error paths | 2 | Simulates DB errors for getAllMovies and getMovieById |

### `offers.test.js` (13 tests)

| Function | Tests | Scenarios |
|----------|-------|-----------|
| `getAllCinemaHalls` | 1 | Returns halls list for offer scope selector |
| `getAllOffers` | 1 | Returns paginated offers |
| `createOffer` | 5 | Creates percentage/fixed offers, rejects missing fields, invalid discount_type, invalid value ranges, duplicate code |
| `getOfferById` | 2 | Returns offer by ID, 404 for unknown |
| `updateOffer` | 2 | Updates offer, 404 for unknown |
| `deleteOffer` | 2 | Deletes offer, 404 for unknown |

### `userMovies.test.js` (18 tests)

End-user movie browsing endpoint. Tests cover:
- Filtering by language, genre, certificate
- Sorting by rating, title, release date
- Search by movie title
- Pagination (page, limit)
- Upcoming vs now-showing status filter
- Location-based theatre listing with shows
- Error handling for invalid parameters

### `dashboard.test.js` (7 tests)

| Function | Tests | Scenarios |
|----------|-------|-----------|
| `getAdminDashboard` | 1 | Today's stats + 7-day trend + recent bookings + today's shows |
| `getSalesAnalytics` | 1 | Revenue analytics with date range |
| `getBookingTrends` | 1 | Booking counts over time |
| `getMovieStats` | 1 | Per-movie booking stats |
| `getHallOccupancy` | 1 | Seat occupancy percentage |
| `getRevenueSummary` | 1 | Revenue breakdown |
| `getAdminNotifications` | 1 | Admin notification list |

### `tmdb.test.js` (10 tests)

| Endpoint | Tests | Scenarios |
|----------|-------|-----------|
| Search movies | 2 | Returns results, handles empty query |
| Popular movies | 2 | Returns page, handles API failure |
| Trending movies | 1 | Returns trending list |
| Movie details | 2 | Returns details, 404 for unknown ID |
| Movie credits | 2 | Returns cast/crew, handles API failure |
| Recommendations | 1 | Returns recommended movies |

### `otp.test.js` (9 tests)

| Function | Tests | Scenarios |
|----------|-------|-----------|
| `sendOtp` | 4 | Sends OTP, rate-limited (3/10min), rejects invalid email, rejects unsupported type |
| `verifyOtp` | 5 | Verifies correct OTP, rejects wrong OTP, max 5 attempts reached, expired OTP, already-verified OTP reuse, server error path |

---

## Phase 4C — Auth Controllers (68 tests)

### `auth.test.js` (45 tests)

| Area | Tests | Scenarios |
|------|-------|-----------|
| Register | 5 | Registers admin, password policy enforced, verification email sent, rejects duplicate email, server error |
| Login | 5 | Successful login, unverified blocked, locked account blocked, wrong password, server error |
| Email verification | 3 | Valid token verifies, invalid token rejected, expired token rejected |
| Forgot/reset password | 6 | Sends reset email, resets password, invalid/expired token rejects |
| Change password | 4 | Success, wrong current password, same as old rejected, password policy enforced |
| Logout | 2 | Logout revokes session, logout-all revokes all |
| Refresh token | 3 | New tokens issued, revoked session rejected, invalid token rejected |
| OAuth (Google) | 5 | Login with Google, link provider, unlink provider, duplicate link rejected |
| OAuth (GitHub) | 4 | Login with GitHub code, exchange failure, link provider, unlink provider |
| Security info | 3 | Returns sessions, logs, security timestamps |
| Get me / hall update | 3 | Returns admin profile, updates hall info, rejects missing fields |
| SuperAdmin | 2 | Lists all admins with pagination |

**Strategy**: Real DB for SQL, mocked `jsonwebtoken`, `generateTokenAndSetCookie`, `oauthProviders`, `email`. Real `bcrypt`, `crypto`, `hashToken`.

### `customerAuth.test.js` (23 tests)

| Area | Tests | Scenarios |
|------|-------|-----------|
| Register | 3 | Registers with valid data, password policy enforced, rejects duplicate email |
| Login | 4 | Successful login, wrong password, locked account, near-threshold hint |
| Profile | 3 | Get profile, update name/phone, update with invalid email |
| Change password | 4 | Success, wrong current, same as old, policy enforced |
| OTP forgot/reset | 5 | Forgot password sends OTP, resets with valid OTP, wrong OTP, expired OTP, revokes all sessions on reset |
| Google OAuth | 4 | Login with Google token, new customer created, existing linked, token fails |

---

## Phase 4D — Complex Controllers (45 tests)

### `booking.test.js` (16 tests)

| Function | Tests | Scenarios |
|----------|-------|-----------|
| `holdSeats` | 4 | Holds available seats, rejects missing show_id/seats, rollback on already-held seat, server error path |
| `confirmBooking` | 4 | Confirms held seats into booking, rejects seats held by another, rejects expired hold, rejects missing fields |
| `releaseSeats` | 1 | Releases held seats |
| `getMyBookings` | 2 | Returns customer's bookings, empty list |
| `getCinemaHallBookings` | 2 | Returns paginated bookings with stats, empty for no bookings |
| `verifyBookingById` | 3 | Valid UUID returns booking, invalid UUID format rejected, 404 for other hall's booking |
| `getBookingDetails` | 2 | Returns booking for owning customer, 404 for another customer's booking |

### `shows.test.js` (19 tests)

| Function | Tests | Scenarios |
|----------|-------|-----------|
| `createShow` | 2 | Creates show with valid data, rejects missing fields |
| `createMultipleShows` | 2 | Creates multiple shows, rejects empty times array |
| `editShow` | 2 | Updates show, rejects non-existent show |
| `deleteShow` | 1 | Deletes show |
| `deleteMultipleShows` | 2 | Deletes multiple, rejects empty array |
| `getShowsByDate` | 1 | Returns shows for date |
| `getShowById` | 2 | Returns show, returns with seat layout |
| `cancelShow` | 2 | Cancels show with refunds, rejects ended show |
| `updateShowBookingStatus` | 3 | Opens booking, closes booking, rejects invalid action |
| `bulkOpenBooking` | 1 | Opens booking for multiple shows |
| `getShowBookingCount` | 1 | Returns confirmed count + refund total |

### `payment.test.js` (10 tests)

| Function | Tests | Scenarios |
|----------|-------|-----------|
| `createOrder` | 4 | Creates order for held seats, rejects no-hold seats, deduplicates within 10min, applies offer code |
| `verifyPayment` | 2 | Verifies valid signature + confirms booking, rejects invalid signature |
| `getPaymentOrders` | 2 | Returns paginated orders, filters by status |
| `handleWebhook` | 2 | Captured event confirms booking, bad signature rejected |

**Mocked**: `razorpay` (orders.create, payments.refund), `validateOfferCode`. **Real**: `crypto` for HMAC.

---

## Phase 5 — Integration (7 tests)

### `api.test.js` (7 tests)

| # | Test | Expected |
|---|------|----------|
| 1 | `GET /ping` returns `pong` | 200, text `'pong'` |
| 2 | `GET /` returns API info | 200, `postgres` + `server` properties |
| 3 | `GET /nonexistent` returns 404 | 404 |
| 4 | `GET /api/halls` returns halls (mocked auth) | 200, halls array |
| 5 | `GET /api/auth/me` returns admin profile (mocked auth) | 200, `admin` property |
| 6 | `GET /api/settings` returns pricing settings | 200, `convenience_fee_per_ticket` + `gst_percentage` |
| 7 | `GET /debug-sentry` returns error | 500, `something went wrong` |

**Pattern**: Middleware mocked via `vi.mock` BEFORE importing `app` from `server.js`. Supertest for HTTP request/response.

---

## Phase 6 — Edge Case & Concurrency (29 tests)

### `booking-concurrency.test.js` (3 tests)

| # | Test | Scenario |
|---|------|----------|
| 1 | Same seat, concurrent `holdSeats` | Two customers try holding the same seat → exactly 1 succeeds (200), 1 gets 409 |
| 2 | Non-existent seat, concurrent `holdSeats` | Race condition: seat not yet in `show_booked_seats` → exactly 1 succeeds via unique constraint |
| 3 | Different seats, concurrent `holdSeats` | Both customers hold different seats → both succeed (200) |

**Strategy**: Pre-insert seats as `AVAILABLE` for row-level locking. `Promise.allSettled` for concurrency. Verify DB state post-test (only 1 row with `HELD` status).

### `booking-edge.test.js` (7 tests)

| # | Test | Expected |
|---|------|----------|
| 1 | `holdSeats` — empty array | 400 |
| 2 | `holdSeats` — partial batch rollback | If any seat unavailable, entire batch rolled back |
| 3 | `confirmBooking` — nonexistent seat | 400, `not found` |
| 4 | `confirmBooking` — seat not held | 400, `not held` |
| 5 | `releaseSeats` — non-held seats | Empty release array |
| 6 | `releaseSeats` — wrong owner | Empty release, seat stays HELD |
| 7 | `releaseSeats` — duplicate idempotent | First releases, second returns empty array |

### `shows-edge.test.js` (14 tests)

| # | Test | Expected |
|---|------|----------|
| 1 | `createShow` — invalid UUID for screen_id | 400 |
| 2 | `createShow` — missing screen_id | 400 |
| 3 | `createMultipleShows` — skipped time slots | Shows created only for non-conflicting times |
| 4 | `deleteShow` — idempotent | 200 even if already deleted |
| 5 | `deleteMultipleShows` — mixed valid/invalid IDs | Partial success |
| 6 | `cancelShow` — already ended | 400 |
| 7 | `cancelShow` — nonexistent | 400 |
| 8 | `updateShowBookingStatus` — invalid action | 400 |
| 9 | `updateShowBookingStatus` — already opened | No-op success |
| 10 | `updateShowBookingStatus` — duplicate restore | Idempotent |
| 11 | `updateShowBookingStatus` — non-cancelled restore | 400 |
| 12 | `getShowById` — expired held seats shown as available | Seats visible but status reflects expiry |
| 13 | `getShowBookingCount` — not found | 404 |
| 14 | `getShowBookingCount` — zero counts | Returns 0 for confirmed and refunded |

### `payment-edge.test.js` (5 tests)

| # | Test | Expected |
|---|------|----------|
| 1 | `createOrder` — missing show_id | 400 |
| 2 | `createOrder` — expired hold | 400, `no longer held` |
| 3 | `verifyPayment` — already-paid order | 200 with `_idempotent: true` |
| 4 | `handleWebhook` — unknown event type | 200, `received: true` (silent accept) |
| 5 | `getPaymentOrders` — pagination bounds | 200 with orders array |

---

## Phase 7 — Coverage Tuning (24 tests)

### `offers-coverage.test.js` (13 tests)

| # | Test | Scenario |
|---|------|----------|
| 1 | `validateOfferCode` — invalid code | Rejects non-existent code |
| 2-8 | `validateOfferCode` — 7 validation paths | Expired, inactive, min amount not met, max discount capped, hall-scope mismatch, user eligibility (all), user eligibility (joined_after), already redeemed |
| 9-10 | `getActiveOffers` | Returns eligible offers, filters redeemed with `is_redeemed: true` |
| 11-13 | `validateOffer` endpoint | Validates valid offer, rejects expired, rejects ineligible |

### `shows-coverage.test.js` (6 tests)

| # | Test | Scenario |
|---|------|----------|
| 1 | `bulkCancelShows` — empty ids | 400 |
| 2 | `bulkCancelShows` — multiple shows with refunds | Cancels both, initiates refunds via mock Razorpay |
| 3 | `bulkCancelShows` — mixed states | Cancellable + already-cancelled + non-existent → partial results |
| 4 | `bulkRestoreShows` — empty ids | 400 |
| 5 | `bulkRestoreShows` — cancelled + non-cancelled | Only cancelled shows restored |
| 6 | `updateShowStatuses` — runs without error | No throw |

### `booking-coverage.test.js` (5 tests)

| # | Test | Scenario |
|---|------|----------|
| 1 | `cleanupExpiredHolds` — with expired holds | Cleans and returns count |
| 2 | `cleanupExpiredHolds` — no expired holds | Returns 0 |
| 3 | `getCinemaHallBookings` — status filter | Returns filtered results |
| 4 | `getCinemaHallBookings` — non-matching filter | Returns empty array |
| 5 | `getBookingByPaymentId` — unknown payment_id | 404 |

---

## Coverage Report

```
         | % Stmts | % Branch | % Funcs | % Lines
---------|---------|----------|---------|---------
Overall  |   77.54 |    69.43 |    86.8 |   78.69
controllers | 76.51 |    68.23 |   87.86 |   77.71
middleware  |  92.1 |    95.65 |   76.92 |    92.1
utils       | 90.38 |    76.92 |   81.81 |   90.38
```

| Metric | Before | After | Threshold |
|--------|--------|-------|-----------|
| Statements | 71.0% | **77.5%** | ≥ 75% |
| Branches | 62.3% | **69.4%** | ≥ 65% |
| Functions | 77.5% | **86.8%** | ≥ 80% |
| Lines | 72.1% | **78.7%** | ≥ 75% |

Files excluded from coverage: `generateTokenAndSetCookie.js`, `oauthProviders.js`.

---

## Test Patterns

### Controller Test (Real DB)

```js
import { getPool } from '../../setup/db.js'
import { createAdmin } from '../../setup/factories.js'
vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import { getMyHalls } from '../../../controllers/halls.Controller.js'

function mockReqRes(overrides = {}) {
  const req = { body: {}, params: {}, query: {}, admin: { id: 'none' }, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}
```

### Middleware Test (Mocked DB)

```js
vi.mock('../../../db.js', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
}))
vi.mock('../../../utils/hashToken.js', () => ({
  hashToken: vi.fn((token) => `hashed-${token}`),
}))
```

### External Service Mock

```js
const mockRazorpayOrdersCreate = vi.hoisted(() => vi.fn())
vi.mock('razorpay', () => {
  function MockRazorpay() {
    return { orders: { create: mockRazorpayOrdersCreate }, payments: { refund() {} } }
  }
  return { default: MockRazorpay }
})
```

### Integration Test (Middleware Mocked Before Import)

```js
vi.mock('../../middleware/verifyCinemaAdmin.js', () => ({
  verifyCinemaAdminAccessToken: (req, res, next) => {
    req.admin = { id: currentAdminId, role: 'admin' }
    next()
  },
}))
import app from '../../server.js'
```

### Concurrency Test

```js
const results = await Promise.allSettled([
  (async () => { /* customer A */ })(),
  (async () => { /* customer B */ })(),
])
const successes = results.filter(r => r.status === 'fulfilled' && r.value.status === 200)
expect(successes.length).toBe(1)
```

---

## Key Findings

### `holdSeats` Locking Gap

When two concurrent transactions both see `rowCount === 0` from `SELECT ... FOR UPDATE` (seat not yet in `show_booked_seats`), PostgreSQL's `FOR UPDATE` does NOT lock a non-existent row. Both transactions proceed to INSERT, and the second hits a unique violation (500) instead of a graceful 409.

**Recommendation**: Add `ON CONFLICT (show_id, seat_id) DO NOTHING` to the INSERT, making the second transaction a no-op, then re-check `rowCount` and return 409.

### Source Bugs Fixed

| Bug | Location | Fix |
|-----|----------|-----|
| `ANY(b.seats)` on JSONB | booking, refund controllers | `IN (SELECT jsonb_array_elements_text(b.seats))` |
| JS array passed as JSONB | `payment.Controller.js` | Added `JSON.stringify(seats)` |
| Missing `payment_signature` | `schema.sql` | Added `payment_signature TEXT` column |
| Non-unique index on `bookings(payment_id)` | `schema.sql` | Changed to `CREATE UNIQUE INDEX` |
| Schema missing lat/lng | `cinema_hall` | Added `latitude`, `longitude` columns |
| Factory column mismatches | Various | Fixed column names to match schema |
| OTP table missing UNIQUE | `otp_verifications` | Added `UNIQUE (email, type)` |

### Known Issues

1. **`requireActiveHall`**: `pool.connect()` outside try-catch — unhandled rejection on connection failure
2. **Controller `res.status` pattern**: Many controllers call `res.json()` without `res.status(200)`, relying on Express default 200
3. **`movies.Controller.js` missing `logger`**: `logger.error()` throws `ReferenceError` before `res.status(500)`
4. **Auth test password mutation**: Tests modifying shared admin password mutate state for subsequent tests
