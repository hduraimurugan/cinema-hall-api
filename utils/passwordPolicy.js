/**
 * Password policy rules.
 * Minimum 8 characters, at least one uppercase letter, one lowercase letter,
 * one digit, and one special character.
 */
const POLICY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+\[\]{};':"\\|,.<>\/?`~]).{8,}$/

/**
 * Validate a password against the policy.
 * @param {string} password
 * @returns {{ valid: boolean, message?: string }}
 */
export const validatePassword = (password) => {
  if (!password || password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters.' }
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter.' }
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter.' }
  }
  if (!/\d/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number.' }
  }
  if (!/[!@#$%^&*()\-_=+\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one special character.' }
  }
  return { valid: true }
}

/**
 * List of individual policy checks for frontend indicator UI.
 * Each item has a label and a test function.
 */
export const PASSWORD_POLICY_CHECKS = [
  { label: 'At least 8 characters',       test: (p) => p.length >= 8 },
  { label: 'One uppercase letter (A–Z)',   test: (p) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter (a–z)',   test: (p) => /[a-z]/.test(p) },
  { label: 'One number (0–9)',             test: (p) => /\d/.test(p) },
  { label: 'One special character',        test: (p) => /[!@#$%^&*()\-_=+\[\]{};':"\\|,.<>\/?`~]/.test(p) },
]
