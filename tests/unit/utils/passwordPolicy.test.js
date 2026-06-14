import { describe, it, expect } from 'vitest'
import { validatePassword, PASSWORD_POLICY_CHECKS } from '../../../utils/passwordPolicy.js'

describe('validatePassword', () => {
  it('rejects undefined/null', () => {
    expect(validatePassword()).toBe('Password must be at least 8 characters.')
    expect(validatePassword(null)).toBe('Password must be at least 8 characters.')
  })

  it('rejects shorter than 8 characters', () => {
    const result = validatePassword('Ab1!xyz')
    expect(result).toBe('Password must be at least 8 characters.')
  })

  it('rejects missing lowercase letter', () => {
    const result = validatePassword('ABCD1234!')
    expect(result).toBe('Password must contain at least one lowercase letter.')
  })

  it('rejects missing uppercase letter', () => {
    const result = validatePassword('abcd1234!')
    expect(result).toBe('Password must contain at least one uppercase letter.')
  })

  it('rejects missing digit', () => {
    const result = validatePassword('Abcdefgh!')
    expect(result).toBe('Password must contain at least one number.')
  })

  it('rejects missing special character', () => {
    const result = validatePassword('Abcdefgh1')
    expect(result).toBe('Password must contain at least one special character.')
  })

  it('accepts valid password (8 chars, all requirements)', () => {
    const result = validatePassword('TestPass1!')
    expect(result).toBeNull()
  })

  it('accepts valid password with various special chars', () => {
    const validPasswords = [
      'Test@123',
      'Test#123',
      'Test$123',
      'Test%123',
      'LongPassword1!',
      'Abc!23xyz',
      'Valid!1a',
    ]
    for (const pw of validPasswords) {
      expect(validatePassword(pw)).toBeNull()
    }
  })

  it('returns first failing check (shortest)', () => {
    expect(validatePassword('Ab1!xy')).toBe('Password must be at least 8 characters.')
    expect(validatePassword('ABCD!@#$')).toBe('Password must contain at least one lowercase letter.')
  })
})

describe('PASSWORD_POLICY_CHECKS', () => {
  it('exports 5 checks', () => {
    expect(PASSWORD_POLICY_CHECKS).toHaveLength(5)
  })

  it('each check has label and test function', () => {
    for (const check of PASSWORD_POLICY_CHECKS) {
      expect(check).toHaveProperty('label')
      expect(typeof check.label).toBe('string')
      expect(check).toHaveProperty('test')
      expect(typeof check.test).toBe('function')
    }
  })

  it('all checks pass for a valid password', () => {
    const valid = 'TestPass1!'
    for (const check of PASSWORD_POLICY_CHECKS) {
      expect(check.test(valid), `${check.label} should pass`).toBe(true)
    }
  })
})
