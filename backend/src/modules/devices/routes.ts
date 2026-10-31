import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { buildCatalogToppings, effectiveSchemeId, listAddonProductIds, ensureAddonSchemeSchema, resolveAddonsCategoryIds, type CatalogTopping } from '../catalog/addonScheme'
import { ensureMilkSchemeSchema, milkForProduct } from '../catalog/milkScheme'
import { productArticleNumber } from '../catalog/productIdentity'
import { hashToken, requireDevice, type DeviceEnv } from '../../middleware/device'
import { applyReceipts } from '../loyalty/receipts'
import { applyOnlineSale } from './sales'
import { checkEvotorProxyAuth, evotorProxyStrict } from '../../middleware/evotorProxy'
import { config } from '../../config'
import { resolveAndReserve } from '../loyalty/reservations'
import { log, maskCode, shortId } from '../../lib/logBuffer'
import { allowLogIngest, entryZ, ingest } from '../logs/routes'
import { staffDeviceRoutes } from '../staff/deviceRoutes'
import { getCashierMenu } from '../../lib/cashierMenu'
import { formatQueueNumber, issueQueueNumber } from '../queue/numbers'

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
  /**
   * Публичный номер заказа для печати на чеке (очередь).
   * Тот же контур, что у resolve: прокси-токен Эвотора обязателен, точка — из заголовка.
   * Номер выдаёт только сервер; при недоступности касса печатает чек без номера.
   */
  .post('/queue-number',
    evotorProxyStrict,
    zValidator('json', z.object({
      orderId: z.string().min(3).max(64).optional(),
      storeUuid: z.string().min(1).max(64).optional(),
    })),
    (c) => {
      const storeUuid = (c.req.valid('json').storeUuid
        ?? c.req.header('X-Evotor-Store-Uuid')
        ?? '').slice(0, 64)
      if (!storeUuid) throw bad('store_uuid_required', 400)
      const issued = issueQueueNumber({
        storeUuid,
        orderId: c.req.valid('json').orderId,
        ttlMs: 12 * 60 * 60 * 1000,
      })
      log.info('queue number issued', {
        store: shortId(storeUuid),
        order: shortId(issued.orderId, 8),
        number: issued.number,
      })
      return c.json({
        ok: true,
        orderId: issued.orderId,
        publicOrderNumber: formatQueueNumber(issued.number),
        periodKey: issued.periodKey,
        expiresAt: issued.expiresAt,
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
          freeStatus: r.freeStatus, res: shortId(r.reservationId, 6), vouchers: r.vouchers.length, ...who,
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
   * GET /api/devices/images/:file — serve product images through the same Evotor Cloud
   * proxy namespace as the device API. The terminal must not fetch /uploads/* directly:
   * that path may be outside the URL mask configured in the Evotor cabinet.
   */
  // Product photos are read-only; do not 503 when proxy token is unset and do not
  // require Authorization when EVOTOR_PROXY_ENFORCE is off (ADB / direct HTTPS).
  // When ENFORCE=1, Evotor Cloud must inject Authorization (same as loyalty).
  .get('/images/:file', (c) => {
    // Public product photos (menu is not a secret). Loyalty routes stay on evotorProxyStrict.
    const file = c.req.param('file')
    // Upload keys are generated by upload/routes.ts; reject traversal and nested paths.
    if (!/^[a-zA-Z0-9._-]+$/.test(file) || file === '.' || file === '..') return c.notFound()
    const path = join(config.uploadsDir, file)
    if (!existsSync(path) || !statSync(path).isFile()) return c.notFound()
    const ext = file.split('.').pop()?.toLowerCase()
    const contentType = ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : null
    // This endpoint is for cashier product photos, not arbitrary uploads/video.
    if (!contentType) return c.notFound()
    const size = statSync(path).size
    if (size <= 0 || size > config.maxUploadBytes) return c.notFound()
    return new Response(new Uint8Array(readFileSync(path)), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
  /**
   * GET /api/devices/catalog — enriched menu for Evotor APK (toppings, upsell, images).
   * Auth: same proxy token as resolve. Optional ?storeUuid= for per-store availability.
   */

  /**
   * GET /api/devices/whoami — help cashier resolve storeUuid for this terminal.
   * Optional headers: X-Evotor-Store-Uuid, X-Evotor-Device-UUID.
   * Returns storeUuid from header/query if present, else tries staff/device link or single enabled store.
   */
  .get('/whoami', (c) => {
    const storeUuid =
      (c.req.query('storeUuid') || c.req.header('X-Evotor-Store-Uuid') || '').slice(0, 80) || null
    const deviceUuid =
      (c.req.header('X-Evotor-Device-UUID') ||
        c.req.header('X-Evotor-Device-Uuid') ||
        c.req.header('X-Device-Uuid') ||
        '').slice(0, 80) || null

    let resolved = storeUuid
    let source: 'header' | 'device_link' | 'single_store' | 'none' = storeUuid ? 'header' : 'none'
    let storeName: string | null = null

    if (!resolved && deviceUuid) {
      try {
        const link = db.prepare(
          `SELECT store_uuid AS storeUuid FROM staff_device_link WHERE device_uuid=? LIMIT 1`,
        ).get(deviceUuid) as { storeUuid: string } | undefined
        if (link?.storeUuid) {
          resolved = link.storeUuid
          source = 'device_link'
        }
      } catch { /* table optional */ }
      try {
        if (!resolved) {
          const d = db.prepare(
            `SELECT store_uuid AS storeUuid FROM devices WHERE device_uuid=? AND (revoked=0 OR revoked IS NULL) LIMIT 1`,
          ).get(deviceUuid) as { storeUuid: string } | undefined
          if (d?.storeUuid) {
            resolved = d.storeUuid
            source = 'device_link'
          }
        }
      } catch { /* */ }
    }

    if (!resolved) {
      try {
        const rows = db.prepare(
          `SELECT store_uuid AS storeUuid, name FROM evotor_stores WHERE sync_enabled=1 ORDER BY name LIMIT 2`,
        ).all() as { storeUuid: string; name: string }[]
        if (rows.length === 1) {
          resolved = rows[0].storeUuid
          storeName = rows[0].name
          source = 'single_store'
        }
      } catch {
        try {
          const rows = db.prepare(
            `SELECT evotor_uuid AS storeUuid, name FROM stores LIMIT 2`,
          ).all() as { storeUuid: string; name: string }[]
          if (rows.length === 1) {
            resolved = rows[0].storeUuid
            storeName = rows[0].name
            source = 'single_store'
          }
        } catch { /* */ }
      }
    }

    if (resolved && !storeName) {
      try {
        const s = db.prepare(
          `SELECT name FROM evotor_stores WHERE store_uuid=? LIMIT 1`,
        ).get(resolved) as { name: string } | undefined
        storeName = s?.name ?? null
      } catch {
        try {
          const s = db.prepare(
            `SELECT name FROM stores WHERE evotor_uuid=? OR uuid=? LIMIT 1`,
          ).get(resolved, resolved) as { name: string } | undefined
          storeName = s?.name ?? null
        } catch { /* */ }
      }
    }

    return c.json({
      ok: true,
      storeUuid: resolved,
      storeName,
      deviceUuid,
      source,
    })
  })

  .get('/catalog',
    (c) => {
      // Public read-only menu for cashier APK (no token in APK by design).
      // EVOTOR_PROXY_ENFORCE still protects /loyalty/* and sales via evotorProxyStrict.
      const storeUuid = (c.req.query('storeUuid') || c.req.header('X-Evotor-Store-Uuid') || '').slice(0, 80) || null
      const nowMs = Date.now()
      // Always absolute HTTPS for cashier ThumbLoader (rejects relative /uploads).
      const base = (config.publicBaseUrl || 'https://app.67coffee.ru').replace(/\/+$/, '')
      // Uploaded product images must use /api/devices/* so Evotor Cloud's configured
      // URL mask/proxy and injected Authorization header apply to the binary request too.
      // Keep the admin's /uploads/* URLs unchanged in storage; rewrite only in this API.
      const deviceImageUrl = (url: string | null | undefined) => {
        if (!url) return null
        let pathname = url
        try {
          if (/^https?:\/\//i.test(url)) {
            const parsed = new URL(url)
            const configured = base ? new URL(base) : null
            if (configured && parsed.host !== configured.host) return url
            pathname = parsed.pathname
          }
        } catch { return url }
        const match = /^\/?uploads\/([a-zA-Z0-9._-]+)$/.exec(pathname)
        if (!match || match[1] === '.' || match[1] === '..') {
          // Already-proxied URLs are retained; unrelated external URLs keep old behavior.
          if (/^https?:\/\//i.test(url)) return url
          if (/^\/?api\/devices\/images\/[a-zA-Z0-9._-]+$/.test(url)) {
            return `${base}/${url.replace(/^\//, '')}`
          }
          // Relative non-upload paths: still force absolute so Android accepts them.
          if (url.startsWith('/')) return `${base}${url}`
          return url
        }
        const path = `/api/devices/images/${encodeURIComponent(match[1])}`
        return `${base}${path}`
      }

      let products = db.prepare(`
        SELECT p.id, p.name, p.price, p.icon, p.description,
               p.image_url AS imageUrl, p.sort_order AS sortOrder,
               p.modifier_scheme_id AS skuSchemeId, g.modifier_scheme_id AS groupSchemeId,
               p.counts_as_cup AS countsAsCup, p.free_eligible AS freeEligible,
               p.recipe_text AS recipeText, p.available AS globalAvailable,
               p.category_id AS categoryId,
               p.group_id AS groupId, p.variant_label AS variantLabel, p.variant_sort AS variantSort,
               p.size_value AS sizeValue, p.size_unit AS sizeUnit,
               COALESCE(p.is_group, 0) AS isGroup,
               p.parent_product_id AS parentProductId,
               p.milk_scheme_id AS milkSchemeId
        FROM products p
        LEFT JOIN product_groups g ON g.id = p.group_id
        WHERE (p.season_start_at IS NULL OR p.season_start_at<=?)
          AND (p.season_end_at IS NULL OR p.season_end_at>=?)
        ORDER BY p.sort_order, p.id
      `).all(nowMs, nowMs) as Record<string, unknown>[]

      // Добавки вычисляем ДО фильтра доступности: товар-добавка, выключенный для точки,
      // всё равно должен доехать до кассы с hideFromMenu — иначе APK покажет его плиткой,
      // пока SKU остаётся продаваемым в Эвоторе.
      ensureAddonSchemeSchema(db)
      const addonProductIds = listAddonProductIds(db)
      const allProducts = products

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

      const keptIds = new Set(products.map((p) => Number(p.id)))
      const droppedAddons = allProducts.filter(
        (p) => Number(p.globalAvailable) === 1 && !keptIds.has(Number(p.id)) && addonProductIds.has(Number(p.id)),
      )
      if (droppedAddons.length) products = products.concat(droppedAddons)

      // evotor uuid per product (prefer link for store, else any link, else products.evotor_uuid)
      const linkRows = db.prepare(`
        SELECT product_id AS productId, store_uuid AS storeUuid, evotor_uuid AS evotorUuid
        FROM product_store_links
        WHERE evotor_uuid IS NOT NULL AND TRIM(evotor_uuid) != ''
      `).all() as { productId: number; storeUuid: string; evotorUuid: string }[]
      // Multi-store: when storeUuid is set, NEVER fall back to another store's uuid.
      // Missing link for this store ⇒ product/topping evotorUuid stays null (cashier merge skips).
      const uuidByProduct = new Map<number, string>()
      /** У товара есть строка связи с этой точкой — даже если uuid в ней пуст (после wipe). */
      const linkedToStore = new Set<number>()
      if (storeUuid) {
        for (const l of linkRows) {
          if (l.storeUuid === storeUuid) uuidByProduct.set(l.productId, l.evotorUuid)
        }
        // linkRows отфильтрованы по непустому uuid, поэтому «связь без uuid» берём отдельно.
        const linkedRows = db.prepare('SELECT product_id AS productId FROM product_store_links WHERE store_uuid=?')
          .all(storeUuid) as { productId: number }[]
        for (const r of linkedRows) linkedToStore.add(Number(r.productId))
      } else {
        // Legacy APK without storeUuid — first non-empty link (discouraged for multi-store).
        for (const l of linkRows) {
          if (!uuidByProduct.has(l.productId)) uuidByProduct.set(l.productId, l.evotorUuid)
        }
      }

      const modifiers = db.prepare(`
        SELECT id, name, price, group_key AS groupKey, sort_order AS sortOrder, available,
               linked_product_id AS linkedProductId
        FROM modifiers WHERE available=1 ORDER BY sort_order, id
      `).all() as { id: number; name: string; price: number; groupKey: string; sortOrder: number; linkedProductId?: number | null }[]

      const normalizeModifierName = (value: unknown) =>
        String(value ?? '')
          .normalize('NFKC')
          .toLocaleLowerCase('ru-RU')
          .replace(/ё/g, 'е')
          .replace(/\s+/g, ' ')
          .trim()
      const productIdByName = new Map<string, number>()
      for (const r of db.prepare(`SELECT id, name FROM products WHERE available=1 ORDER BY id`).all() as { id: number; name: string }[]) {
        const key = normalizeModifierName(r.name)
        if (!productIdByName.has(key)) productIdByName.set(key, Number(r.id))
      }
      const modifierProductIds = new Set<number>(addonProductIds)
      for (const m of modifiers) {
        if (m.linkedProductId != null) modifierProductIds.add(Number(m.linkedProductId))
        const pid = productIdByName.get(normalizeModifierName(m.name))
        if (pid != null) modifierProductIds.add(pid)
      }

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
        .filter((p) => Number(p.isGroup) !== 1)
        .filter((p) => !modifierProductIds.has(Number(p.id)))
        .slice(0, 20)
        .map((p) => ({
          id: Number(p.id),
          name: String(p.name),
          price: Number(p.price),
          imageUrl: deviceImageUrl(p.imageUrl as string | null),
          evotorUuid: uuidByProduct.get(Number(p.id)) || null,
        }))

      // Category names for chips on the cashier (Evotor parent groups may be empty).
      const catRows = db.prepare(
        `SELECT id, name, sort_order AS sortOrder FROM categories ORDER BY sort_order, id`,
      ).all() as { id: number; name: string; sortOrder: number }[]
      const catNameById = new Map(catRows.map((r) => [r.id, r.name]))

      const isFeatured = (name: string, description: string | null | undefined) => {
        const d = String(description || '')
        if (/#focus\b/i.test(d) || /#combo\b/i.test(d)) return true
        if (String(name || '').includes(' + ')) return true
        return false
      }

      // One DB read per scheme instead of one per product (was N+1: full products/modifiers scans).
      const toppingsCache = new Map<number, CatalogTopping[]>()
      const effectiveCache = new Map<string, number | null>()
      // Схема молока — отдельная сущность: свой набор вариантов, свой резолв UUID по точке.
      ensureMilkSchemeSchema(db)
      const milkCache = new Map<number | null, ReturnType<typeof milkForProduct>>()
      const out = products.map((p) => {
        const id = Number(p.id)
        const skuScheme = p.skuSchemeId != null ? Number(p.skuSchemeId) : null
        const grpScheme = p.groupSchemeId != null ? Number(p.groupSchemeId) : null
        const effKey = `${skuScheme}:${grpScheme}`
        let schemeId = effectiveCache.get(effKey)
        if (schemeId === undefined) {
          schemeId = effectiveSchemeId(db, skuScheme, grpScheme)
          effectiveCache.set(effKey, schemeId)
        }
        const toppings = buildCatalogToppings(db, schemeId, uuidByProduct, toppingsCache)
        const upsell = upsellPool.filter((u) => u.id !== id).slice(0, 6)
        const milkSchemeId = p.milkSchemeId != null ? Number(p.milkSchemeId) : null
        let milk = milkCache.get(milkSchemeId)
        if (milk === undefined) {
          milk = milkForProduct(db, milkSchemeId, uuidByProduct)
          milkCache.set(milkSchemeId, milk)
        }
        const evotorUuid = uuidByProduct.get(id) || null
        // server-режим кассы: плитка продаётся, только если товар реально есть в номенклатуре точки.
        // Строку из products не убираем — старым кассам нужен полный список с hideFromMenu.
        const isModifierProduct = modifierProductIds.has(id)
        const isGroupProduct = Number(p.isGroup) === 1
        const hidden = isModifierProduct || isGroupProduct
        const availableHere = Number(p.available ?? 1) === 1
        const sellable = !hidden && availableHere && Boolean(evotorUuid)
        const notReadyReason = sellable
          ? null
          : hidden
            ? 'hidden_modifier'
            : !availableHere
              ? 'unavailable'
              : storeUuid && !linkedToStore.has(id)
                ? 'no_store_link'
                : 'no_evotor_uuid'
        const description = (p.description as string | null) ?? null
        const categoryId = p.categoryId != null ? Number(p.categoryId) : null
        const categoryName = categoryId != null ? (catNameById.get(categoryId) || null) : null
        return {
          id,
          productId: id,
          name: p.name,
          price: p.price,
          priceRub: p.price,
          description,
          imageUrl: deviceImageUrl(p.imageUrl as string | null),
          sortOrder: p.sortOrder ?? 0,
          categoryId,
          categoryName,
          featured: isFeatured(String(p.name || ''), description),
          countsAsCup: !!p.countsAsCup && !modifierProductIds.has(id),
          freeEligible: !!p.freeEligible && !modifierProductIds.has(id),
          recipeText: p.recipeText ?? null,
          recipe: p.recipeText ?? null,
          evotorUuid,
          sellable,
          notReadyReason,
          milkSchemeId,
          /** Варианты молока для кассы; пустой массив — схемы нет (это норма). */
          milk,
          // Стабильная связка с ProductTable.ROW_CODE на терминале (см. productIdentity.ts).
          articleNumber: productArticleNumber(id),
          groupId: p.groupId != null ? Number(p.groupId) : null,
          variantLabel: (p.variantLabel as string | null) ?? null,
          variantSort: Number(p.variantSort ?? 0),
          sizeValue: p.sizeValue != null ? Number(p.sizeValue) : null,
          sizeUnit: (p.sizeUnit as string | null) ?? null,
          toppings,
          upsell,
          isModifier: modifierProductIds.has(id),
          isGroup: Number(p.isGroup) === 1,
          parentProductId: (p.parentProductId as number | null) ?? null,
          hideFromMenu: modifierProductIds.has(id) || Number(p.isGroup) === 1,
        }
      })

      // Меню настраивается по каждой кассе (админка → Касса → «Меню на кассе»).
      const cashierMenu = getCashierMenu(storeUuid)
      const norm = (v: unknown) => String(v).toLocaleLowerCase('ru-RU')
      const hiddenGroupNames = new Set(cashierMenu.hiddenGroups.map(norm))
      const visibleRows = catRows
        .filter((r) => out.some((p) => p.categoryId === r.id && !p.hideFromMenu))
        .filter((r) => !hiddenGroupNames.has(norm(r.name)))
      const categories = visibleRows.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sortOrder }))
      // Порядок: если у точки задан свой — уважаем его, остальные группы дописываем
      // в порядке categories.sort_order. Иначе — просто sort_order.
      const byName = new Map(visibleRows.map((r) => [norm(r.name), String(r.name)]))
      const ordered: string[] = []
      for (const name of cashierMenu.order) {
        const real = byName.get(norm(name))
        if (real && !ordered.includes(real)) ordered.push(real)
      }
      for (const r of visibleRows) if (!ordered.includes(String(r.name))) ordered.push(String(r.name))
      // `hidden` нужен кассе явно: из order группа пропадает, но товары остаются в products,
      // и без этого списка терминал дорисовал бы её чип в конце по алфавиту.
      const menu = {
        showAllTab: cashierMenu.showAllTab,
        order: ordered,
        hidden: catRows.filter((r) => hiddenGroupNames.has(norm(r.name))).map((r) => r.name),
      }

      // Размеры одного товара: APK рисует одну плитку и подставляет UUID выбранного варианта.
      // groups содержит только карточки с 2+ доступными вариантами; одиночные идут как обычные products.
      let groups: Record<string, unknown>[] = []
      try {
        const groupRows = db.prepare(`
          SELECT id, name, image_url AS imageUrl, category_id AS categoryId, description, sort_order AS sortOrder
          FROM product_groups ORDER BY sort_order, id
        `).all() as Record<string, unknown>[]
        groups = groupRows
          .map((g) => {
            const variants = out
              .filter((p) => p.groupId === Number(g.id))
              .sort((a, b) => a.variantSort - b.variantSort || a.id - b.id)
              .map((p) => ({
                productId: p.id,
                evotorUuid: p.evotorUuid,
                label: p.variantLabel,
                price: p.price,
                priceRub: p.priceRub,
                sizeValue: p.sizeValue,
                sizeUnit: p.sizeUnit,
                countsAsCup: p.countsAsCup,
                freeEligible: p.freeEligible,
              }))
            return {
              id: Number(g.id),
              name: g.name,
              imageUrl: deviceImageUrl(g.imageUrl as string | null),
              categoryId: g.categoryId != null ? Number(g.categoryId) : null,
              description: g.description ?? null,
              sortOrder: Number(g.sortOrder ?? 0),
              variants,
            }
          })
          .filter((g) => g.variants.length > 1)
      } catch {
        groups = []
      }

      // Флаг для APK: server-режим включается явно (?serverCatalog=1) или по версии кассы ≥ 140.
      // Пока новая касса не раскатана, по умолчанию false — старые кассы не ждут новых полей.
      const appVersionCode = Number(c.req.header('X-App-Version-Code') ?? NaN)
      const serverCatalog = c.req.query('serverCatalog') === '1'
        || (Number.isFinite(appVersionCode) && appVersionCode >= 140)
      // Диагностика для админки: чего не хватает до полной витрины (не удаляем позиции из products).
      const notReadySummary = out
        .filter((p) => !p.sellable)
        .slice(0, 50)
        .map((p) => ({ productId: p.id, name: p.name, reason: p.notReadyReason }))

      return c.json({
        ok: true,
        generatedAt: Math.floor(Date.now() / 1000),
        storeUuid: storeUuid || null,
        features: { serverCatalog },
        notReadySummary,
        categories,
        menu,
        // Все категории-добавки: APK скрывает товар по categoryId, не по названию.
        addonCategoryIds: resolveAddonsCategoryIds(db),
        products: out,
        groups,
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

  .route('/', staffDeviceRoutes)
