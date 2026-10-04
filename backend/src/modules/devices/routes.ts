import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { hashToken, requireDevice, type DeviceEnv } from '../../middleware/device'
import { applyReceipts } from '../loyalty/receipts'
import { applyOnlineSale } from './sales'
import { checkEvotorProxyAuth, evotorProxyStrict } from '../../middleware/evotorProxy'
import { config } from '../../config'

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
