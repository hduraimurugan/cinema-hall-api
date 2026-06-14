import { describe, it, expect } from 'vitest'
import { hashToken } from '../../../utils/hashToken.js'

describe('hashToken', () => {
  it('returns a hex string', () => {
    const hash = hashToken('test-token')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('is deterministic — same input same hash', () => {
    const a = hashToken('hello-world')
    const b = hashToken('hello-world')
    expect(a).toBe(b)
  })

  it('produces different hashes for different inputs', () => {
    const a = hashToken('token-a')
    const b = hashToken('token-b')
    expect(a).not.toBe(b)
  })

  it('handles empty string', () => {
    const hash = hashToken('')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('produces correct known SHA-256 output', () => {
    const hash = hashToken('abc')
    expect(hash).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})
