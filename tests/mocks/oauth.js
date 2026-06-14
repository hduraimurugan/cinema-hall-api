import { vi } from 'vitest'

export const mockVerifyGoogleToken = vi.fn()
export const mockExchangeGithubCode = vi.fn()
export const mockGetGithubUser = vi.fn()

export function setupOauthMock() {
  vi.mock('../../utils/oauthProviders.js', () => ({
    verifyGoogleToken: mockVerifyGoogleToken,
    exchangeGithubCode: mockExchangeGithubCode,
    getGithubUser: mockGetGithubUser,
  }))
}

export function resetOauthMocks() {
  mockVerifyGoogleToken.mockReset()
  mockExchangeGithubCode.mockReset()
  mockGetGithubUser.mockReset()
}
