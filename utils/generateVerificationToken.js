import crypto from 'crypto'

/**
 * Generate a cryptographically secure random token (hex string).
 * Send the raw token in email links; store only the SHA-256 hash in the DB.
 * @returns {string} 64-character hex token
 */
export const generateVerificationToken = () => {
  return crypto.randomBytes(32).toString('hex')
}