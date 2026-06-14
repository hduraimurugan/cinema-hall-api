import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { getPool } from '../../setup/db.js'
import { createAdmin, createHall } from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import { createScreen, editScreen, deleteScreen, getMyScreens } from '../../../controllers/screens.Controller.js'

let admin, hall

function mockReqRes(overrides = {}) {
  const req = { body: {}, params: {}, currentHallId: null, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

beforeAll(async () => {
  admin = await createAdmin()
  hall = await createHall(admin.id, { name: 'Screen Test Hall' })
})

afterEach(async () => {
  const p = getPool()
  await p.query('DELETE FROM screens')
})

const validScreen = {
  name: 'Screen A',
  total_seats: 100,
  premium_seats: 20,
  gold_seats: 30,
  silver_seats: 50,
  premium_price: 300,
  gold_price: 200,
  silver_price: 100,
  rows: 10,
  columns: 10,
  screen_position: 'left',
  layout: { rows: 10, cols: 10, seats: [] },
}

describe('createScreen', () => {
  it('creates a screen', async () => {
    const { req, res } = mockReqRes({ body: validScreen, currentHallId: hall.id })
    await createScreen(req, res)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json.mock.calls[0][0].name).toBe('Screen A')
  })
})

describe('getMyScreens', () => {
  it('returns screens for hall', async () => {
    await createScreen(mockReqRes({ body: validScreen, currentHallId: hall.id }).req, { status: vi.fn().mockReturnThis(), json: vi.fn() })

    const { req, res } = mockReqRes({ currentHallId: hall.id })
    await getMyScreens(req, res)
    expect(res.json.mock.calls[0][0]).toHaveLength(1)
  })
})

describe('editScreen', () => {
  let screenId

  beforeEach(async () => {
    const r = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    await createScreen({ body: validScreen, currentHallId: hall.id }, r)
    screenId = r.json.mock.calls[0][0].id
  })

  it('rejects invalid fields', async () => {
    const { req, res } = mockReqRes({ params: { screenId }, body: { invalid_field: true }, currentHallId: hall.id })
    await editScreen(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('updates screen name', async () => {
    const { req, res } = mockReqRes({ params: { screenId }, body: { name: 'Updated Screen' }, currentHallId: hall.id })
    await editScreen(req, res)
    expect(res.json.mock.calls[0][0].name).toBe('Updated Screen')
  })

  it('returns 404 for wrong hall', async () => {
    const { req, res } = mockReqRes({ params: { screenId }, body: { name: 'X' }, currentHallId: '00000000-0000-0000-0000-000000000000' })
    await editScreen(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })
})

describe('deleteScreen', () => {
  it('deletes owned screen', async () => {
    const r = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    await createScreen({ body: validScreen, currentHallId: hall.id }, r)
    const id = r.json.mock.calls[0][0].id

    const { req, res } = mockReqRes({ params: { screenId: id }, currentHallId: hall.id })
    await deleteScreen(req, res)
    expect(res.json.mock.calls[0][0].message).toMatch(/deleted/i)
  })

  it('returns 404 for unowned screen', async () => {
    const { req, res } = mockReqRes({ params: { screenId: '00000000-0000-0000-0000-000000000000' }, currentHallId: hall.id })
    await deleteScreen(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })
})
