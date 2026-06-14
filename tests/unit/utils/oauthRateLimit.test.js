import { describe, it, expect, beforeEach, vi } from 'vitest'
import { checkOAuthRateLimit } from '../../../utils/oauthRateLimit.js'

describe('checkOAuthRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows first attempt', () => {
    const result = checkOAuthRateLimit('192.168.1.1', 'google-login')
    expect(result.allowed).toBe(true)
    expect(result.retryAfterMs).toBeUndefined()
  })

  it('allows up to MAX_ATTEMPTS within the window', () => {
    const ip = '10.0.0.1'
    const action = 'github-login'

    for (let i = 0; i < 9; i++) {
      const result = checkOAuthRateLimit(ip, action)
      expect(result.allowed).toBe(true)
    }
  })

  it('blocks after MAX_ATTEMPTS within the window', () => {
    const ip = '10.0.0.2'
    const action = 'google-login'

    for (let i = 0; i < 10; i++) {
      checkOAuthRateLimit(ip, action)
    }

    const result = checkOAuthRateLimit(ip, action)
    expect(result.allowed).toBe(false)
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })

  it('resets window after 15 minutes', () => {
    const ip = '10.0.0.3'
    const action = 'google-login'

    for (let i = 0; i < 10; i++) {
      checkOAuthRateLimit(ip, action)
    }

    let result = checkOAuthRateLimit(ip, action)
    expect(result.allowed).toBe(false)

    vi.advanceTimersByTime(15 * 60 * 1000 + 1)

    result = checkOAuthRateLimit(ip, action)
    expect(result.allowed).toBe(true)
  })

  it('tracks different IPs independently', () => {
    const action = 'google-login'
    const ipA = '10.0.0.10'
    const ipB = '10.0.0.11'

    for (let i = 0; i < 11; i++) {
      checkOAuthRateLimit(ipA, action)
    }

    expect(checkOAuthRateLimit(ipA, action).allowed).toBe(false)
    expect(checkOAuthRateLimit(ipB, action).allowed).toBe(true)
  })

  it('tracks different actions independently', () => {
    const ip = '10.0.0.20'

    for (let i = 0; i < 11; i++) {
      checkOAuthRateLimit(ip, 'google-login')
    }

    expect(checkOAuthRateLimit(ip, 'google-login').allowed).toBe(false)
    expect(checkOAuthRateLimit(ip, 'github-login').allowed).toBe(true)
  })
})
