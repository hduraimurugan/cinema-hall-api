import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { getPool } from '../../setup/db.js'
import { createAdmin, createHall, createOffer } from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import {
  getOfferById, getAllOffers, createOffer as createOfferCtrl,
  updateOffer, deleteOffer, getAllCinemaHalls,
} from '../../../controllers/offers.Controller.js'

function mockReqRes(overrides = {}) {
  const req = { body: {}, params: {}, query: {}, admin: { id: 'none' }, customer: { id: 'none' }, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

let admin, hall

beforeAll(async () => {
  admin = await createAdmin()
  hall = await createHall(admin.id, { name: 'Offer Hall' })
})

describe('getAllCinemaHalls', () => {
  it('returns cinema halls list', async () => {
    const { req, res } = mockReqRes()
    await getAllCinemaHalls(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.halls.length).toBeGreaterThanOrEqual(1)
    expect(data.halls[0]).toHaveProperty('id')
    expect(data.halls[0]).toHaveProperty('name')
  })
})

describe('getAllOffers', () => {
  it('returns offers with pagination', async () => {
    await createOffer(hall.id, admin.id)
    const { req, res } = mockReqRes({ query: {} })
    await getAllOffers(req, res)
    const data = res.json.mock.calls[0][0]
    expect(data.offers.length).toBeGreaterThanOrEqual(1)
    expect(data).toHaveProperty('total')
    expect(data).toHaveProperty('page')
  })
})

describe('createOffer', () => {
  it('rejects missing required fields', async () => {
    const { req, res } = mockReqRes({ admin: { id: admin.id }, body: { title: 'Incomplete' } })
    await createOfferCtrl(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rejects invalid discount_type', async () => {
    const { req, res } = mockReqRes({
      admin: { id: admin.id },
      body: { code: 'BAD', title: 'Bad', discount_type: 'invalid', discount_value: 10, valid_until: '2030-12-31' },
    })
    await createOfferCtrl(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('creates a percentage offer', async () => {
    const { req, res } = mockReqRes({
      admin: { id: admin.id },
      body: {
        code: 'PCT20', title: '20% Off', discount_type: 'percentage',
        discount_value: 20, valid_until: '2030-12-31',
      },
    })
    await createOfferCtrl(req, res)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json.mock.calls[0][0].offer.code).toBe('PCT20')
  })

  it('creates a fixed offer scoped to hall', async () => {
    const { req, res } = mockReqRes({
      admin: { id: admin.id },
      body: {
        code: 'FIX50', title: '₹50 Off', discount_type: 'fixed',
        discount_value: 50, valid_until: '2030-12-31',
        scope: 'hall', cinema_hall_id: hall.id,
      },
    })
    await createOfferCtrl(req, res)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json.mock.calls[0][0].offer.scope).toBe('hall')
  })

  it('returns 409 for duplicate code', async () => {
    const { req, res } = mockReqRes({
      admin: { id: admin.id },
      body: {
        code: 'PCT20', title: 'Duplicate', discount_type: 'percentage',
        discount_value: 10, valid_until: '2030-12-31',
      },
    })
    await createOfferCtrl(req, res)
    expect(res.status).toHaveBeenCalledWith(409)
  })
})

describe('getOfferById', () => {
  let offerId

  beforeAll(async () => {
    const offer = await createOffer(hall.id, admin.id)
    offerId = offer.id
  })

  it('returns offer for valid id', async () => {
    const { req, res } = mockReqRes({ params: { id: offerId } })
    await getOfferById(req, res)
    expect(res.json.mock.calls[0][0].offer.id).toBe(offerId)
  })

  it('returns 404 for nonexistent offer', async () => {
    const { req, res } = mockReqRes({ params: { id: '00000000-0000-0000-0000-000000000000' } })
    await getOfferById(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })
})

describe('updateOffer', () => {
  let offerId

  beforeAll(async () => {
    const offer = await createOffer(hall.id, admin.id, { code: 'UPDATEME' })
    offerId = offer.id
  })

  it('updates offer title', async () => {
    const { req, res } = mockReqRes({
      params: { id: offerId },
      body: {
        code: 'UPDATEME', title: 'Updated Title', discount_type: 'percentage',
        discount_value: 15, valid_until: '2030-12-31', is_active: true,
      },
    })
    await updateOffer(req, res)
    expect(res.json.mock.calls[0][0].offer.title).toBe('Updated Title')
  })

  it('returns 404 for nonexistent offer', async () => {
    const { req, res } = mockReqRes({
      params: { id: '00000000-0000-0000-0000-000000000000' },
      body: {
        code: 'X', title: 'X', discount_type: 'percentage',
        discount_value: 10, valid_until: '2030-12-31',
      },
    })
    await updateOffer(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })
})

describe('deleteOffer', () => {
  it('deletes existing offer', async () => {
    const offer = await createOffer(hall.id, admin.id, { code: 'DELETEME' })
    const { req, res } = mockReqRes({ params: { id: offer.id } })
    await deleteOffer(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/deleted/i)
  })

  it('returns 404 for nonexistent offer', async () => {
    const { req, res } = mockReqRes({ params: { id: '00000000-0000-0000-0000-000000000000' } })
    await deleteOffer(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })
})
