import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { getPool, query } from '../../setup/db.js'
import { createAdmin, createHall, createCustomer } from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import { validateOfferCode, getActiveOffers, validateOffer } from '../../../controllers/offers.Controller.js'

function mockReqRes(overrides = {}) {
  const req = { body: {}, params: {}, query: {}, admin: { id: 'none' }, customer: { id: 'none' }, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

let pool, admin, hall, customer

beforeAll(async () => {
  pool = getPool()
  admin = await createAdmin()
  hall = await createHall(admin.id, { name: 'Offers Coverage Hall' })
  customer = await createCustomer()
})

afterEach(async () => {
  await query('DELETE FROM offer_redemptions')
  await query('DELETE FROM offers')
})

async function seedOffer(overrides = {}) {
  const result = await query(`
    INSERT INTO offers (code, title, discount_type, discount_value, max_discount_amount,
                        min_booking_amount, is_active, valid_until, scope, cinema_hall_id,
                        user_eligibility, user_joined_after, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `, [
    overrides.code || 'COVER',
    overrides.title || 'Coverage Test Offer',
    overrides.discount_type || 'percentage',
    overrides.discount_value || 20,
    overrides.max_discount_amount || null,
    overrides.min_booking_amount || 0,
    overrides.is_active !== undefined ? overrides.is_active : true,
    overrides.valid_until || '2030-12-31',
    overrides.scope || 'global',
    overrides.scope === 'hall' ? (overrides.cinema_hall_id || hall.id) : null,
    overrides.user_eligibility || 'all',
    overrides.user_eligibility === 'joined_after' ? (overrides.user_joined_after || '2024-01-01') : null,
    admin.id,
  ])
  return result.rows[0]
}

describe('validateOfferCode — all validation paths', () => {
  it('rejects invalid offer code', async () => {
    await expect(validateOfferCode({
      offer_code: 'NONEXISTENT',
      show_id: '00000000-0000-0000-0000-000000000000',
      total_amount: 500,
      customer_id: customer.id,
    })).rejects.toThrow(/invalid offer code/i)
  })

  it('rejects inactive offer', async () => {
    await seedOffer({ code: 'INACTIVE', is_active: false })
    await expect(validateOfferCode({
      offer_code: 'INACTIVE',
      show_id: '00000000-0000-0000-0000-000000000000',
      total_amount: 500,
      customer_id: customer.id,
    })).rejects.toThrow(/no longer active/i)
  })

  it('rejects expired offer', async () => {
    await seedOffer({ code: 'EXPIRED', valid_until: '2020-01-01' })
    await expect(validateOfferCode({
      offer_code: 'EXPIRED',
      show_id: '00000000-0000-0000-0000-000000000000',
      total_amount: 500,
      customer_id: customer.id,
    })).rejects.toThrow(/expired/i)
  })

  it('rejects below minimum booking amount', async () => {
    await seedOffer({ code: 'MINAMT', min_booking_amount: 1000 })
    await expect(validateOfferCode({
      offer_code: 'MINAMT',
      show_id: '00000000-0000-0000-0000-000000000000',
      total_amount: 500,
      customer_id: customer.id,
    })).rejects.toThrow(/minimum booking amount/i)
  })

  it('rejects already redeemed offer', async () => {
    const offer = await seedOffer({ code: 'REDEEMED' })
    await query(
      `INSERT INTO offer_redemptions (offer_id, customer_id, discount_applied)
       VALUES ($1, $2, 50)`,
      [offer.id, customer.id]
    )
    await expect(validateOfferCode({
      offer_code: 'REDEEMED',
      show_id: '00000000-0000-0000-0000-000000000000',
      total_amount: 500,
      customer_id: customer.id,
    })).rejects.toThrow(/already used/i)
  })

  it('returns fixed discount', async () => {
    await seedOffer({ code: 'FIXED75', discount_type: 'fixed', discount_value: 75 })
    const result = await validateOfferCode({
      offer_code: 'FIXED75',
      show_id: '00000000-0000-0000-0000-000000000000',
      total_amount: 500,
      customer_id: customer.id,
    })
    expect(result.discountAmount).toBe(75)
  })

  it('applies max_discount_amount cap for percentage', async () => {
    await seedOffer({
      code: 'MAXCAP', discount_type: 'percentage', discount_value: 50,
      max_discount_amount: 100,
    })
    const result = await validateOfferCode({
      offer_code: 'MAXCAP',
      show_id: '00000000-0000-0000-0000-000000000000',
      total_amount: 1000,
      customer_id: customer.id,
    })
    expect(result.discountAmount).toBe(100)
  })

  it('discount cannot exceed total amount', async () => {
    await seedOffer({ code: 'OVER100', discount_type: 'fixed', discount_value: 999 })
    const result = await validateOfferCode({
      offer_code: 'OVER100',
      show_id: '00000000-0000-0000-0000-000000000000',
      total_amount: 50,
      customer_id: customer.id,
    })
    expect(result.discountAmount).toBe(50)
  })
})

describe('getActiveOffers', () => {
  it('filters by user_eligibility joined_after', async () => {
    const newCustomer = await createCustomer()
    await seedOffer({
      code: 'NEWONLY',
      user_eligibility: 'joined_after',
      user_joined_after: '2099-01-01',
    })
    const { req, res } = mockReqRes({ customer: { id: newCustomer.id } })
    await getActiveOffers(req, res)
    const offers = res.json.mock.calls[0][0].offers
    expect(offers.find(o => o.code === 'NEWONLY')).toBeUndefined()
  })

  it('marks redeemed offers with is_redeemed flag', async () => {
    const offer = await seedOffer({ code: 'ALREDEEM' })
    await query(
      `INSERT INTO offer_redemptions (offer_id, customer_id, discount_applied)
       VALUES ($1, $2, 30)`,
      [offer.id, customer.id]
    )
    const { req, res } = mockReqRes({ customer: { id: customer.id } })
    await getActiveOffers(req, res)
    const offers = res.json.mock.calls[0][0].offers
    const redeemed = offers.find(o => o.code === 'ALREDEEM')
    expect(redeemed.is_redeemed).toBe(true)
  })
})

describe('validateOffer endpoint', () => {
  it('rejects missing fields', async () => {
    const { req, res } = mockReqRes({
      customer: { id: customer.id },
      body: { offer_code: 'TEST' },
    })
    await validateOffer(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns 400 for invalid offer code', async () => {
    const { req, res } = mockReqRes({
      customer: { id: customer.id },
      body: { offer_code: 'GHOST', show_id: '00000000-0000-0000-0000-000000000000', total_amount: 500 },
    })
    await validateOffer(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

describe('createOffer — duplicate code path unblocked', () => {
  it('returns 409 for duplicate code', async () => {
    await seedOffer({ code: 'DUPE' })
    const { createOffer: createOfferCtrl } = await import('../../../controllers/offers.Controller.js')
    const { req, res } = mockReqRes({
      admin: { id: admin.id },
      body: {
        code: 'DUPE', title: 'Duplicate', discount_type: 'percentage',
        discount_value: 10, valid_until: '2030-12-31',
      },
    })
    await createOfferCtrl(req, res)
    expect(res.status).toHaveBeenCalledWith(409)
  })
})
