# 🎬 Cinema Hall Ticket Booking System - Backend API Service

[![Node.js](https://img.shields.io/badge/Node.js-v18+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-v5.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Razorpay](https://img.shields.io/badge/Razorpay-v2.x-002E6E?logo=razorpay&logoColor=white)](https://razorpay.com/)
[![Sentry](https://img.shields.io/badge/Sentry-Error_Tracking-362D59?logo=sentry&logoColor=white)](https://sentry.io/)
[![License](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

A robust, performant RESTful backend API built with **Express.js** and **PostgreSQL**. This service handles identity management, multi-hall configuration, screen configurations, showtime scheduling with overlap prevention, seat holds with a background TTL release, secure Razorpay checkout verification, atomic webhook processing, offers & promotions, platform advertising, and real-time ticket validation.

---

## 🛠️ Tech Stack & Features

*   **Runtime & Framework**: Node.js (ES Modules) with Express.js.
*   **Database Engine**: PostgreSQL (tested on local PostgreSQL 18 and Neon serverless).
*   **Authentication & Security**: Double-token cookie authentication strategy using HttpOnly, Secure, and SameSite `accessToken` + `refreshToken` JWTs. Passwords hashed using bcrypt.
*   **Payment Infrastructure**: Razorpay Node SDK, processing automated captures, signature verifications, webhook deduplication, and atomic refunds.
*   **Logging & Diagnostics**: Winston logger configured for colorized output in development and structural JSON formatting in production.
*   **Error Monitoring**: Sentry (`@sentry/node`) integration capturing performance tracing, spans, and runtime errors.
*   **Background Cron Job**: Automatic show status transition engine and expired booking hold cleaner.

---

## 📂 Directory Structure

```bash
cinema-hall-api/
├── controllers/          # Request handler functions
│   ├── ads.Controller.js         # Banner & sidebar ad analytics
│   ├── auth.Controller.js        # Admin identity & hall registration
│   ├── booking.Controller.js     # Hold lock & booking confirmations
│   ├── customer.Controller.js    # Customer profile & login
│   ├── dashboard.Controller.js   # Admin analytics aggregation
│   ├── halls.Controller.js       # Multi-hall CRUD operations
│   ├── offers.Controller.js      # Promo codes & validations
│   ├── payment.Controller.js     # Razorpay orders, verifications, & webhooks
│   ├── refund.Controller.js      # Ticket cancellations & refunds
│   └── userMovies.Controller.js  # Public movie discovery & showtimes
├── routes/               # API Router mappings
├── middleware/           # HTTP Request pre-processors
│   ├── verifyCinemaAdmin.js      # Token verification, hall checks & SuperAdmin guards
│   └── verifyCustomer.js         # Customer token validation
├── migrations/           # Database migration files
├── utils/                # Utility helpers & external integrations
│   ├── logger.js                 # Structured Winston logger setup
│   └── mailer.js                 # OTP notification mail dispatcher
├── db.js                 # PostgreSQL pg.Pool connection config
├── vercel.json           # Production serverless configuration
├── server.js             # Entrypoint bootstrap & background task runner
├── package.json          # Node dependencies & run scripts
└── .env                  # Configuration variables (git-ignored)
```

---

## 🔑 Environment Setup

Create a `.env` file in the root of the `cinema-hall-api` directory using the following keys:

| Parameter | Description | Example |
| :--- | :--- | :--- |
| `JWT_SECRET` | Primary JWT signing key | `your_jwt_signing_secret` |
| `REFRESH_SECRET` | Long-lived refresh token signing key | `your_refresh_signing_secret` |
| `DATABASE_URL` | Connection string to PostgreSQL instance | `postgresql://user:pass@localhost:5432/db` |
| `RAZORPAY_KEY_ID` | Razorpay public test/live key | `rzp_test_XXXXXXXXXXXXXX` |
| `RAZORPAY_KEY_SECRET` | Razorpay private secret key | `your_razorpay_secret_key` |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook verification secret | `your_webhook_secret_phrase` |
| `MAILGET_API_KEY` | SMTP Mail provider API Key (for OTPs) | `your_smtp_api_key` |
| `MAILGET_SECRET_KEY` | SMTP Mail provider Secret Key | `your_smtp_secret_key` |
| `TMDB_API_KEY` | TMDB developer API key (v3 bearer token) | `eyJhbGciOiJIUzI1NiJ9...` |
| `CRON_SECRET` | Verification token for Vercel Cron jobs | `your_custom_cron_secret` |

---

## 🚀 Getting Started

### 1. Clone the repository
Ensure you have cloned the monorepo first:
```bash
git clone https://github.com/your-username/cinema-hall.git
cd cinema-hall/cinema-hall-api
```

### 2. Install dependencies
```bash
npm install
```

### 3. Setup the Database Schema
1. Connect to your PostgreSQL instance (local or remote/Neon).
2. Create a database (e.g., `cinema_hall_db`).
3. Open and execute the script located in `../docs/db_setup.sql` in your SQL editor (pgAdmin or Neon Console). This script is fully idempotent and creates all 16 tables, check constraints, foreign keys, and showtimes overlap verification triggers.

### 4. Running the Server

#### Development Mode (with hot reloading via Nodemon)
```bash
npm run dev
```
The server will start on [http://localhost:5000](http://localhost:5000).

#### Production Mode (with Sentry instrumentation preloaded)
```bash
npm start
```

---

## 📘 API Documentation
For detailed explanations of all endpoints (including parameters, headers, and request/response models), please consult [docs/backend.md](../docs/backend.md).
