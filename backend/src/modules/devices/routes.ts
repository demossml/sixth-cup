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


  /**
   * GET /api/devices/catalog — enriched menu for Evotor APK (toppings, upsell, images).
   * Auth: same proxy token as resolve. Optional ?storeUuid= for per-store availability.
   */
  .get('/catalog',
    evotorProxyStrict,
    (c) => {
      if (!config.evotorProxyToken) throw bad('proxy_not_configured', 503)
      const storeUuid = (c.req.query('storeUuid') || c.req.header('X-Evotor-Store-Uuid') || '').slice(0, 80) || null
      const nowMs = Date.now()
      const base = (config.publicBaseUrl || '').replace(/\/+$/, '')
      const abs = (url: string | null | undefined) => {
        if (!url) return null
        if (/^https?:\/\//i.test(url)) return url
        if (!base) return url
        return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`
      }

      let products = db.prepare(`
        SELECT p.id, p.name, p.price, p.icon, p.description,
               p.image_url AS imageUrl, p.sort_order AS sortOrder,
               p.modifier_scheme_id AS schemeId,
               p.counts_as_cup AS countsAsCup, p.free_eligible AS freeEligible,
               p.recipe_text AS recipeText, p.available AS globalAvailable,
               p.category_id AS categoryId
        FROM products p
        WHERE (p.season_start_at IS NULL OR p.season_start_at<=?)
          AND (p.season_end_at IS NULL OR p.season_end_at>=?)
        ORDER BY p.sort_order, p.id
      `).all(nowMs, nowMs) as Record<string, unknown>[]

      if (storeUuid) {
        try {
          const rows = db.prepare(
            'SELECT product_id AS productId, available FROM product_store_availability WHERE store_uuid=?',
          ).all(storeUuid) as { productId: number; available: number }[]
          const map = new Map(rows.map((r) => [r.productId, r.available]))
          products = products.filter((p) => {
            const id = Number(p.id)
            if (map.has(id)) return map.get(id) === 1
            return Number(p.globalAvailable) === 1
          })
        } catch {
          products = products.filter((p) => Number(p.globalAvailable) === 1)
        }
      } else {
        products = products.filter((p) => Number(p.globalAvailable) === 1)
      }

      // evotor uuid per product (prefer link for store, else any link, else products.evotor_uuid)
      const linkRows = db.prepare(`
        SELECT product_id AS productId, store_uuid AS storeUuid, evotor_uuid AS evotorUuid
        FROM product_store_links
        WHERE evotor_uuid IS NOT NULL AND TRIM(evotor_uuid) != ''
      `).all() as { productId: number; storeUuid: string; evotorUuid: string }[]
      const uuidByProduct = new Map<number, string>()
      for (const l of linkRows) {
        if (storeUuid && l.storeUuid === storeUuid) uuidByProduct.set(l.productId, l.evotorUuid)
        else if (!uuidByProduct.has(l.productId)) uuidByProduct.set(l.productId, l.evotorUuid)
      }

      const modifiers = db.prepare(`
        SELECT id, name, price, group_key AS groupKey, sort_order AS sortOrder, available
        FROM modifiers WHERE available=1 ORDER BY sort_order, id
      `).all() as { id: number; name: string; price: number; groupKey: string; sortOrder: number }[]
      const modById = new Map(modifiers.map((m) => [m.id, m]))

      const schemeItems = db.prepare(`
        SELECT scheme_id AS schemeId, modifier_id AS modifierId, required, max_count AS maxCount
        FROM modifier_scheme_items
      `).all() as { schemeId: number; modifierId: number; required: number; maxCount: number }[]
      const itemsByScheme = new Map<number, typeof schemeItems>()
      for (const it of schemeItems) {
        const arr = itemsByScheme.get(it.schemeId) || []
        arr.push(it)
        itemsByScheme.set(it.schemeId, arr)
      }

      // upsell candidates: available products not counting as cup (food/extra), max pool
      const upsellPool = products
        .filter((p) => !p.countsAsCup)
        .slice(0, 20)
        .map((p) => ({
          id: Number(p.id),
          name: String(p.name),
          price: Number(p.price),
          imageUrl: abs(p.imageUrl as string | null),
          evotorUuid: uuidByProduct.get(Number(p.id)) || null,
        }))

      const out = products.map((p) => {
        const id = Number(p.id)
        const schemeId = p.schemeId != null ? Number(p.schemeId) : null
        const toppings = schemeId
          ? (itemsByScheme.get(schemeId) || [])
              .map((it) => {
                const m = modById.get(it.modifierId)
                if (!m) return null
                return {
                  id: m.id,
                  name: m.name,
                  price: m.price,
                  groupKey: m.groupKey,
                  required: !!it.required,
                  maxCount: it.maxCount,
                }
              })
              .filter(Boolean)
          : []
        const upsell = upsellPool.filter((u) => u.id !== id).slice(0, 6)
        return {
          id,
          name: p.name,
          price: p.price,
          description: p.description ?? null,
          imageUrl: abs(p.imageUrl as string | null),
          sortOrder: p.sortOrder ?? 0,
          categoryId: p.categoryId ?? null,
          countsAsCup: !!p.countsAsCup,
          freeEligible: !!p.freeEligible,
          recipeText: p.recipeText ?? null,
          evotorUuid: uuidByProduct.get(id) || null,
          toppings,
          upsell,
        }
      })

      return c.json({
        ok: true,
        generatedAt: Math.floor(Date.now() / 1000),
        storeUuid: storeUuid || null,
        products: out,
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
