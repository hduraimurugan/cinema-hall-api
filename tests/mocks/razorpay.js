import { vi } from 'vitest'

export const mockRazorpayOrders = {
  create: vi.fn(),
  fetch: vi.fn(),
  fetchAll: vi.fn(),
}

export const mockRazorpayPayments = {
  fetch: vi.fn(),
  refund: vi.fn(),
}

export const mockRazorpayInstance = vi.fn(() => ({
  orders: mockRazorpayOrders,
  payments: mockRazorpayPayments,
}))

export function setupRazorpayMock() {
  vi.mock('razorpay', () => ({
    default: mockRazorpayInstance,
  }))
}

export function resetRazorpayMocks() {
  mockRazorpayOrders.create.mockReset()
  mockRazorpayOrders.fetch.mockReset()
  mockRazorpayPayments.fetch.mockReset()
  mockRazorpayPayments.refund.mockReset()
}
