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


  /** Каталог 6.7 для кассы: топинги, рецепт, фото, upsell. Тот же proxy-канал, что resolve. */
  .get('/catalog',
    evotorProxyStrict,
    (c) => {
      if (!config.evotorProxyToken) throw bad('proxy_not_configured', 503)
      const storeUuid = (c.req.header('X-Evotor-Store-Uuid') ?? '').trim()
      const base = (config.publicBaseUrl || '').replace(/\/+$/, '')
      const abs = (url: string | null | undefined): string | null => {
        if (!url) return null
        if (/^https?:\/\//i.test(url)) return url
        if (!base) return url
        return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`
      }

      type Link = { product_id: number; evotor_uuid: string; store_uuid: string }
      let links: Link[]
      if (storeUuid) {
        links = db.prepare(`
          SELECT product_id, evotor_uuid, store_uuid FROM product_store_links
          WHERE store_uuid=? AND evotor_uuid IS NOT NULL AND TRIM(evotor_uuid) != ''
        `).all(storeUuid) as Link[]
        // если по магазину пусто — отдать все линки (dev / один магазин)
        if (!links.length) {
          links = db.prepare(`
            SELECT product_id, evotor_uuid, store_uuid FROM product_store_links
            WHERE evotor_uuid IS NOT NULL AND TRIM(evotor_uuid) != ''
          `).all() as Link[]
        }
      } else {
        links = db.prepare(`
          SELECT product_id, evotor_uuid, store_uuid FROM product_store_links
          WHERE evotor_uuid IS NOT NULL AND TRIM(evotor_uuid) != ''
        `).all() as Link[]
      }

      const byProduct = new Map<number, Link[]>()
      for (const l of links) {
        const arr = byProduct.get(l.product_id) ?? []
        arr.push(l)
        byProduct.set(l.product_id, arr)
      }
      const productIds = [...byProduct.keys()]
      if (!productIds.length) {
        return c.json({ v: 1, t: Math.floor(Date.now() / 1000), products: [], upsellDefault: [] })
      }

      const placeholders = productIds.map(() => '?').join(',')
      const products = db.prepare(`
        SELECT id, name, price, description, image_url AS imageUrl,
               recipe_text AS recipe, recipe_cost_rub AS recipeCostRub, recipe_seconds AS recipeSeconds,
               counts_as_cup AS countsAsCup, free_eligible AS freeEligible,
               modifier_scheme_id AS schemeId, available
        FROM products
        WHERE id IN (${placeholders}) AND available=1
      `).all(...productIds) as Array<{
        id: number; name: string; price: number; description: string | null; imageUrl: string | null
        recipe: string | null; recipeCostRub: number | null; recipeSeconds: number | null
        countsAsCup: number; freeEligible: number; schemeId: number | null; available: number
      }>

      const schemeIds = [...new Set(products.map((p) => p.schemeId).filter((x): x is number => x != null))]
      const toppingsByScheme = new Map<number, Array<{ id: number; name: string; priceRub: number; groupKey: string; maxCount: number }>>()
      if (schemeIds.length) {
        const sp = schemeIds.map(() => '?').join(',')
        const rows = db.prepare(`
          SELECT i.scheme_id AS schemeId, m.id, m.name, m.price AS priceRub, m.group_key AS groupKey,
                 COALESCE(i.max_count, 2) AS maxCount
          FROM modifier_scheme_items i
          JOIN modifiers m ON m.id = i.modifier_id
          WHERE i.scheme_id IN (${sp}) AND m.available=1
          ORDER BY m.sort_order, m.id
        `).all(...schemeIds) as Array<{ schemeId: number; id: number; name: string; priceRub: number; groupKey: string; maxCount: number }>
        for (const r of rows) {
          const arr = toppingsByScheme.get(r.schemeId) ?? []
          arr.push({ id: r.id, name: r.name, priceRub: r.priceRub, groupKey: r.groupKey || 'extra', maxCount: r.maxCount })
          toppingsByScheme.set(r.schemeId, arr)
        }
      }

      // upsell: товары с #upsell в description или group_key-like — по description tag
      const upsellCandidates = db.prepare(`
        SELECT id, name, price, image_url AS imageUrl FROM products
        WHERE available=1 AND (
          lower(COALESCE(description,'')) LIKE '%#upsell%'
          OR lower(COALESCE(name,'')) LIKE '%круассан%'
        )
        ORDER BY sort_order, id LIMIT 20
      `).all() as Array<{ id: number; name: string; price: number; imageUrl: string | null }>

      const out = products.map((p) => {
        const plinks = byProduct.get(p.id) ?? []
        const primary = storeUuid ? (plinks.find((l) => l.store_uuid === storeUuid) ?? plinks[0]) : plinks[0]
        const toppings = p.schemeId != null ? (toppingsByScheme.get(p.schemeId) ?? []) : []
        const upsell = upsellCandidates
          .filter((u) => u.id !== p.id)
          .slice(0, 5)
          .map((u) => {
            const ul = byProduct.get(u.id)?.[0]
            return {
              productId: u.id,
              evotorUuid: ul?.evotor_uuid ?? null,
              name: u.name,
              priceRub: u.price,
              imageUrl: abs(u.imageUrl),
            }
          })
        return {
          productId: p.id,
          evotorUuid: primary?.evotor_uuid ?? null,
          name: p.name,
          priceRub: p.price,
          imageUrl: abs(p.imageUrl),
          recipe: p.recipe,
          recipeCostRub: p.recipeCostRub,
          recipeSeconds: p.recipeSeconds,
          countsAsCup: p.countsAsCup === 1,
          freeEligible: p.freeEligible === 1,
          schemeId: p.schemeId,
          toppings,
          upsell,
        }
      }).filter((p) => p.evotorUuid)

      const upsellDefault = upsellCandidates.slice(0, 8).map((u) => {
        const ul = byProduct.get(u.id)?.[0]
        return {
          productId: u.id,
          evotorUuid: ul?.evotor_uuid ?? null,
          name: u.name,
          priceRub: u.price,
          imageUrl: abs(u.imageUrl),
        }
      }).filter((u) => u.evotorUuid)

      log.info('device catalog', { store: shortId(storeUuid || 'any'), n: out.length, toppingsSchemes: schemeIds.length })
      return c.json({
        v: 1,
        t: Math.floor(Date.now() / 1000),
        products: out,
        upsellDefault,
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
