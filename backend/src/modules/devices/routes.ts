import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { hashToken, requireDevice, type DeviceEnv } from '../../middleware/device'
import { applyReceipts } from '../loyalty/receipts'
import { applyOnlineSale } from './sales'
import { checkEvotorProxyAuth, evotorProxyStrict } from '../../middleware/evotorProxy'
import { config } from '../../config'
import { resolveAndReserve } from '../loyalty/reservations'
import { log, maskCode, shortId } from '../../lib/logBuffer'
import { allowLogIngest, entryZ, ingest } from '../logs/routes'

export const deviceRoutes = new Hono<DeviceEnv>()
  .get('/ping', (c) => {
    const auth = c.req.header('Authorization')
    const authOk = checkEvotorProxyAuth(auth)
    if (config.evotorProxyToken && !authOk && config.evotorProxyEnforce) {
      throw bad('proxy_forbidden', 403)
    }
    // log once per process shape, not the secret
    const raw = auth ? (auth.startsWith('Bearer ') ? 'Bearer+len=' + (auth.length - 7) : 'raw+len=' + auth.length) : 'missing'
    console.info('[evotor/ping]', raw, 'authOk=', authOk)
    const storeUuid = (c.req.header('X-Evotor-Store-Uuid') ?? '').slice(0, 4)
    const deviceUuid = (c.req.header('X-Evotor-Device-UUID') ?? '').slice(0, 4)
    return c.json({
      ok: true,
      t: Math.floor(Date.now() / 1000),
      proxy: { authOk, storeUuid: storeUuid || undefined, deviceUuid: deviceUuid || undefined },
    })
  })
  .post('/loyalty/resolve',
    evotorProxyStrict,
    zValidator('json', z.object({ code: z.string().min(1).max(4000) })),
    (c) => {
      // Reserving bonuses must never be reachable without the shared proxy secret.
      if (!config.evotorProxyToken) throw bad('proxy_not_configured', 503)
      const storeUuid = (c.req.header('X-Evotor-Store-Uuid') ?? '').slice(0, 64) || undefined
      const deviceUuid = (c.req.header('X-Evotor-Device-UUID') ?? '').slice(0, 64) || undefined
      const key = `resolve:${deviceUuid ?? storeUuid ?? 'any'}`
      const now = Date.now()
      const row = db.prepare('SELECT count, window_start FROM rate_limits WHERE key=?').get(key) as { count: number; window_start: number } | undefined
      if (!row || now - row.window_start > 60_000) {
        db.prepare('INSERT OR REPLACE INTO rate_limits(key,count,window_start) VALUES(?,?,?)').run(key, 1, now)
      } else if (row.count >= 60) {
        log.warn('loyalty resolve rate-limited', { store: shortId(storeUuid), dev: shortId(deviceUuid) })
        throw bad('Too many requests', 429)
      } else {
        db.prepare('UPDATE rate_limits SET count=count+1 WHERE key=?').run(key)
      }
      const code = c.req.valid('json').code
      const r = resolveAndReserve({ code, storeUuid, deviceUuid })
      const who = { store: shortId(storeUuid), dev: shortId(deviceUuid) }
      if (r.ok) {
        log.info('loyalty resolve ok', {
          card: maskCode(r.cardCode), kind: r.kind, free: r.freeAvailable, cbKop: r.cashbackReserved,
          freeStatus: r.freeStatus, res: shortId(r.reservationId, 6), ...who,
        })
      } else {
        log.warn(`loyalty resolve fail: ${r.error}`, { card: maskCode(code), ...who })
      }
      return c.json(r, r.ok ? 200 : 404)
    })
  /**
   * POST /api/devices/logs — till (Evotor APK) reports scan / resolve / discount events.
   * Same auth as resolve: valid EVOTOR_PROXY_TOKEN is mandatory. Body: { level?, message, meta? } or { entries: [...≤20] }.
   * Card codes in meta (keys `code`/`card`) are masked, token-like values are redacted by the log buffer.
   */
  .post('/logs',
    evotorProxyStrict,
    bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
    zValidator('json', z.union([
      z.object({ entries: z.array(entryZ).min(1).max(20) }),
      entryZ,
    ])),
    (c) => {
      if (!config.evotorProxyToken) throw bad('proxy_not_configured', 503)
      const storeUuid = (c.req.header('X-Evotor-Store-Uuid') ?? '').slice(0, 64) || undefined
      const deviceUuid = (c.req.header('X-Evotor-Device-UUID') ?? '').slice(0, 64) || undefined
      if (!allowLogIngest(`device:${deviceUuid ?? storeUuid ?? 'any'}`, 120)) throw bad('Too many requests', 429)
      const body = c.req.valid('json')
      ingest('device', 'entries' in body ? body.entries : [body], `(${shortId(storeUuid)}/${shortId(deviceUuid)})`)
      return c.json({ ok: true })
    })
  .post('/enroll',
    zValidator('json', z.object({ code: z.string().min(4).max(20), publicKey: z.string().min(0).max(64).optional() })),
    (c) => {
      const { code, publicKey } = c.req.valid('json')
      const d = db.prepare('SELECT id, store_id FROM devices WHERE enroll_code=? AND revoked=0')
        .get(code.toUpperCase()) as { id: number; store_id: number } | undefined
      if (!d) throw bad('Код регистрации не найден', 404)
      const token = randomBytes(24).toString('base64url')
      const pk = publicKey && publicKey.length > 0 ? publicKey : 'evotor-no-key'
      db.prepare('UPDATE devices SET public_key=?, token_hash=?, enroll_code=NULL WHERE id=?')
        .run(pk, hashToken(token), d.id)
      const store = db.prepare('SELECT name FROM stores WHERE id=?').get(d.store_id) as { name: string }
      const org = db.prepare(
        `SELECT o.legal_name as legalName, o.tax_regime as taxRegime, o.vat_rate as vatRate
         FROM stores s LEFT JOIN organizations o ON o.id = s.organization_id WHERE s.id=?`
      ).get(d.store_id) as { legalName?: string; taxRegime?: string; vatRate?: number } | undefined
      return c.json({
        ok: true,
        deviceId: d.id,
        deviceToken: token,
        storeId: d.store_id,
        storeName: store.name,
        organization: org ?? null,
      })
    })

  .use('/sync', requireDevice)
  .post('/sync', zValidator('json', z.object({ receipts: z.array(z.string().max(3000)).max(200) })), (c) => {
    const result = applyReceipts(c.req.valid('json').receipts)
    return c.json({ result })
  })

  .use('/sales', requireDevice)
  .post('/sales', zValidator('json', z.object({
    cardToken: z.string().min(20).max(4000),
    fiscalId: z.string().min(3).max(80),
    amountRub: z.number().int().min(0).max(1_000_000),
    useFree: z.boolean().default(false),
    cashbackUseRub: z.number().int().min(0).max(50_000).default(0),
    items: z.array(z.object({
      productId: z.number().int().optional(),
      name: z.string().min(1).max(120),
      qty: z.number().int().min(1).max(99),
      priceRub: z.number().int().min(0),
    })).min(1).max(50),
  })), (c) => {
    const deviceId = c.get('deviceId')
    const result = applyOnlineSale(deviceId, c.req.valid('json'))
    return c.json(result)
  })
