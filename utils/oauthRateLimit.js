import logger from './logger.js'

/**
 * Simple in-memory rate limiter for OAuth endpoints.
 * Tracks attempts per IP with a sliding window.
 */
const attempts = new Map() // key: `${action}:${ip}` → { count, firstAttempt }

const WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const MAX_ATTEMPTS = 10

/**
 * Check if an IP has exceeded the rate limit for a given action.
 * @param {string} ip - The client IP
 * @param {string} action - The action being rate-limited (e.g. 'google-login', 'github-login')
 * @returns {{ allowed: boolean, retryAfterMs?: number }}
 */
export const checkOAuthRateLimit = (ip, action) => {
  const key = `${action}:${ip}`
  const now = Date.now()
  const record = attempts.get(key)

  if (!record) {
    attempts.set(key, { count: 1, firstAttempt: now })
    return { allowed: true }
  }

  // Window expired — reset
  if (now - record.firstAttempt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAttempt: now })
    return { allowed: true }
  }

  // Within window
  if (record.count >= MAX_ATTEMPTS) {
    const retryAfterMs = WINDOW_MS - (now - record.firstAttempt)
    return { allowed: false, retryAfterMs }
  }

  record.count++
  return { allowed: true }
}

// Cleanup expired entries every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now()
  for (const [key, record] of attempts) {
    if (now - record.firstAttempt > WINDOW_MS) {
      attempts.delete(key)
    }
  }
}, 5 * 60 * 1000).unref()
