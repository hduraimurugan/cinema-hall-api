import crypto from 'crypto'

/**
 * Hash a raw token using SHA-256.
 * Store the hash in the database; send the raw token in emails/URLs.
 * @param {string} rawToken
 * @returns {string} hex-encoded SHA-256 hash
 */
export const hashToken = (rawToken) => {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}
