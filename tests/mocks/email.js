import { vi } from 'vitest'

export const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'mock-msg-id' })
export const mockCreateTransport = vi.fn(() => ({ sendMail: mockSendMail }))

export function setupEmailMock() {
  vi.mock('nodemailer', () => ({
    createTransport: mockCreateTransport,
  }))
}

export function resetEmailMocks() {
  mockSendMail.mockReset()
  mockSendMail.mockResolvedValue({ messageId: 'mock-msg-id' })
}
