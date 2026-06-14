import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { getPool, cleanupAll, closePool } from '../../setup/db.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import {
  getAllAds, createAd, updateAd, deleteAd,
  getActiveAds, recordClick, getAdClicks,
} from '../../../controllers/ads.Controller.js'

const pool = getPool

function mockReqRes(overrides = {}) {
  const req = { body: {}, params: {}, query: {}, cookies: {}, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

const validAd = {
  title: 'Test Ad',
  image_url: 'https://example.com/ad.jpg',
  placement: 'banner',
  start_date: '2024-01-01',
  end_date: '2030-12-31',
}

// Helper: create an ad by calling the controller directly
async function createTestAd(overrides = {}) {
  const { req, res } = mockReqRes({ body: { ...validAd, ...overrides } })
  await createAd(req, res)
  return res.json.mock.calls[0][0].ad
}

afterEach(async () => {
  const p = getPool()
  await p.query('DELETE FROM ad_clicks')
  await p.query('DELETE FROM ads')
})

afterAll(async () => {
  await cleanupAll()
  await closePool()
})

describe('getAllAds', () => {
  it('returns empty array initially', async () => {
    const { req, res } = mockReqRes()
    await getAllAds(req, res)
    expect(res.json.mock.calls[0][0].ads).toEqual([])
  })

  it('returns created ads', async () => {
    await createTestAd()
    const { req, res } = mockReqRes()
    await getAllAds(req, res)
    expect(res.json.mock.calls[0][0].ads).toHaveLength(1)
  })
})

describe('createAd', () => {
  it('rejects missing required fields', async () => {
    const { req, res } = mockReqRes({ body: { title: 'Incomplete' } })
    await createAd(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('creates ad with valid data', async () => {
    const ad = await createTestAd()
    expect(ad.title).toBe('Test Ad')
  })
})

describe('updateAd', () => {
  let adId

  beforeEach(async () => {
    const ad = await createTestAd({ title: 'Before' })
    adId = ad.id
  })

  it('updates ad title', async () => {
    const { req, res } = mockReqRes({
      params: { id: adId },
      body: { title: 'After', image_url: 'x', placement: 'banner', start_date: '2024-01-01', end_date: '2030-12-31' },
    })
    await updateAd(req, res)
    expect(res.json.mock.calls[0][0].ad.title).toBe('After')
  })

  it('returns 404 for nonexistent ad', async () => {
    const { req, res } = mockReqRes({
      params: { id: '00000000-0000-0000-0000-000000000000' },
      body: { title: 'x', image_url: 'x', placement: 'banner', start_date: '2024-01-01', end_date: '2030-12-31' },
    })
    await updateAd(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })
})

describe('deleteAd', () => {
  it('deletes existing ad then 404s on second delete', async () => {
    const ad = await createTestAd()

    const { req: req1, res: res1 } = mockReqRes({ params: { id: ad.id } })
    await deleteAd(req1, res1)
    expect(res1.json.mock.calls[0][0].message).toMatch(/deleted/i)

    const { req: req2, res: res2 } = mockReqRes({ params: { id: ad.id } })
    await deleteAd(req2, res2)
    expect(res2.status).toHaveBeenCalledWith(404)
  })
})

describe('getActiveAds', () => {
  it('requires placement param', async () => {
    const { req, res } = mockReqRes({ query: {} })
    await getActiveAds(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns active ads for placement', async () => {
    await createTestAd({ placement: 'sidebar' })

    const { req, res } = mockReqRes({ query: { placement: 'sidebar' } })
    await getActiveAds(req, res)
    expect(res.json.mock.calls[0][0].ads.length).toBeGreaterThanOrEqual(1)
  })
})

describe('recordClick', () => {
  it('records click for ad', async () => {
    const ad = await createTestAd()

    const { req, res } = mockReqRes({ params: { id: ad.id }, cookies: {} })
    await recordClick(req, res)
    expect(res.json.mock.calls[0][0].recorded).toBe(true)
  })
})

describe('getAdClicks', () => {
  it('returns empty clicks for new ad', async () => {
    const ad = await createTestAd()

    const { req, res } = mockReqRes({ params: { id: ad.id } })
    await getAdClicks(req, res)
    expect(res.json.mock.calls[0][0].clicks).toEqual([])
  })
})
