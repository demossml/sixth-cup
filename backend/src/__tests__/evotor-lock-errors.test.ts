import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-evlock-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { config } = await import('../config')
const { describeEvotorError } = await import('../modules/admin/consoleLib')
const { tryLock, unlock, lockedBy, lockKey, resetLocks } = await import('../lib/storeLocks')
const { PollService } = await import('../integrations/evotor/sync/PollService')
const { EvotorApiError } = await import('../integrations/evotor/client/EvotorClient')
const { createToken } = await import('../integrations/evotor/tokenStore')

const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }
const STORE = '20261017-AD69-40F0-80D2-3C027B1A4BF8'

function storeRow(uuid: string) {
  db.prepare(
    `INSERT OR IGNORE INTO evotor_stores(store_uuid, name, sync_enabled) VALUES(?,?,1)`,
  ).run(uuid, 'Точка теста')
  db.prepare('UPDATE evotor_stores SET sync_enabled=1 WHERE store_uuid=?').run(uuid)
}

beforeEach(() => {
  resetLocks()
})

describe('single-flight по точке', () => {
  it('tryLock занимает ключ до unlock', () => {
    const key = lockKey(STORE)
    expect(tryLock(key, 'wipe')).toBe(true)
    expect(tryLock(key, 'sync')).toBe(false)
    expect(lockedBy(key)?.op).toBe('wipe')
    unlock(key)
    expect(tryLock(key, 'sync')).toBe(true)
  })

  it('второй wipe по той же точке получает 409 с понятным текстом', async () => {
    storeRow(STORE)
    const key = lockKey(STORE)
    expect(tryLock(key, 'wipe')).toBe(true)
    const r = await app.request(`/api/admin/evotor/stores/${STORE}/wipe-catalog`, { method: 'POST', headers: H })
    expect(r.status).toBe(409)
    const body = (await r.json()) as { error?: string }
    expect(JSON.stringify(body)).toMatch(/уже идёт/i)
    unlock(key)
  })

  it('sync и push по занятой точке тоже 409', async () => {
    storeRow(STORE)
    expect(tryLock(lockKey(STORE), 'sync')).toBe(true)
    expect((await app.request(`/api/admin/evotor/stores/${STORE}/sync`, { method: 'POST', headers: H })).status).toBe(409)
    unlock(lockKey(STORE))

    expect(tryLock(lockKey(STORE), 'push')).toBe(true)
    expect((await app.request(`/api/admin/evotor/stores/${STORE}/push-products`, { method: 'POST', headers: H })).status).toBe(409)
    unlock(lockKey(STORE))
  })
})

describe('describeEvotorError', () => {
  it('402 not_installed объясняется по-русски', () => {
    const raw = 'EvotorApiError: [request] GET /api/v1/inventories/stores/x/documents status=402 body={"code":"not_installed","message":"..."}'
    expect(describeEvotorError(raw)).toBe(
      'Приложение Эвотор не установлено или не оплачено на этой точке — установите/продлите его в кабинете Эвотор',
    )
  })

  it('сетевые сбои, 401, 403 и отсутствие токена', () => {
    expect(describeEvotorError('TypeError: fetch failed')).toMatch(/Нет связи/)
    expect(describeEvotorError('status=401 body={}')).toMatch(/Токен Эвотор отклонён/)
    expect(describeEvotorError('status=403 body={}')).toMatch(/запретил доступ/)
    expect(describeEvotorError('EVOTOR_API_TOKEN not set')).toMatch(/Не задан токен/)
  })

  it('пустая ошибка — null, неизвестная обрезается', () => {
    expect(describeEvotorError(null)).toBeNull()
    expect(describeEvotorError('  ')).toBeNull()
    expect(describeEvotorError('x'.repeat(400))?.length).toBe(301)
  })
})

describe('кулдаун при 402 not_installed', () => {
  it('второй tick не дёргает documents, статус точки ERROR с сырой ошибкой', async () => {
    const uuid = `${STORE}-cool`
    // в этом файле другие тесты включали свои точки — оставляем ровно одну
    db.prepare('UPDATE evotor_stores SET sync_enabled=0').run()
    createToken(db, { label: 'cool', token: 'token-cool', storeUuids: [uuid] })
    storeRow(uuid)

    let calls = 0
    const fake = {
      isConfigured: true,
      getStores: async () => ({ items: [{ uuid, name: 'Точка' }] }),
      getDocuments: async () => {
        calls++
        throw new EvotorApiError('[request] GET documents status=402 body={"code":"not_installed"}', 402, '/documents', 'GET', 'request', false)
      },
    } as any

    const poll = new PollService(db, fake)
    const first = await poll.runFast()
    expect(calls).toBe(1)
    expect(first.errors.length).toBeGreaterThan(0)
    const st = db.prepare('SELECT status, last_error AS err FROM evotor_sync_state WHERE store_uuid=?').get(uuid) as {
      status: string
      err: string
    }
    expect(st.status).toBe('ERROR')
    expect(st.err).toContain('not_installed')

    // второй tick: точка в кулдауне, к Эвотору не ходим
    const second = await poll.runFast()
    expect(calls).toBe(1)
    expect(second.errors.length).toBe(0)
  })
})
