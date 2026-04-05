/**
 * Migration script: replace all console.* with logger.* across the project.
 * Run once with: node migrate-logger.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Per-file replacement specs: [searchRegex, replacement]
const migrations = {
  'controllers/auth.Controller.js': [
    [/console\.error\('❌ Registration error:', err\.message\)/g, "logger.error('❌ Registration error:', { message: err.message })"],
    [/console\.error\('❌ Login error:', err\.message\)/g, "logger.error('❌ Login error:', { message: err.message })"],
    [/console\.error\('❌ Refresh token error:', err\.message\)/g, "logger.error('❌ Refresh token error:', { message: err.message })"],
    [/console\.error\('❌ getMe error:', err\.message\)/g, "logger.error('❌ getMe error:', { message: err.message })"],
    [/console\.error\('❌ getAllAdmins error:', err\.message\)/g, "logger.error('❌ getAllAdmins error:', { message: err.message })"],
    [/console\.error\('Logout error:', err\)/g, "logger.error('Logout error:', { error: err })"],
    [/import \{ generateTokenAndSetCookie \} from '\.\.\/utils\/generateTokenAndSetCookie\.js'/,
      "import { generateTokenAndSetCookie } from '../utils/generateTokenAndSetCookie.js'\nimport logger from '../utils/logger.js'"],
  ],
  'controllers/booking.Controller.js': [
    [/console\.error\("❌ Hold seats error:", error\);/g, 'logger.error("❌ Hold seats error:", { error });'],
    [/console\.error\("❌ Confirm booking error:", error\.message\);/g, 'logger.error("❌ Confirm booking error:", { message: error.message });'],
    [/console\.error\("❌ Release seats error:", error\);/g, 'logger.error("❌ Release seats error:", { error });'],
    [/console\.error\("❌ Get booking by payment ID error:", error\);/g, 'logger.error("❌ Get booking by payment ID error:", { error });'],
    [/console\.error\("❌ Get my bookings error:", error\);/g, 'logger.error("❌ Get my bookings error:", { error });'],
    [/console\.error\("❌ Get cinema hall bookings error:", error\);/g, 'logger.error("❌ Get cinema hall bookings error:", { error });'],
    [/console\.error\("❌ Verify booking error:", error\);/g, 'logger.error("❌ Verify booking error:", { error });'],
    [/console\.error\("❌ Get booking details error:", error\);/g, 'logger.error("❌ Get booking details error:", { error });'],
    [/console\.log\(`🧹 Cleaned up \$\{result\.rowCount\} expired holds`\);/g, 'logger.info(`🧹 Cleaned up ${result.rowCount} expired holds`);'],
    [/console\.warn\(`⚠️ Cleanup skipped — DB unreachable \(\$\{error\.code\}\)`\);/g, 'logger.warn(`⚠️ Cleanup skipped — DB unreachable (${error.code})`);'],
    [/console\.error\('❌ Cleanup error:', error\);/g, "logger.error('❌ Cleanup error:', { error });"],
    [/import db from "\.\.\/db\.js";/g, 'import db from "../db.js";\nimport logger from \'../utils/logger.js\';'],
  ],
  'controllers/customerAuth.Controller.js': [
    [/console\.error\('❌ Customer signup error:', err\.message\)/g, "logger.error('❌ Customer signup error:', { message: err.message })"],
    [/console\.error\('❌ Customer login error:', err\.message\)/g, "logger.error('❌ Customer login error:', { message: err.message })"],
    [/console\.error\('❌ Logout error:', err\.message\)/g, "logger.error('❌ Logout error:', { message: err.message })"],
    [/console\.log\("Authenticated Customer ID:", customerId\);/g, 'logger.debug("Authenticated Customer ID:", { customerId });'],
    [/console\.error\('❌ Update profile error:', err\.message\)/g, "logger.error('❌ Update profile error:', { message: err.message })"],
    [/console\.error\('❌ Refresh token error:', err\.message\)/g, "logger.error('❌ Refresh token error:', { message: err.message })"],
    [/console\.error\('❌ getCustomerMe error:', err\.message\)/g, "logger.error('❌ getCustomerMe error:', { message: err.message })"],
    [/import \{ generateCustomerTokenAndSetCookie, generateTokenAndSetCookie \} from '\.\.\/utils\/generateTokenAndSetCookie\.js'/,
      "import { generateCustomerTokenAndSetCookie, generateTokenAndSetCookie } from '../utils/generateTokenAndSetCookie.js'\nimport logger from '../utils/logger.js'"],
  ],
  'controllers/customers.Controller.js': [
    [/console\.error\('❌ getAllCustomers error:', err\.message\)/g, "logger.error('❌ getAllCustomers error:', { message: err.message })"],
    [/import pool from '\.\.\/db\.js'\n/g, "import pool from '../db.js'\nimport logger from '../utils/logger.js'\n"],
  ],
  'controllers/dashboard.Controller.js': [
    [/console\.error\("❌ Dashboard stats error:", error\);/g, 'logger.error("❌ Dashboard stats error:", { error });'],
    [/import db from "\.\.\/db\.js";/g, 'import db from "../db.js";\nimport logger from \'../utils/logger.js\';'],
  ],
  'controllers/movies.Controller.js': [
    [/console\.error\('Error adding movie:', error\.message\)/g, "logger.error('Error adding movie:', { message: error.message })"],
    [/console\.error\('Error editing movie:', error\.message\)/g, "logger.error('Error editing movie:', { message: error.message })"],
    [/console\.error\('Error deleting movie:', error\.message\)/g, "logger.error('Error deleting movie:', { message: error.message })"],
    [/console\.error\("Error fetching movies:", error\.message\)/g, 'logger.error("Error fetching movies:", { message: error.message })'],
    [/console\.error\("Error fetching movie by ID:", error\.message\);/g, 'logger.error("Error fetching movie by ID:", { message: error.message });'],
    [/console\.error\('Error updating status:', error\.message\)/g, "logger.error('Error updating status:', { message: error.message })"],
    [/console\.error\('Error fetching tmdb ids:', error\.message\)/g, "logger.error('Error fetching tmdb ids:', { message: error.message })"],
    [/import pool from '\.\.\/db\.js'\n/g, "import pool from '../db.js'\nimport logger from '../utils/logger.js'\n"],
  ],
  'controllers/offers.Controller.js': [
    [/console\.error\("❌ getAllCinemaHalls error:", error\);/g, 'logger.error("❌ getAllCinemaHalls error:", { error });'],
    [/console\.error\("❌ getAllOffers error:", error\);/g, 'logger.error("❌ getAllOffers error:", { error });'],
    [/console\.error\("❌ createOffer error:", error\);/g, 'logger.error("❌ createOffer error:", { error });'],
    [/console\.error\("❌ getOfferById error:", error\);/g, 'logger.error("❌ getOfferById error:", { error });'],
    [/console\.error\("❌ updateOffer error:", error\);/g, 'logger.error("❌ updateOffer error:", { error });'],
    [/console\.error\("❌ deleteOffer error:", error\);/g, 'logger.error("❌ deleteOffer error:", { error });'],
    [/console\.error\("❌ getActiveOffers error:", error\);/g, 'logger.error("❌ getActiveOffers error:", { error });'],
    [/import db from "\.\.\/db\.js";/g, 'import db from "../db.js";\nimport logger from \'../utils/logger.js\';'],
  ],
  'controllers/otp.Controller.js': [
    [/console\.error\("❌ Send OTP error:", err\.message\)/g, 'logger.error("❌ Send OTP error:", { message: err.message })'],
    [/console\.error\('❌ Verify OTP error:', err\.message\)/g, "logger.error('❌ Verify OTP error:', { message: err.message })"],
    [/import crypto from 'crypto'\n/g, "import crypto from 'crypto'\nimport logger from '../utils/logger.js'\n"],
  ],
  'controllers/payment.Controller.js': [
    [/console\.error\("❌ Razorpay order creation failed:", statusCode \?\? "network error", description \?\? rzpErr\);/g,
      'logger.error("❌ Razorpay order creation failed:", { statusCode: statusCode ?? "network error", description: description ?? rzpErr });'],
    [/console\.error\("❌ Create order error:", error\);/g, 'logger.error("❌ Create order error:", { error });'],
    [/console\.error\("❌ Verify payment error:", error\);/g, 'logger.error("❌ Verify payment error:", { error });'],
    [/console\.error\("❌ Invalid webhook signature"\);/g, 'logger.error("❌ Invalid webhook signature");'],
    [/console\.log\(`📥 Webhook received: \$\{event\}`\);/g, 'logger.info(`📥 Webhook received: ${event}`);'],
    [/console\.log\(`✅ Refund settled: \$\{payload\.refund\.entity\.id\}`\);/g, 'logger.info(`✅ Refund settled: ${payload.refund.entity.id}`);'],
    [/console\.log\(`❌ Refund failed: \$\{payload\.refund\.entity\.id\}`\);/g, 'logger.warn(`❌ Refund failed: ${payload.refund.entity.id}`);'],
    [/console\.log\(`Unhandled event: \$\{event\}`\);/g, 'logger.warn(`Unhandled event: ${event}`);'],
    [/console\.error\("❌ Webhook processing error:", error\);/g, 'logger.error("❌ Webhook processing error:", { error });'],
    [/console\.log\(`Order \$\{orderId\} already processed`\);/g, 'logger.info(`Order ${orderId} already processed`);'],
    [/console\.log\(`✅ Webhook: Order \$\{orderId\} confirmed via webhook`\);/g, 'logger.info(`✅ Webhook: Order ${orderId} confirmed via webhook`);'],
    [/console\.log\(`🔓 Webhook: Released seats for failed order \$\{orderId\}`\);/g, 'logger.info(`🔓 Webhook: Released seats for failed order ${orderId}`);'],
    [/console\.log\(`📦 Order \$\{order\.id\} marked as paid`\);/g, 'logger.info(`📦 Order ${order.id} marked as paid`);'],
    [/console\.error\("❌ Get payment orders error:", error\);/g, 'logger.error("❌ Get payment orders error:", { error });'],
    [/import \{ validateOfferCode \} from "\.\/offers\.Controller\.js";/g,
      'import { validateOfferCode } from "./offers.Controller.js";\nimport logger from \'../utils/logger.js\';'],
  ],
  'controllers/refund.Controller.js': [
    [/console\.error\("❌ getRefunds error:", err\.message\);/g, 'logger.error("❌ getRefunds error:", { message: err.message });'],
    [/console\.error\("❌ getRefundByBooking error:", err\.message\);/g, 'logger.error("❌ getRefundByBooking error:", { message: err.message });'],
    [/console\.error\("❌ manuallySettleRefund error:", err\.message\);/g, 'logger.error("❌ manuallySettleRefund error:", { message: err.message });'],
    [/import db from "\.\.\/db\.js";/g, 'import db from "../db.js";\nimport logger from \'../utils/logger.js\';'],
  ],
  'controllers/screens.Controller.js': [
    [/console\.error\('Error creating screen:', error\.message\)/g, "logger.error('Error creating screen:', { message: error.message })"],
    [/console\.error\('Error editing screen:', error\.message\)/g, "logger.error('Error editing screen:', { message: error.message })"],
    [/console\.error\('Error deleting screen:', error\.message\)/g, "logger.error('Error deleting screen:', { message: error.message })"],
    [/console\.error\('Error fetching screens:', error\.message\)/g, "logger.error('Error fetching screens:', { message: error.message })"],
    [/import jwt from 'jsonwebtoken'\n/g, "import jwt from 'jsonwebtoken'\nimport logger from '../utils/logger.js'\n"],
  ],
  'controllers/settings.Controller.js': [
    [/console\.error\("❌ Get settings error:", error\);/g, 'logger.error("❌ Get settings error:", { error });'],
    [/console\.error\("❌ Update settings error:", error\);/g, 'logger.error("❌ Update settings error:", { error });'],
    [/import db from "\.\.\/db\.js";/g, 'import db from "../db.js";\nimport logger from \'../utils/logger.js\';'],
  ],
  'controllers/shows.Controller.js': [
    [/console\.log\("Show Date", show_date\);/g, 'logger.debug("Show Date", { show_date });'],
    [/console\.log\(`✅ Bulk create: \$\{createdShows\.length\} created, \$\{skippedCount\} skipped`\);/g,
      'logger.info(`✅ Bulk create: ${createdShows.length} created, ${skippedCount} skipped`);'],
    [/console\.error\("❌ Error creating multiple shows:", err\.message\);/g, 'logger.error("❌ Error creating multiple shows:", { message: err.message });'],
    [/console\.error\("❌ getShowsByDate error:", err\.message\);/g, 'logger.error("❌ getShowsByDate error:", { message: err.message });'],
    [/console\.error\("❌ Booking error:", err\);/g, 'logger.error("❌ Booking error:", { error: err });'],
    [/console\.error\("❌ getShowById error:", err\.message\);/g, 'logger.error("❌ getShowById error:", { message: err.message });'],
    [/console\.log\(`🎬 Shows updated: \$\{inProgressResult\.rowCount\} → in_progress, \$\{totalEnded\} → show_ended`\);/g,
      'logger.info(`🎬 Shows updated: ${inProgressResult.rowCount} → in_progress, ${totalEnded} → show_ended`);'],
    [/console\.warn\(`⚠️ Show status update skipped — DB unreachable \(\$\{error\.code\}\)`\);/g,
      'logger.warn(`⚠️ Show status update skipped — DB unreachable (${error.code})`);'],
    [/console\.error\('❌ Show status update error:', error\);/g, "logger.error('❌ Show status update error:', { error });"],
    // Two occurrences of Razorpay refund error in cancelShow and updateShowBookingStatus
    [/console\.error\('❌ Razorpay refund error:', refundErr\.message\);/g,
      "logger.error('❌ Razorpay refund error:', { message: refundErr.message });"],
    [/console\.error\('❌ cancelShow error:', err\.message\);/g, "logger.error('❌ cancelShow error:', { message: err.message });"],
    [/console\.error\('❌ updateShowBookingStatus error:', err\.message\);/g, "logger.error('❌ updateShowBookingStatus error:', { message: err.message });"],
    [/console\.error\('❌ getShowBookingCount error:', err\.message\);/g, "logger.error('❌ getShowBookingCount error:', { message: err.message });"],
    [/import Razorpay from "razorpay";/g, "import Razorpay from \"razorpay\";\nimport logger from '../utils/logger.js';"],
  ],
  'controllers/tmdb.Controller.js': [
    [/console\.error\('TMDB popular error:', error\.message\)/g, "logger.error('TMDB popular error:', { message: error.message })"],
    [/console\.error\('TMDB now_playing error:', error\.message\)/g, "logger.error('TMDB now_playing error:', { message: error.message })"],
    [/console\.error\('TMDB upcoming error:', error\.message\)/g, "logger.error('TMDB upcoming error:', { message: error.message })"],
    [/console\.error\('TMDB top_rated error:', error\.message\)/g, "logger.error('TMDB top_rated error:', { message: error.message })"],
    [/console\.error\('TMDB search error:', error\.message\)/g, "logger.error('TMDB search error:', { message: error.message })"],
    [/console\.error\('TMDB in-theatres error:', error\.message\)/g, "logger.error('TMDB in-theatres error:', { message: error.message })"],
    [/console\.error\('TMDB movie details error:', error\.message\)/g, "logger.error('TMDB movie details error:', { message: error.message })"],
    [/^(const TMDB_BASE_URL)/m, "import logger from '../utils/logger.js';\n\nconst TMDB_BASE_URL"],
  ],
  'controllers/userMovies.Controller.js': [
    [/console\.error\("Error fetching movies by location:", error\.message\)/g, 'logger.error("Error fetching movies by location:", { message: error.message })'],
    [/console\.error\("Error fetching movies by state:", error\.message\)/g, 'logger.error("Error fetching movies by state:", { message: error.message })'],
    [/console\.error\("Error fetching movie details with showtimes:", error\.message\)/g, 'logger.error("Error fetching movie details with showtimes:", { message: error.message })'],
    [/console\.error\("Error fetching districts:", error\.message\)/g, 'logger.error("Error fetching districts:", { message: error.message })'],
    [/console\.error\("Error fetching cinema halls:", error\.message\)/g, 'logger.error("Error fetching cinema halls:", { message: error.message })'],
    [/console\.error\("Error fetching movies:", error\.message\)/g, 'logger.error("Error fetching movies:", { message: error.message })'],
    [/console\.error\("Error fetching cinema halls with shows:", error\.message\)/g, 'logger.error("Error fetching cinema halls with shows:", { message: error.message })'],
    [/console\.error\("Error fetching movie by ID:", error\.message\)/g, 'logger.error("Error fetching movie by ID:", { message: error.message })'],
    [/import pool from '\.\.\/db\.js'\n/g, "import pool from '../db.js'\nimport logger from '../utils/logger.js'\n"],
  ],
  'middleware/verifyCinemaAdmin.js': [
    [/console\.error\('❌ Access Token Error:', err\.message\)/g, "logger.error('❌ Access Token Error:', { message: err.message })"],
    [/console\.error\('❌ Refresh Token Error:', err\.message\)/g, "logger.error('❌ Refresh Token Error:', { message: err.message })"],
    [/console\.error\('❌ Super Admin Token Error:', err\.message\)/g, "logger.error('❌ Super Admin Token Error:', { message: err.message })"],
    [/console\.error\('❌ Access Token or DB Error:', err\.message\)/g, "logger.error('❌ Access Token or DB Error:', { message: err.message })"],
    [/console\.error\("verifyScreenOwnership error:", err\.message\);/g, 'logger.error("verifyScreenOwnership error:", { message: err.message });'],
    [/console\.error\('❌ Customer Token Error:', err\.message\)/g, "logger.error('❌ Customer Token Error:', { message: err.message })"],
    [/console\.error\('❌ Customer Refresh Token Error:', err\.message\)/g, "logger.error('❌ Customer Refresh Token Error:', { message: err.message })"],
    [/import db from "\.\.\/db\.js";/g, 'import db from "../db.js";\nimport logger from \'../utils/logger.js\';'],
  ],
};

let totalReplaced = 0;

for (const [relPath, rules] of Object.entries(migrations)) {
  const fullPath = path.join(__dirname, relPath);
  let content = fs.readFileSync(fullPath, 'utf8');
  let changed = 0;

  for (const [pattern, replacement] of rules) {
    const before = content;
    content = content.replace(pattern, replacement);
    if (content !== before) changed++;
  }

  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`✅ ${relPath}: ${changed} rule(s) applied`);
  totalReplaced += changed;
}

console.log(`\n🎉 Done. ${totalReplaced} total rules applied across ${Object.keys(migrations).length} files.`);
