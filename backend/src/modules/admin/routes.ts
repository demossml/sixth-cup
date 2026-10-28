import { adminAssignments } from './assignments'
import { adminConsole } from './console'
import { staffAdminRoutes } from '../staff/adminRoutes'
import { auditMiddleware } from './audit'
import { enqueueProductSync } from './enqueue'
import { timingSafeEqual } from 'node:crypto'
import { looksLikeDrink } from '../loyalty/rules'
import { getCashierMenu, hasStoreMenu, resetStoreMenu, setCashierMenu } from '../../lib/cashierMenu'
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { config, TAX_REGIMES } from '../../config'
import {
  ensureAddonSchemeSchema,
  resolveAddonsCategoryId,
  loadSchemeItems,
  replaceSchemeOptions,
  loadSchemeOptions,
  syncModifierProduct,
  ensureAddonsCategory,
  ADDON_GROUPS,
  resolveAddonGroupKey,
  normalizeAddonGroupKey,
  defaultAddonMaxCount,
  schemeIdsUsingModifier,
  schemeItemsFromOptions,
  itemsPayloadToOptions,
  convertLegacyItemsToOptions,
} from '../catalog/addonScheme'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { grantVoucher } from '../vouchers/service'
import { listQueueNumbers } from '../queue/numbers'
import { resetLoyaltyData, resetCatalogData } from '../../db/seed'
import { adminEvotorCatalog } from './evotorCatalog'
import { adminEvotorTokens } from './evotorTokens'
import { queryLogs, log, LOG_SOURCES, LOG_LEVELS, type LogLevel, type LogSource } from '../../lib/logBuffer'
import { ProductPushService } from '../../integrations/evotor/sync/ProductPushService'
import { adminAnalytics } from './analytics'
import { adminAi } from './ai'
import { adminStock } from './stock'
import { adminStudio } from './studio'
import { getAiSettingsPublic } from '../../lib/aiSettings'

/** Constant-time token comparison. */
function safeEq(given: string, expected: string): boolean {
  if (!expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

type AdminRole = 'owner' | 'manager' | 'viewer'

function resolveAdminRole(given: string | undefined): AdminRole | null {
  if (typeof given !== 'string') return null
  if (safeEq(given, config.adminToken)) return 'owner'
  if (config.adminMarketerToken && safeEq(given, config.adminMarketerToken)) return 'manager'
  if (config.adminViewerToken && safeEq(given, config.adminViewerToken)) return 'viewer'
  return null
}

/**
 * Ключ группы добавки: синонимы и кириллица нормализуются к каноническому словарю
 * ([ADDON_GROUP_KEYS]). Неизвестный ключ — 400, а не тихое схлопывание в extra.
 */
const addonGroupKeySchema = z
  .string()
  .nullish()
  .superRefine((v, ctx) => {
    if (v == null || !v.trim()) return
    if (resolveAddonGroupKey(v) == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Неизвестная группа добавки: ${v}` })
    }
  })
  .transform((v) => (v == null || !v.trim() ? undefined : normalizeAddonGroupKey(v)))

/** Same table as auth/routes — failed admin token attempts per IP. */
function hitRate(key: string, max: number, windowMs: number) {
  const now = Date.now()
  const row = db.prepare('SELECT count, window_start FROM rate_limits WHERE key=?')
    .get(key) as { count: number; window_start: number } | undefined
  if (!row || now - row.window_start > windowMs) {
    db.prepare('INSERT OR REPLACE INTO rate_limits(key, count, window_start) VALUES(?,?,?)').run(key, 1, now)
    return
  }
  if (row.count >= max) throw bad('Слишком много запросов. Попробуйте позже.', 429)
  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key=?').run(key)
}

function clientIp(c: { req: { header: (n: string) => string | undefined } }): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || 'unknown'
}

/** Mutating paths the manager role may not call (anchored, so /evotor/stores/... stays allowed). */
/** Адрес медиа: пусто, наш /uploads/… или внешний http(s). Локальные пути не сохраняем. */
const mediaUrl = z
  .string()
  .max(500)
  .optional()
  .nullable()
  .refine((v) => {
    const s = (v ?? '').trim()
    if (!s) return true
    return s.startsWith('/uploads/') || /^https?:\/\//i.test(s)
  }, { message: 'Адрес медиа: /uploads/… или https://…' })

export const MANAGER_BLOCKED =
  // Full path (/api/admin/...) and Hono-stripped path (/stores, /devices/...) both blocked.
  /\/(reset|wipe)(\/|$)|\/organizations(\/|$)|(?:^|\/)api\/admin\/(stores|devices)(\/|$)|^\/(stores|devices)(\/|$)|\/ai\/settings(\/|$)|\/vouchers\/grant-all(\/|$)|\/voucher-templates(\/|$)/

const adminAuth = createMiddleware(async (c, next) => {
  const role = resolveAdminRole(c.req.header('X-Admin-Token'))
  if (!role) {
    hitRate(`admin-ip:${clientIp(c)}`, 30, 15 * 60_000)
    throw bad('Forbidden', 403)
  }
  c.set('adminRole' as never, role as never)
  // Viewer: only safe methods
  if (role === 'viewer' && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    throw bad('Read-only admin token', 403)
  }
  // manager = content + analytics: no reset/wipe, no organizations/stores/tills (enrolment), no AI key, no mass vouchers
  if (role === 'manager' && c.req.method !== 'GET' && MANAGER_BLOCKED.test(c.req.path)) {
    throw bad('Insufficient role', 403)
  }
  await next()
})

/** Who am I (for UI). */


const taxRegimeZ = z.enum(TAX_REGIMES)

export const adminRoutes = new Hono()
  .use('*', adminAuth)
  .use('*', auditMiddleware)

  .get('/me', (c) => {
    const role = ((c as { get: (k: string) => string }).get('adminRole') || 'owner') as string
    const ai = getAiSettingsPublic()
    return c.json({
      role,
      canWrite: role === 'owner' || role === 'manager',
      canReset: role === 'owner' && config.adminAllowReset,
      aiEnabled: ai.enabled,
      aiReady: ai.ready,
      aiModel: ai.model,
      permissions: role === 'owner'
        ? ['read', 'write', 'content', 'analytics', 'ai', 'reset']
        : role === 'manager'
          ? ['read', 'write', 'content', 'analytics', 'ai']
          : ['read'],
    })
  })

  /**
   * GET /api/admin/logs?lines=50&source=all|server|client|device&level=all|error|warn|info
   * → { lines: ["ISO [source] [level] message"], available, generatedAt }
   * `source=device` is the till; `kassa` is accepted as an alias. `available` counts lines matching the filters.
   */
  .get('/logs', (c) => {
    const n = Number(c.req.query('lines') ?? 50)
    const rawSource = (c.req.query('source') ?? 'all').toLowerCase()
    const rawLevel = (c.req.query('level') ?? 'all').toLowerCase()
    const source = rawSource === 'kassa' ? 'device' : rawSource
    if (source !== 'all' && !LOG_SOURCES.includes(source as LogSource)) throw bad('invalid source', 400)
    if (rawLevel !== 'all' && !LOG_LEVELS.includes(rawLevel as LogLevel)) throw bad('invalid level', 400)
    const r = queryLogs({
      lines: Number.isFinite(n) ? n : 50,
      source: source as LogSource | 'all',
      level: rawLevel as LogLevel | 'all',
    })
    return c.json({ lines: r.lines, available: r.available, total: r.total, generatedAt: Date.now() })
  })
  /** POST /api/admin/logs/test — writes one test line so the UI can be verified end to end. */
  .post('/logs/test', (c) => {
    log.info('admin log test', { at: new Date().toISOString() })
    return c.json({ ok: true })
  })

  // —— Stats (unchanged contract) ——
  .get('/stats', (c) => {
    const users = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
    const receipts = (db.prepare('SELECT COUNT(*) AS n FROM receipts').get() as { n: number }).n
    const freeCups = (db.prepare('SELECT COALESCE(SUM(df),0) AS n FROM receipts').get() as { n: number }).n
    const cashbackGranted = (db.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM cashback_ledger').get() as { n: number }).n
    const cashbackSpent = (db.prepare('SELECT COALESCE(SUM(dcb),0) AS n FROM receipts').get() as { n: number }).n
    const amountTotal = (db.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM receipts').get() as { n: number }).n
    const dayAgo = Date.now() - 86_400_000
    const receiptsToday = (db.prepare('SELECT COUNT(*) AS n FROM receipts WHERE applied_at>=?').get(dayAgo) as { n: number }).n
    return c.json({
      users, receipts, receiptsToday, freeCups, cashbackGranted, cashbackSpent, amountTotal,
    })
  })

  /** mode: loyalty | catalog | full */
  .post('/reset', zValidator('json', z.object({
    mode: z.enum(['loyalty', 'catalog', 'full']),
    confirm: z.literal(true),
  })), (c) => {
    if (!config.adminAllowReset) throw bad('Сброс данных отключён на этом сервере (ADMIN_ALLOW_RESET=0)', 403)
    const { mode } = c.req.valid('json')
    if (mode === 'loyalty' || mode === 'full') resetLoyaltyData()
    if (mode === 'catalog' || mode === 'full') resetCatalogData()
    return c.json({ ok: true, mode })
  })

  // —— Organizations ——
  .get('/organizations', (c) => {
    const rows = db.prepare(`
      SELECT id, name, legal_name AS legalName, inn, kpp, tax_regime AS taxRegime,
             vat_rate AS vatRate, active, created_at AS createdAt, updated_at AS updatedAt
      FROM organizations ORDER BY id
    `).all()
    return c.json({ organizations: rows })
  })

  .get('/organizations/:id', (c) => {
    const id = Number(c.req.param('id'))
    const row = db.prepare(`
      SELECT id, name, legal_name AS legalName, inn, kpp, tax_regime AS taxRegime,
             vat_rate AS vatRate, active, created_at AS createdAt, updated_at AS updatedAt
      FROM organizations WHERE id=?
    `).get(id)
    if (!row) throw bad('Organization not found', 404)
    return c.json({ organization: row })
  })

  .post('/organizations', zValidator('json', z.object({
    name: z.string().min(1).max(120),
    legalName: z.string().min(1).max(200),
    inn: z.string().min(10).max(12),
    kpp: z.string().max(9).optional().nullable(),
    taxRegime: taxRegimeZ.default('usn_income'),
    vatRate: z.number().int().min(0).max(22).default(0),
    active: z.boolean().default(true),
  })), (c) => {
    const p = { ...c.req.valid('json') }
    const t = Date.now()
    const r = db.prepare(`
      INSERT INTO organizations(name, legal_name, inn, kpp, tax_regime, vat_rate, active, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(p.name, p.legalName, p.inn, p.kpp ?? null, p.taxRegime, p.vatRate, p.active ? 1 : 0, t, t)
    return c.json({ id: Number(r.lastInsertRowid) })
  })

  .patch('/organizations/:id', zValidator('json', z.object({
    name: z.string().min(1).max(120).optional(),
    legalName: z.string().min(1).max(200).optional(),
    inn: z.string().min(10).max(12).optional(),
    kpp: z.string().max(9).optional().nullable(),
    taxRegime: taxRegimeZ.optional(),
    vatRate: z.number().int().min(0).max(22).optional(),
    active: z.boolean().optional(),
  })), (c) => {
    const id = Number(c.req.param('id'))
    const cur = db.prepare('SELECT id FROM organizations WHERE id=?').get(id)
    if (!cur) throw bad('Organization not found', 404)
    const p = c.req.valid('json')
    const row = db.prepare('SELECT * FROM organizations WHERE id=?').get(id) as Record<string, unknown>
    db.prepare(`
      UPDATE organizations SET name=?, legal_name=?, inn=?, kpp=?, tax_regime=?, vat_rate=?, active=?, updated_at=?
      WHERE id=?
    `).run(
      p.name ?? row.name,
      p.legalName ?? row.legal_name,
      p.inn ?? row.inn,
      p.kpp !== undefined ? p.kpp : row.kpp,
      p.taxRegime ?? row.tax_regime,
      p.vatRate ?? row.vat_rate,
      p.active !== undefined ? (p.active ? 1 : 0) : row.active,
      Date.now(),
      id
    )
    return c.json({ ok: true })
  })

  .delete('/organizations/:id', (c) => {
    const id = Number(c.req.param('id'))
    const stores = db.prepare('SELECT COUNT(*) AS n FROM stores WHERE organization_id=?').get(id) as { n: number }
    if (stores.n > 0) throw bad('Сначала удалите или переназначьте точки', 409)
    db.prepare('DELETE FROM organizations WHERE id=?').run(id)
    return c.json({ ok: true })
  })

  // —— Stores ——
  .get('/stores', (c) => {
    const stores = db.prepare(`
      SELECT s.id, s.name, s.address, s.organization_id AS organizationId,
             o.name AS organizationName
      FROM stores s
      LEFT JOIN organizations o ON o.id = s.organization_id
      ORDER BY s.id
    `).all()
    return c.json({ stores })
  })

  .get('/stores/:id', (c) => {
    const id = Number(c.req.param('id'))
    const store = db.prepare(`
      SELECT s.id, s.name, s.address, s.organization_id AS organizationId,
             o.name AS organizationName, o.tax_regime AS taxRegime, o.vat_rate AS vatRate
      FROM stores s
      LEFT JOIN organizations o ON o.id = s.organization_id
      WHERE s.id=?
    `).get(id)
    if (!store) throw bad('Store not found', 404)
    return c.json({ store })
  })

  .post('/stores', zValidator('json', z.object({
    name: z.string().min(1).max(80),
    address: z.string().min(1).max(200),
    organizationId: z.number().int().positive(),
  })), (c) => {
    const p = c.req.valid('json')
    const org = db.prepare('SELECT id FROM organizations WHERE id=?').get(p.organizationId)
    if (!org) throw bad('Organization not found', 404)
    const r = db.prepare('INSERT INTO stores(name, address, organization_id) VALUES(?,?,?)')
      .run(p.name, p.address, p.organizationId)
    return c.json({ id: Number(r.lastInsertRowid) })
  })

  .patch('/stores/:id', zValidator('json', z.object({
    name: z.string().min(1).max(80).optional(),
    address: z.string().min(1).max(200).optional(),
    organizationId: z.number().int().positive().optional(),
  })), (c) => {
    const id = Number(c.req.param('id'))
    const cur = db.prepare('SELECT * FROM stores WHERE id=?').get(id) as
      | { name: string; address: string; organization_id: number | null }
      | undefined
    if (!cur) throw bad('Store not found', 404)
    const p = c.req.valid('json')
    if (p.organizationId != null) {
      const org = db.prepare('SELECT id FROM organizations WHERE id=?').get(p.organizationId)
      if (!org) throw bad('Organization not found', 404)
    }
    db.prepare('UPDATE stores SET name=?, address=?, organization_id=? WHERE id=?').run(
      p.name ?? cur.name,
      p.address ?? cur.address,
      p.organizationId ?? cur.organization_id,
      id
    )
    return c.json({ ok: true })
  })

  // —— Devices (existing) ——
  .delete('/stores/:id', (c) => {
    const id = Number(c.req.param('id'))
    const dev = db.prepare('SELECT COUNT(*) AS n FROM devices WHERE store_id=? AND revoked=0').get(id) as { n: number }
    if (dev.n > 0) throw bad('Есть активные кассы на точке', 409)
    db.prepare('DELETE FROM devices WHERE store_id=?').run(id)
    db.prepare('DELETE FROM stores WHERE id=?').run(id)
    return c.json({ ok: true })
  })

  .get('/devices', (c) => {
    const role = ((c as { get: (k: string) => string }).get('adminRole') || 'owner') as string
    const rows = (db.prepare(`
      SELECT d.id, d.name, d.store_id AS storeId, d.revoked, d.enroll_code AS enrollCode,
             d.public_key IS NOT NULL AS enrolled, d.created_at AS createdAt, s.name AS storeName
      FROM devices d JOIN stores s ON s.id = d.store_id ORDER BY d.id DESC`).all() as Record<string, unknown>[])
      // An enrolment code lets whoever holds it register a till: only the owner sees it.
      .map((d) => (role === 'owner' ? d : { ...d, enrollCode: null }))
    return c.json({ devices: rows })
  })

  .post('/devices', zValidator('json', z.object({ storeId: z.number().int(), name: z.string().min(1).max(60) })), (c) => {
    const { storeId, name } = c.req.valid('json')
    const store = db.prepare('SELECT id FROM stores WHERE id=?').get(storeId)
    if (!store) throw bad('Store not found', 404)
    const code = randomBytes(4).toString('hex').toUpperCase()
    const r = db.prepare('INSERT INTO devices(store_id,name,enroll_code,created_at) VALUES(?,?,?,?)')
      .run(storeId, name, code, Date.now())
    return c.json({ id: Number(r.lastInsertRowid), enrollCode: code })
  })

  .post('/devices/:id/revoke', (c) => {
    const res = db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(Number(c.req.param('id')))
    if (!res.changes) throw bad('Device not found', 404)
    return c.json({ ok: true })
  })

  .delete('/devices/:id', (c) => {
    const res = db.prepare('DELETE FROM devices WHERE id=?').run(Number(c.req.param('id')))
    if (!res.changes) throw bad('Device not found', 404)
    return c.json({ ok: true })
  })

  // —— Categories ——
  /**
   * Меню кассы настраивается по каждой точке: /cashier/menu?storeUuid=…
   * Без storeUuid — общая настройка-наследство (используется, если у точки своей нет).
   */
  .get('/cashier/menu', (c) => {
    const storeUuid = (c.req.query('storeUuid') || '').slice(0, 64) || null
    // Точку не проверяем: касса может быть ещё не синхронизирована, настраивать это не мешает.
    const menu = getCashierMenu(storeUuid)
    const all = db.prepare('SELECT name FROM categories ORDER BY sort_order, id').all() as { name: string }[]
    const norm = (v: string) => v.toLocaleLowerCase('ru-RU')
    const byName = new Map(all.map((r) => [norm(r.name), r.name]))
    const ordered: string[] = []
    for (const n of menu.order) {
      const real = byName.get(norm(n))
      if (real && !ordered.includes(real)) ordered.push(real)
    }
    for (const r of all) if (!ordered.includes(r.name)) ordered.push(r.name)
    const hidden = new Set(menu.hiddenGroups.map(norm))
    return c.json({
      storeUuid,
      own: storeUuid ? hasStoreMenu(storeUuid) : true,
      showAllTab: menu.showAllTab,
      hiddenGroups: menu.hiddenGroups,
      order: ordered.filter((n) => !hidden.has(norm(n))),
      allGroups: ordered,
    })
  })

  .patch(
    '/cashier/menu',
    zValidator('json', z.object({
      storeUuid: z.string().min(1).max(64).optional(),
      showAllTab: z.boolean().optional(),
      hiddenGroups: z.array(z.string().min(1).max(60)).max(200).optional(),
      order: z.array(z.string().min(1).max(60)).max(200).optional(),
    })),
    (c) => {
      const { storeUuid, ...patch } = c.req.valid('json')
      // Без storeUuid — общая настройка-наследство: её наследуют точки без собственной.
      const known = (db.prepare('SELECT name FROM categories').all() as { name: string }[]).map((r) => r.name)
      const knownSet = new Set(known)
      for (const n of patch.hiddenGroups ?? []) {
        if (!knownSet.has(n)) throw bad(`Группа «${n}» не найдена`, 400)
      }
      for (const n of patch.order ?? []) {
        if (!knownSet.has(n)) throw bad(`Группа «${n}» не найдена`, 400)
      }
      return c.json({ ok: true, storeUuid: storeUuid ?? null, ...setCashierMenu(patch, storeUuid ?? null) })
    },
  )

  /** Сброс точки на общую настройку. */
  .delete('/cashier/menu', (c) => {
    const storeUuid = (c.req.query('storeUuid') || '').slice(0, 64)
    if (!storeUuid) throw bad('Укажите точку', 400)
    return c.json({ ok: true, ...resetStoreMenu(storeUuid) })
  })

  .get('/categories', (c) => {
    const categories = db.prepare(`
      SELECT id, name, sort_order AS sortOrder, available, created_at AS createdAt, updated_at AS updatedAt
      FROM categories ORDER BY sort_order, id
    `).all()
    return c.json({ categories })
  })

  .get('/categories/:id', (c) => {
    const id = Number(c.req.param('id'))
    const category = db.prepare(`
      SELECT id, name, sort_order AS sortOrder, available, created_at AS createdAt, updated_at AS updatedAt
      FROM categories WHERE id=?
    `).get(id)
    if (!category) throw bad('Category not found', 404)
    return c.json({ category })
  })

  .post('/categories', zValidator('json', z.object({
    name: z.string().min(1).max(60),
    sortOrder: z.number().int().default(0),
    available: z.boolean().default(true),
  })), (c) => {
    const p = c.req.valid('json')
    const t = Date.now()
    const r = db.prepare(
      'INSERT INTO categories(name, sort_order, available, created_at, updated_at) VALUES(?,?,?,?,?)'
    ).run(p.name, p.sortOrder, p.available ? 1 : 0, t, t)
    return c.json({ id: Number(r.lastInsertRowid) })
  })

  .patch('/categories/:id', zValidator('json', z.object({
    name: z.string().min(1).max(60).optional(),
    sortOrder: z.number().int().optional(),
    available: z.boolean().optional(),
  })), (c) => {
    const id = Number(c.req.param('id'))
    const cur = db.prepare('SELECT * FROM categories WHERE id=?').get(id) as
      | { name: string; sort_order: number; available: number }
      | undefined
    if (!cur) throw bad('Category not found', 404)
    const p = c.req.valid('json')
    db.prepare('UPDATE categories SET name=?, sort_order=?, available=?, updated_at=? WHERE id=?').run(
      p.name ?? cur.name,
      p.sortOrder ?? cur.sort_order,
      p.available !== undefined ? (p.available ? 1 : 0) : cur.available,
      Date.now(),
      id
    )
    return c.json({ ok: true })
  })

  .delete('/categories/:id', (c) => {
    const id = Number(c.req.param('id'))
    const used = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id=?').get(id) as { n: number }
    if (used.n > 0) throw bad('Category has products', 409)
    db.prepare('DELETE FROM categories WHERE id=?').run(id)
    return c.json({ ok: true })
  })

  // —— Products (extended, backward compatible) ——
  .get('/products', (c) => {
    const products = db.prepare(`
      SELECT p.id, p.name, p.price, p.icon, p.available,
             p.description, p.category_id AS categoryId, p.image_url AS imageUrl,
             p.sort_order AS sortOrder, p.created_at AS createdAt, p.updated_at AS updatedAt,
             c.name AS categoryName,
             p.modifier_scheme_id AS modifierSchemeId,
             p.recipe_text AS recipeText,
             p.recipe_cost_rub AS recipeCostRub,
             p.recipe_seconds AS recipeSeconds,
             p.counts_as_cup AS countsAsCup, p.free_eligible AS freeEligible,
             p.size_value AS sizeValue, p.size_unit AS sizeUnit, p.calories AS calories,
             p.tax AS tax, p.measure AS measure, p.cost_price_kopecks AS costPriceKopecks,
             p.season_start_at AS seasonStartAt, p.season_end_at AS seasonEndAt,
             p.evotor_extra_json AS evotorExtraJson,
             p.catalog_source AS catalogSource, p.evotor_uuid AS evotorUuid,
             p.group_id AS groupId, p.variant_label AS variantLabel, p.variant_sort AS variantSort
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.sort_order, p.id
    `).all() as Record<string, unknown>[]
    const links = db.prepare(`
      SELECT product_id AS productId, store_uuid AS storeUuid, evotor_uuid AS evotorUuid, COALESCE(enabled,1) AS enabled,
             last_pushed_at AS lastPushedAt, last_pulled_at AS lastPulledAt, last_error AS lastError
      FROM product_store_links ORDER BY store_uuid, product_id
    `).all() as Record<string, unknown>[]
    const byProduct = new Map<number, Record<string, unknown>[]>()
    for (const link of links) {
      const id = Number(link.productId)
      const list = byProduct.get(id) ?? []
      list.push(link)
      byProduct.set(id, list)
    }
    return c.json({ products: products.map((p) => ({ ...p, evotorLinks: byProduct.get(Number(p.id)) ?? [] })) })
  })

  .post('/products', zValidator('json', z.object({
    id: z.number().int().optional(),
    name: z.string().min(1).max(60),
    price: z.number().int().min(0),
    icon: z.string().max(24).default('Coffee'),
    available: z.boolean().default(true),
    description: z.string().max(500).optional().nullable(),
    categoryId: z.number().int().positive().optional().nullable(),
    imageUrl: z.string().max(500).optional().nullable(),
    sortOrder: z.number().int().default(0),
    modifierSchemeId: z.number().int().positive().optional().nullable(),
    recipeText: z.string().max(4000).optional().nullable(),
    recipeCostRub: z.number().int().min(0).optional().nullable(),
    recipeSeconds: z.number().int().min(0).optional().nullable(),
    countsAsCup: z.boolean().optional(),
    freeEligible: z.boolean().optional(),
    sizeValue: z.number().int().min(1).max(100000).optional().nullable(),
    sizeUnit: z.enum(['g', 'ml']).optional().nullable(),
    calories: z.number().int().min(0).max(10000).optional().nullable(),
    tax: z.string().max(32).optional(),
    measure: z.string().max(16).optional(),
    costPriceKopecks: z.number().int().min(0).optional(),
    seasonStartAt: z.number().int().nullable().optional(),
    seasonEndAt: z.number().int().nullable().optional(),
    evotorExtraJson: z.string().max(20000).nullable().optional(),
    /** Optional optimistic lock (same meaning as in PATCH /products/:id); omitted by old clients. */
    expectedUpdatedAt: z.number().int().nullable().optional(),
  }).refine((v) => (v.sizeValue == null) === (v.sizeUnit == null), { message: 'Укажите и число, и единицу (г/мл) для веса/объёма', path: ['sizeUnit'] })), (c) => {
    const p = c.req.valid('json')
    if (p.categoryId != null) {
      const cat = db.prepare('SELECT id FROM categories WHERE id=?').get(p.categoryId)
      if (!cat) throw bad('Category not found', 404)
      if (p.categoryId === resolveAddonsCategoryId(db)) { p.countsAsCup = false; p.freeEligible = false }
    }
    const t = Date.now()
    if (p.id) {
      const exists = db.prepare('SELECT id, updated_at AS updatedAt FROM products WHERE id=?').get(p.id) as { id: number; updatedAt: number | null } | undefined
      if (!exists) throw bad('Product not found', 404)
      if (p.expectedUpdatedAt != null && (exists.updatedAt ?? 0) !== p.expectedUpdatedAt) {
        throw bad('Товар уже изменён кем-то другим — закройте окно и откройте товар заново', 409)
      }
      db.prepare(`
        UPDATE products SET name=?, price=?, icon=?, available=?, description=?,
          category_id=?, image_url=?, sort_order=?, updated_at=?,
          modifier_scheme_id=?, recipe_text=?, recipe_cost_rub=?, recipe_seconds=?,
          counts_as_cup=COALESCE(?, counts_as_cup), free_eligible=COALESCE(?, free_eligible),
          tax=COALESCE(?, tax), measure=COALESCE(?, measure), cost_price_kopecks=COALESCE(?, cost_price_kopecks),
          season_start_at=?, season_end_at=?, evotor_extra_json=?, catalog_source='SIXTH_CUP',
          size_value=?, size_unit=?, calories=?
        WHERE id=?
      `).run(
        p.name, p.price, p.icon, p.available ? 1 : 0,
        p.description ?? null, p.categoryId ?? null, p.imageUrl ?? null,
        p.sortOrder, t,
        p.modifierSchemeId ?? null, p.recipeText ?? null, p.recipeCostRub ?? null, p.recipeSeconds ?? null,
        p.countsAsCup === undefined ? null : (p.countsAsCup ? 1 : 0),
        p.freeEligible === undefined ? null : (p.freeEligible ? 1 : 0),
        p.tax ?? null, p.measure ?? null, p.costPriceKopecks ?? null,
        p.seasonStartAt ?? null, p.seasonEndAt ?? null, p.evotorExtraJson ?? null,
        p.sizeValue ?? null, p.sizeUnit ?? null, p.calories ?? null, p.id
      )
    } else {
      db.prepare(`
        INSERT INTO products(name,price,icon,available,description,category_id,image_url,sort_order,created_at,updated_at,
          modifier_scheme_id,recipe_text,recipe_cost_rub,recipe_seconds,counts_as_cup,free_eligible,tax,measure,cost_price_kopecks,season_start_at,season_end_at,evotor_extra_json,catalog_source,size_value,size_unit,calories)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'SIXTH_CUP',?,?,?)
      `).run(
        p.name, p.price, p.icon, p.available ? 1 : 0,
        p.description ?? null, p.categoryId ?? null, p.imageUrl ?? null,
        p.sortOrder, t, t,
        p.modifierSchemeId ?? null, p.recipeText ?? null, p.recipeCostRub ?? null, p.recipeSeconds ?? null,
        (p.countsAsCup ?? looksLikeDrink(p.name, p.icon)) ? 1 : 0, p.freeEligible ? 1 : 0, p.tax ?? 'NO_VAT', p.measure ?? 'шт',
        p.costPriceKopecks ?? 0, p.seasonStartAt ?? null, p.seasonEndAt ?? null, p.evotorExtraJson ?? null,
        p.sizeValue ?? null, p.sizeUnit ?? null, p.calories ?? null
      )
    }
    const productId = p.id ?? (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id
    enqueueProductSync([productId])
    return c.json({ ok: true, id: productId })
  })

  .delete('/products/:id', (c) => {
    const id = Number(c.req.param('id'))
    try {
      ensureAddonSchemeSchema(db)
      const ref = db.prepare(
        `SELECT COUNT(*) AS n FROM modifier_scheme_items WHERE product_id=?`,
      ).get(id) as { n: number }
      let refOptions = { n: 0 }
      try {
        refOptions = db.prepare(
          `SELECT COUNT(*) AS n FROM modifier_scheme_options WHERE product_id=?`,
        ).get(id) as { n: number }
      } catch { /* options table may be missing */ }
      if (ref && Number(ref.n) + Number(refOptions.n) > 0) {
        throw bad('Товар используется в схеме добавок — сначала уберите его из схем', 409)
      }
      const refMod = db.prepare(
        `SELECT COUNT(*) AS n FROM modifiers WHERE linked_product_id=?`,
      ).get(id) as { n: number } | undefined
      if (refMod && Number(refMod.n) > 0) {
        throw bad('Товар привязан к legacy-добавке (linked_product_id) — сначала отвяжите', 409)
      }
    } catch (e) {
      if (e && typeof e === 'object' && 'status' in e) throw e
      /* schema not ready */
    }
    db.prepare("UPDATE products SET available=0, updated_at=?, catalog_source='SIXTH_CUP' WHERE id=?").run(Date.now(), id)
    enqueueProductSync([id])
    return c.json({ ok: true, disabled: true })
  })

  // —— Размеры/объёмы: одна карточка (product_groups) → N торгуемых SKU ——
  .get('/product-groups', (c) => {
    const groups = db.prepare(`
      SELECT id, name, image_url AS imageUrl, category_id AS categoryId, description,
             modifier_scheme_id AS modifierSchemeId, counts_as_cup AS countsAsCup,
             free_eligible AS freeEligible, sort_order AS sortOrder
      FROM product_groups ORDER BY sort_order, id
    `).all() as Record<string, unknown>[]
    const rows = db.prepare(`
      SELECT id, group_id AS groupId, variant_label AS variantLabel, variant_label AS label,
             variant_sort AS variantSort,
             name, price, available, size_value AS sizeValue, size_unit AS sizeUnit,
             calories, evotor_uuid AS evotorUuid
      FROM products WHERE group_id IS NOT NULL ORDER BY variant_sort, id
    `).all() as Record<string, unknown>[]
    const byGroup = new Map<number, Record<string, unknown>[]>()
    for (const row of rows) {
      const gid = Number(row.groupId)
      const list = byGroup.get(gid) ?? []
      list.push(row)
      byGroup.set(gid, list)
    }
    return c.json({ groups: groups.map((g) => ({ ...g, variants: byGroup.get(Number(g.id)) ?? [] })) })
  })

  .post('/product-groups', zValidator('json', z.object({
    id: z.number().int().positive().optional(),
    name: z.string().min(1).max(60),
    categoryId: z.number().int().positive().nullable().optional(),
    imageUrl: z.string().max(500).nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    sortOrder: z.number().int().default(0),
    icon: z.string().max(24).default('Coffee'),
    modifierSchemeId: z.number().int().positive().nullable().optional(),
    countsAsCup: z.boolean().optional(),
    freeEligible: z.boolean().optional(),
    tax: z.string().max(32).optional(),
    measure: z.string().max(16).optional(),
    variants: z.array(z.object({
      id: z.number().int().positive().optional(),
      label: z.string().min(1).max(24),
      price: z.number().int().min(0),
      sizeValue: z.number().int().min(1).max(100000).nullable().optional(),
      sizeUnit: z.enum(['g', 'ml']).nullable().optional(),
      calories: z.number().int().min(0).max(10000).nullable().optional(),
      available: z.boolean().optional(),
    }).refine((v) => (v.sizeValue == null) === (v.sizeUnit == null), {
      message: 'Укажите и число, и единицу (г/мл)', path: ['sizeUnit'],
    })).min(1).max(12),
  }).refine((v) => new Set(v.variants.map((x) => x.label.trim().toLowerCase())).size === v.variants.length, {
    message: 'Названия размеров не должны повторяться', path: ['variants'],
  })), (c) => {
    const p = c.req.valid('json')
    if (p.categoryId != null && !db.prepare('SELECT id FROM categories WHERE id=?').get(p.categoryId)) {
      throw bad('Category not found', 404)
    }
    const t = Date.now()
    let groupId = p.id ?? null
    if (groupId != null) {
      const exists = db.prepare('SELECT id FROM product_groups WHERE id=?').get(groupId)
      if (!exists) throw bad('Group not found', 404)
      db.prepare(`
        UPDATE product_groups SET name=?, image_url=?, category_id=?, description=?,
          modifier_scheme_id=?, counts_as_cup=?, free_eligible=?, sort_order=?, updated_at=?
        WHERE id=?
      `).run(
        p.name, p.imageUrl ?? null, p.categoryId ?? null, p.description ?? null,
        p.modifierSchemeId ?? null,
        p.countsAsCup === undefined ? null : (p.countsAsCup ? 1 : 0),
        p.freeEligible === undefined ? null : (p.freeEligible ? 1 : 0),
        p.sortOrder, t, groupId,
      )
    } else {
      db.prepare(`
        INSERT INTO product_groups(name, image_url, category_id, description, modifier_scheme_id,
          counts_as_cup, free_eligible, sort_order, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
      `).run(
        p.name, p.imageUrl ?? null, p.categoryId ?? null, p.description ?? null,
        p.modifierSchemeId ?? null,
        p.countsAsCup === undefined ? null : (p.countsAsCup ? 1 : 0),
        p.freeEligible === undefined ? null : (p.freeEligible ? 1 : 0),
        p.sortOrder, t, t,
      )
      groupId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id
    }

    const kept: number[] = []
    const saved: { id: number; label: string; price: number; evotorUuid: string | null }[] = []
    p.variants.forEach((v, i) => {
      const label = v.label.trim()
      // Имя SKU на кассе должно быть однозначным: «Капучино 200 мл».
      const name = `${p.name} ${label}`.slice(0, 60)
      const available = v.available === false ? 0 : 1
      const sizeValue = v.sizeValue ?? null
      const sizeUnit = v.sizeUnit ?? null
      const calories = v.calories ?? null
      const cup = p.countsAsCup === undefined ? null : (p.countsAsCup ? 1 : 0)
      const free = p.freeEligible === undefined ? null : (p.freeEligible ? 1 : 0)
      if (v.id) {
        const exists = db.prepare('SELECT id FROM products WHERE id=?').get(v.id)
        if (!exists) throw bad('Product not found', 404)
        db.prepare(`
          UPDATE products SET name=?, price=?, icon=?, available=?, description=?, category_id=?,
            image_url=?, sort_order=?, updated_at=?, modifier_scheme_id=?,
            counts_as_cup=COALESCE(?, counts_as_cup), free_eligible=COALESCE(?, free_eligible),
            tax=COALESCE(?, tax), measure=COALESCE(?, measure),
            size_value=?, size_unit=?, calories=?, group_id=?, variant_label=?, variant_sort=?,
            catalog_source='SIXTH_CUP'
          WHERE id=?
        `).run(
          name, v.price, p.icon, available, p.description ?? null, p.categoryId ?? null,
          p.imageUrl ?? null, p.sortOrder, t, p.modifierSchemeId ?? null,
          cup, free, p.tax ?? null, p.measure ?? null,
          sizeValue, sizeUnit, calories, groupId, label, i, v.id,
        )
        kept.push(v.id)
      } else {
        db.prepare(`
          INSERT INTO products(name,price,icon,available,description,category_id,image_url,sort_order,
            created_at,updated_at,modifier_scheme_id,counts_as_cup,free_eligible,tax,measure,
            size_value,size_unit,calories,group_id,variant_label,variant_sort,catalog_source)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'SIXTH_CUP')
        `).run(
          name, v.price, p.icon, available, p.description ?? null, p.categoryId ?? null,
          p.imageUrl ?? null, p.sortOrder, t, t, p.modifierSchemeId ?? null,
          cup ?? (looksLikeDrink(name, p.icon) ? 1 : 0), free ?? 0, p.tax ?? 'NO_VAT', p.measure ?? 'шт',
          sizeValue, sizeUnit, calories, groupId, label, i,
        )
        kept.push((db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id)
      }
    })

    // Размеры, которых больше нет в карточке: снимаем с продажи (историю чеков не рвём).
    const removed = db.prepare('SELECT id FROM products WHERE group_id=?')
      .all(groupId) as { id: number }[]
    const dropped = removed.map((r) => r.id).filter((id) => !kept.includes(id))
    for (const id of dropped) {
      db.prepare("UPDATE products SET available=0, updated_at=?, catalog_source='SIXTH_CUP' WHERE id=?").run(t, id)
    }

    enqueueProductSync([...kept, ...dropped])
    const rows = db.prepare(`
      SELECT id, variant_label AS label, price, evotor_uuid AS evotorUuid
      FROM products WHERE group_id=? AND id IN (${kept.map(() => '?').join(',') || 'NULL'})
      ORDER BY variant_sort, id
    `).all(groupId, ...kept) as { id: number; label: string; price: number; evotorUuid: string | null }[]
    saved.push(...rows)
    return c.json({ ok: true, id: groupId, variants: saved, disabledVariantIds: dropped })
  })

  /** Разъединить размеры обратно в отдельные товары (группа удаляется, SKU остаются). */
  .delete('/product-groups/:id', (c) => {
    const id = Number(c.req.param('id'))
    const ids = (db.prepare('SELECT id FROM products WHERE group_id=?').all(id) as { id: number }[]).map((r) => r.id)
    db.prepare('UPDATE products SET group_id=NULL, variant_label=NULL, variant_sort=0, updated_at=? WHERE group_id=?').run(Date.now(), id)
    db.prepare('DELETE FROM product_groups WHERE id=?').run(id)
    return c.json({ ok: true, detached: ids.length })
  })

  /** Разовая привязка уже существующих добавок к товарам (идемпотентно). */
  .post('/modifiers/backfill-products', (c) => {
    ensureAddonSchemeSchema(db)
    const mods = db.prepare('SELECT id, linked_product_id AS pid FROM modifiers').all() as { id: number; pid: number | null }[]
    const ids: number[] = []
    let created = 0
    db.transaction(() => {
      for (const m of mods) {
        const before = m.pid
        const pid = syncModifierProduct(db, m.id)
        if (pid != null) ids.push(pid)
        if (before == null && pid != null) created++
      }
    })()
    enqueueProductSync(ids)
    return c.json({ ok: true, modifiers: mods.length, linked: created, products: ids.length })
  })

  .get('/modifiers', (c) => {
    ensureAddonSchemeSchema(db)
    const modifiers = db.prepare(`
      SELECT m.id, m.name, m.price, m.group_key AS groupKey, m.available, m.sort_order AS sortOrder,
             m.linked_product_id AS linkedProductId,
             (SELECT COUNT(*) FROM product_store_links l WHERE l.product_id=m.linked_product_id
                AND l.evotor_uuid IS NOT NULL AND TRIM(l.evotor_uuid)!='') AS linkedStores
      FROM modifiers m ORDER BY m.sort_order, m.id
    `).all()
    return c.json({ modifiers })
  })

  .post('/modifiers', zValidator('json', z.object({
    id: z.number().int().optional(),
    name: z.string().min(1).max(60),
    price: z.number().int().min(0),
    groupKey: z.enum(['syrup', 'topping', 'milk', 'other', 'extra']).default('other'),
    available: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
    linkedProductId: z.number().int().positive().nullable().optional(),
  })), (c) => {
    ensureAddonSchemeSchema(db)
    const body = c.req.valid('json')
    const now = Date.now()
    let modifierId = body.id
    if (body.id) {
      if (body.linkedProductId !== undefined) {
        db.prepare(`UPDATE modifiers SET name=?, price=?, group_key=?, available=?, sort_order=?, updated_at=?, linked_product_id=? WHERE id=?`)
          .run(body.name, body.price, body.groupKey, body.available ? 1 : 0, body.sortOrder, now, body.linkedProductId, body.id)
      } else {
        db.prepare(`UPDATE modifiers SET name=?, price=?, group_key=?, available=?, sort_order=?, updated_at=? WHERE id=?`)
          .run(body.name, body.price, body.groupKey, body.available ? 1 : 0, body.sortOrder, now, body.id)
      }
    } else {
      const created = db.prepare(`INSERT INTO modifiers(name,price,group_key,available,sort_order,created_at,updated_at,linked_product_id) VALUES(?,?,?,?,?,?,?,?)`)
        .run(body.name, body.price, body.groupKey, body.available ? 1 : 0, body.sortOrder, now, now, body.linkedProductId ?? null)
      modifierId = Number(created.lastInsertRowid)
    }
    let productId: number | null = null
    if (body.linkedProductId === undefined || body.linkedProductId === null) {
      productId = syncModifierProduct(db, Number(modifierId))
    } else {
      productId = body.linkedProductId
    }
    const affectedSchemes = schemeIdsUsingModifier(db, Number(modifierId))
    const affected = affectedSchemes.length
      ? db.prepare(
          `SELECT id FROM products WHERE modifier_scheme_id IN (${affectedSchemes.map(() => '?').join(',')})`,
        ).all(...affectedSchemes) as { id: number }[]
      : []
    enqueueProductSync([...affected.map((x) => x.id), ...(productId != null ? [productId] : [])])
    return c.json({ ok: true, id: modifierId, productId })
  })

  .delete('/modifiers/:id', (c) => {
    const id = Number(c.req.param('id'))
    const affectedSchemes = schemeIdsUsingModifier(db, id)
    const affected = affectedSchemes.length
      ? db.prepare(
          `SELECT id FROM products WHERE modifier_scheme_id IN (${affectedSchemes.map(() => '?').join(',')})`,
        ).all(...affectedSchemes) as { id: number }[]
      : []
    db.prepare('DELETE FROM modifiers WHERE id=?').run(id)
    enqueueProductSync(affected.map((x) => x.id))
    return c.json({ ok: true })
  })

  .get('/modifier-schemes/:id/preview', (c) => {
    ensureAddonSchemeSchema(db)
    const id = Number(c.req.param('id'))
    const scheme = db.prepare('SELECT id, name FROM modifier_schemes WHERE id=?').get(id) as { id: number; name: string } | undefined
    if (!scheme) throw bad('Scheme not found', 404)
    const options = loadSchemeOptions(db, id)
    const items = options.length ? schemeItemsFromOptions(options) : loadSchemeItems(db, id)
    const products = db.prepare(
      'SELECT id, name FROM products WHERE modifier_scheme_id=? ORDER BY sort_order, id',
    ).all(id)
    return c.json({ scheme, items, products })
  })

  /** Канонический словарь групп добавок: админка не держит свой список. */
  .get('/addon-groups', (c) => c.json({ groups: ADDON_GROUPS }))

  .get('/modifier-schemes', (c) => {
    ensureAddonSchemeSchema(db)
    const schemes = db.prepare('SELECT id, name FROM modifier_schemes ORDER BY id').all() as { id: number; name: string }[]
    return c.json({
      schemes: schemes.map((s) => {
        const options = loadSchemeOptions(db, s.id)
        // items — совместимость старой админки; при наличии options это проекция канона, а не вторая запись.
        const items = options.length ? schemeItemsFromOptions(options) : loadSchemeItems(db, s.id)
        return {
          ...s,
          items: items.map((i) => ({
            id: i.id,
            schemeId: i.schemeId,
            modifierId: i.modifierId,
            productId: i.productId,
            groupKey: i.groupKey,
            required: !!i.required,
            maxCount: i.maxCount,
            isDefault: i.isDefault === 1,
            zeroOption: i.zeroOption === 1,
            priceOverride: i.priceOverride,
            nameOverride: i.nameOverride,
            sortOrder: i.sortOrder,
          })),
          options,
        }
      }),
    })
  })

  .post('/modifier-schemes', zValidator('json', z.object({
    id: z.number().int().optional(),
    name: z.string().min(1),
    modifierIds: z.array(z.number().int()).default([]),
    copyFromSchemeId: z.number().int().optional(),
    options: z.array(z.object({
      kind: z.enum(['product','zero','modifier']),
      productId: z.number().int().positive().nullable().optional(),
      modifierId: z.number().int().positive().nullable().optional(),
      name: z.string().nullable().optional(),
      groupKey: addonGroupKeySchema,
      isDefault: z.boolean().optional(),
      required: z.boolean().optional(),
      maxCount: z.number().int().optional(),
      priceOverride: z.number().int().nullable().optional(),
      sortOrder: z.number().int().optional(),
    })).optional(),
    items: z.array(z.object({
      modifierId: z.number().int().nullable().optional(),
      productId: z.number().int().nullable().optional(),
      groupKey: addonGroupKeySchema,
      required: z.boolean().optional(),
      maxCount: z.number().int().optional(),
      isDefault: z.boolean().optional(),
      zeroOption: z.boolean().optional(),
      priceOverride: z.number().int().nullable().optional(),
      nameOverride: z.string().nullable().optional(),
      sortOrder: z.number().int().optional(),
    })).optional(),
  })), (c) => {
    ensureAddonSchemeSchema(db)
    const body = c.req.valid('json')
    const now = Date.now()
    if (body.id && !db.prepare('SELECT id FROM modifier_schemes WHERE id=?').get(body.id)) throw bad('Scheme not found', 404)
    let schemeId = body.id
    db.transaction(() => {
      if (schemeId) {
        db.prepare('UPDATE modifier_schemes SET name=?, updated_at=? WHERE id=?').run(body.name, now, schemeId)
      } else {
        const r = db.prepare('INSERT INTO modifier_schemes(name,created_at,updated_at) VALUES(?,?,?)').run(body.name, now, now)
        schemeId = Number(r.lastInsertRowid)
      }
      const hasOptions = !!body.options?.length
      const hasItems = !!body.items?.length
      if (hasOptions) {
        replaceSchemeOptions(db, schemeId!, body.options!)
        // Канон один: легаси-копию не ведём (таблица остаётся для старых схем).
        db.prepare('DELETE FROM modifier_scheme_items WHERE scheme_id=?').run(schemeId)
      } else if (hasItems) {
        // Старая админка присылает items — конвертируем в options, в items не пишем (R1).
        replaceSchemeOptions(db, schemeId!, itemsPayloadToOptions(body.items!))
        db.prepare('DELETE FROM modifier_scheme_items WHERE scheme_id=?').run(schemeId)
      } else if (body.copyFromSchemeId) {
        const sourceOptions = loadSchemeOptions(db, body.copyFromSchemeId)
        const source = sourceOptions.length
          ? sourceOptions
          : itemsPayloadToOptions(loadSchemeItems(db, body.copyFromSchemeId))
        replaceSchemeOptions(db, schemeId!, source)
        db.prepare('DELETE FROM modifier_scheme_items WHERE scheme_id=?').run(schemeId)
      } else {
        // Studio: только modifierIds. Позиции (zero/product) сохраняем, items конвертируем в канон.
        convertLegacyItemsToOptions(db, schemeId!)
        const ids = body.modifierIds ?? []
        if (ids.length === 0) {
          db.prepare(`DELETE FROM modifier_scheme_options WHERE scheme_id=? AND kind='modifier'`).run(schemeId)
        } else {
          db.prepare(`DELETE FROM modifier_scheme_options WHERE scheme_id=? AND kind='modifier'
                        AND modifier_id NOT IN (${ids.map(() => '?').join(',')})`).run(schemeId, ...ids)
          let sort = (db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM modifier_scheme_options WHERE scheme_id=?')
            .get(schemeId) as { n: number }).n
          for (const mid of ids) {
            if (db.prepare(`SELECT 1 FROM modifier_scheme_options WHERE scheme_id=? AND kind='modifier' AND modifier_id=?`).get(schemeId, mid)) continue
            const m = db.prepare('SELECT group_key AS g FROM modifiers WHERE id=?').get(mid) as { g: string } | undefined
            const gk = normalizeAddonGroupKey(m?.g)
            db.prepare(`INSERT INTO modifier_scheme_options(scheme_id,kind,modifier_id,group_key,max_count,sort_order) VALUES(?,?,?,?,?,?)`)
              .run(schemeId, 'modifier', mid, gk, defaultAddonMaxCount(gk), sort++)
          }
        }
      }
    })()
    const affected = db.prepare('SELECT id FROM products WHERE modifier_scheme_id=?').all(schemeId) as { id: number }[]
    try {
      const groups = db.prepare('SELECT id FROM product_groups WHERE modifier_scheme_id=?').all(schemeId) as { id: number }[]
      const byGroup = db.prepare('SELECT id FROM products WHERE group_id=?')
      for (const g of groups) {
        for (const row of byGroup.all(g.id) as { id: number }[]) affected.push(row)
      }
    } catch { /* optional */ }
    enqueueProductSync(affected.map((x) => x.id))
    return c.json({ ok: true, id: schemeId })
  })

  .delete('/modifier-schemes/:id', (c) => {
    const id = Number(c.req.param('id'))
    const affected = db.prepare('SELECT id FROM products WHERE modifier_scheme_id=?').all(id) as { id: number }[]
    db.prepare('UPDATE products SET modifier_scheme_id=NULL, updated_at=? WHERE modifier_scheme_id=?').run(Date.now(), id)
    try { db.prepare('DELETE FROM modifier_scheme_options WHERE scheme_id=?').run(id) } catch {}
    db.prepare('DELETE FROM modifier_scheme_items WHERE scheme_id=?').run(id)
    db.prepare('DELETE FROM modifier_schemes WHERE id=?').run(id)
    enqueueProductSync(affected.map((x) => x.id))
    return c.json({ ok: true })
  })


  // —— Catalog quality ——
  .get('/catalog/quality', (c) => {
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM products WHERE available=1`).get() as { n: number }).n
    const noPhoto = (db.prepare(`SELECT COUNT(*) AS n FROM products WHERE available=1 AND (image_url IS NULL OR TRIM(image_url)='')`).get() as { n: number }).n
    const noCategory = (db.prepare(`SELECT COUNT(*) AS n FROM products WHERE available=1 AND category_id IS NULL`).get() as { n: number }).n
    let noLink = 0
    try {
      noLink = (db.prepare(`
        SELECT COUNT(*) AS n FROM products p
        WHERE p.available=1 AND NOT EXISTS (
          SELECT 1 FROM product_store_links l WHERE l.product_id=p.id AND l.evotor_uuid IS NOT NULL AND TRIM(l.evotor_uuid)!=''
        )
      `).get() as { n: number }).n
    } catch {
      noLink = -1
    }
    const noScheme = (db.prepare(`
      SELECT COUNT(*) AS n FROM products WHERE available=1 AND counts_as_cup=1 AND modifier_scheme_id IS NULL
    `).get() as { n: number }).n
    return c.json({ total, noPhoto, noCategory, noLink, noScheme })
  })

  // —— Per-store availability ——
  .get('/products/:id/availability', (c) => {
    const id = Number(c.req.param('id'))
    const rows = db.prepare(
      `SELECT store_uuid AS storeUuid, available, updated_at AS updatedAt, updated_by AS updatedBy
       FROM product_store_availability WHERE product_id=?`,
    ).all(id)
    return c.json({ productId: id, rows })
  })

  .put('/products/:id/availability', zValidator('json', z.object({
    storeUuid: z.string().min(1).max(80),
    available: z.boolean(),
  })), (c) => {
    const id = Number(c.req.param('id'))
    const p = c.req.valid('json')
    const now = Date.now()
    db.prepare(`
      INSERT INTO product_store_availability(product_id, store_uuid, available, updated_at, updated_by)
      VALUES(?,?,?,?,?)
      ON CONFLICT(product_id, store_uuid) DO UPDATE SET
        available=excluded.available, updated_at=excluded.updated_at, updated_by=excluded.updated_by
    `).run(id, p.storeUuid, p.available ? 1 : 0, now, 'admin')
    return c.json({ ok: true })
  })

  // —— Referrals summary ——
  .get('/referrals', (c) => {
    const rows = db.prepare(`
      SELECT u.id AS referrerId, u.card_code AS referrerCard,
             (SELECT COUNT(*) FROM users f WHERE f.invited_by=u.id) AS invited,
             (SELECT COUNT(DISTINCT f.id) FROM users f
                JOIN loyalty_ops o ON o.card_id=f.card_id AND o.kind='SELL'
                WHERE f.invited_by=u.id) AS withPurchase,
             COALESCE((SELECT SUM(amount) FROM cashback_ledger WHERE beneficiary_id=u.id AND receipt_id NOT LIKE 'game:%'),0) AS cashbackKop
      FROM users u
      WHERE EXISTS (SELECT 1 FROM users f WHERE f.invited_by=u.id)
      ORDER BY cashbackKop DESC
      LIMIT 100
    `).all()
    return c.json({ referrers: rows })
  })

  // —— Promos / content CMS ——
  .get('/promos', (c) => {
    try {
      const promos = db.prepare(`
        SELECT id, title, body, icon, sponsor, starts_at AS startsAt, ends_at AS endsAt,
               image_url AS imageUrl, media_type AS mediaType, placement, status, sort_order AS sortOrder,
               cta_label AS ctaLabel, product_id AS productId, badge, kind,
               published_at AS publishedAt
        FROM promos ORDER BY sort_order ASC, id DESC
      `).all()
      return c.json({ promos })
    } catch {
      const promos = db.prepare(
        'SELECT id, title, body, icon, sponsor, starts_at AS startsAt, ends_at AS endsAt FROM promos ORDER BY id DESC',
      ).all()
      return c.json({ promos })
    }
  })

  .post('/promos', zValidator('json', z.object({
    // Заголовок необязателен: баннер-фон и часть материалов идут без текста.
    title: z.string().max(80).optional().default(''),
    body: z.string().max(500).optional().default(''),
    icon: z.string().max(24).default('Sparkles'),
    sponsor: z.string().max(80).optional().nullable(),
    days: z.number().int().min(1).max(365).optional(),
    startsAt: z.number().int().optional(),
    endsAt: z.number().int().optional(),
    imageUrl: mediaUrl,
    mediaType: z.enum(['image', 'video']).optional().default('image'),
    placement: z.enum(['home', 'menu', 'both', 'home_hero', 'home_feature']).optional().default('home'),
    status: z.enum(['draft', 'published', 'archived']).optional().default('draft'),
    sortOrder: z.number().int().optional().default(0),
    ctaLabel: z.string().max(40).optional().nullable(),
    productId: z.number().int().optional().nullable(),
    badge: z.enum(['new', 'hit', 'seasonal']).optional().nullable(),
    kind: z.enum(['promo', 'featured_product']).optional().default('promo'),
  })), (c) => {
    const p = c.req.valid('json')
    const now = Math.floor(Date.now() / 1000)
    const starts = p.startsAt ?? now
    const ends = p.endsAt ?? (p.days != null ? now + p.days * 86_400 : now + 30 * 86_400)
    const publishedAt = p.status === 'published' ? now : null
    try {
      db.prepare(`
        INSERT INTO promos(title,body,icon,sponsor,starts_at,ends_at,image_url,media_type,placement,status,sort_order,cta_label,product_id,badge,kind,published_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        p.title, p.body ?? '', p.icon, p.sponsor ?? null, starts, ends,
        p.imageUrl ?? null, p.mediaType, p.placement, p.status, p.sortOrder,
        p.ctaLabel ?? null, p.productId ?? null, p.badge ?? null, p.kind, publishedAt,
      )
    } catch {
      db.prepare('INSERT INTO promos(title,body,icon,sponsor,starts_at,ends_at) VALUES(?,?,?,?,?,?)')
        .run(p.title, p.body ?? '', p.icon, p.sponsor ?? null, starts, ends)
    }
    return c.json({ ok: true })
  })

  .patch('/promos/:id', zValidator('json', z.object({
    title: z.string().max(80).optional(),
    body: z.string().max(500).optional(),
    icon: z.string().max(24).optional(),
    sponsor: z.string().max(80).optional().nullable(),
    days: z.number().int().min(1).max(365).optional(),
    startsAt: z.number().int().optional(),
    endsAt: z.number().int().optional(),
    imageUrl: mediaUrl,
    mediaType: z.enum(['image', 'video']).optional(),
    placement: z.enum(['home', 'menu', 'both', 'home_hero', 'home_feature']).optional(),
    status: z.enum(['draft', 'published', 'archived']).optional(),
    sortOrder: z.number().int().optional(),
    ctaLabel: z.string().max(40).optional().nullable(),
    productId: z.number().int().optional().nullable(),
    badge: z.enum(['new', 'hit', 'seasonal']).optional().nullable(),
    kind: z.enum(['promo', 'featured_product']).optional(),
  })), (c) => {
    const id = Number(c.req.param('id'))
    const p = c.req.valid('json')
    const row = db.prepare('SELECT * FROM promos WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!row) throw bad('Promo not found', 404)
    const now = Math.floor(Date.now() / 1000)
    const ends = p.endsAt ?? (p.days != null ? now + p.days * 86_400 : row.ends_at)
    const starts = p.startsAt ?? row.starts_at
    const status = p.status ?? row.status ?? 'published'
    const publishedAt = status === 'published'
      ? (row.published_at ?? now)
      : row.published_at
    try {
      db.prepare(`
        UPDATE promos SET title=?, body=?, icon=?, sponsor=?, starts_at=?, ends_at=?,
          image_url=?, media_type=?, placement=?, status=?, sort_order=?, cta_label=?, product_id=?, badge=?, kind=?, published_at=?
        WHERE id=?
      `).run(
        p.title ?? row.title,
        p.body ?? row.body,
        p.icon ?? row.icon,
        p.sponsor !== undefined ? p.sponsor : row.sponsor,
        starts, ends,
        p.imageUrl !== undefined ? p.imageUrl : row.image_url,
        p.mediaType ?? row.media_type ?? 'image',
        p.placement ?? row.placement ?? 'home',
        status,
        p.sortOrder ?? row.sort_order ?? 0,
        p.ctaLabel !== undefined ? p.ctaLabel : row.cta_label,
        p.productId !== undefined ? p.productId : row.product_id,
        p.badge !== undefined ? p.badge : row.badge,
        p.kind ?? row.kind ?? 'promo',
        publishedAt,
        id,
      )
    } catch {
      db.prepare(`UPDATE promos SET title=?, body=?, icon=?, sponsor=?, ends_at=? WHERE id=?`).run(
        p.title ?? row.title, p.body ?? row.body, p.icon ?? row.icon,
        p.sponsor !== undefined ? p.sponsor : row.sponsor, ends, id,
      )
    }
    return c.json({ ok: true })
  })

  .post('/promos/:id/publish', (c) => {
    const id = Number(c.req.param('id'))
    const now = Math.floor(Date.now() / 1000)
    try {
      db.prepare(`UPDATE promos SET status='published', published_at=? WHERE id=?`).run(now, id)
    } catch {
      /* ignore if columns missing */
    }
    return c.json({ ok: true })
  })

  .post('/promos/:id/unpublish', (c) => {
    const id = Number(c.req.param('id'))
    try {
      db.prepare(`UPDATE promos SET status='draft' WHERE id=?`).run(id)
    } catch { /* */ }
    return c.json({ ok: true })
  })

  .delete('/promos/:id', (c) => {
    db.prepare('DELETE FROM promos WHERE id=?').run(Number(c.req.param('id')))
    return c.json({ ok: true })
  })

    .post('/vouchers/grant-all', zValidator('json', z.object({ code: z.string().min(1).max(64) })), (c) => {
    const { code } = c.req.valid('json')
    const t = db.prepare('SELECT title FROM voucher_templates WHERE code = ?').get(code) as { title: string } | undefined
    if (!t) throw bad('Шаблон ваучера не найден', 404)
    const ids = db.prepare('SELECT id FROM users').all() as { id: number }[]
    db.transaction(() => { for (const u of ids) grantVoucher(u.id, code) })()
    ;(c as unknown as { set: (k: string, v: unknown) => void }).set('audit', { entity: 'vouchers', summary: `Ваучер «${t.title}» выдан всем клиентам: ${ids.length}`, after: { code, granted: ids.length } })
    return c.json({ granted: ids.length })
  })

  // —— Queue numbers (публичный номер заказа на чеке) ——
  .get('/queue-numbers', (c) => {
    const store = (c.req.query('storeUuid') ?? '').slice(0, 64)
    if (!store) throw bad('storeUuid required', 400)
    const period = (c.req.query('period') ?? '').slice(0, 10) || undefined
    return c.json({ numbers: listQueueNumbers(store, period) })
  })
  /* ───── 3.6 Стоп-лист карт (ключ — card_id гостя) ───── */

  .get('/cards/:cardId/block', (c) => {
    const cardId = (c.req.param('cardId') ?? '').slice(0, 64)
    const row = db
      .prepare(`SELECT card_id AS cardId, reason, created_at AS createdAt FROM card_denylist WHERE card_id=? AND released_at IS NULL`)
      .get(cardId) as { cardId: string; reason: string | null; createdAt: number | null } | undefined
    return c.json({ blocked: Boolean(row), block: row ?? null })
  })

  .post(
    '/cards/:cardId/block',
    zValidator('json', z.object({ reason: z.string().trim().min(3, 'Укажите причину (минимум 3 символа)').max(300) })),
    (c) => {
      const cardId = (c.req.param('cardId') ?? '').slice(0, 64)
      if (!cardId) throw bad('Некорректный номер карты', 400)
      const { reason } = c.req.valid('json')
      const user = db.prepare('SELECT id FROM users WHERE card_id=?').get(cardId) as { id: number } | undefined
      const t = Date.now()
      db.prepare(
        `INSERT INTO card_denylist(card_id, reason, created_at, released_at) VALUES(?,?,?,NULL)
         ON CONFLICT(card_id) DO UPDATE SET reason=excluded.reason, created_at=excluded.created_at, released_at=NULL`,
      ).run(cardId, reason, t)
      log.info('card blocked', { cardId, userId: user?.id ?? null })
      c.set('audit', {
        entity: 'cards',
        entityId: cardId,
        summary: `Карта заблокирована: ${reason}`,
        after: { cardId, reason, userId: user?.id ?? null },
      })
      return c.json({ ok: true, cardId, blocked: true, reason })
    },
  )

  .delete('/cards/:cardId/block', (c) => {
    const cardId = (c.req.param('cardId') ?? '').slice(0, 64)
    const cur = db
      .prepare(`SELECT reason, released_at AS releasedAt FROM card_denylist WHERE card_id=?`)
      .get(cardId) as { reason: string | null; releasedAt: number | null } | undefined
    if (!cur || cur.releasedAt) throw bad('Карта не заблокирована', 404)
    const t = Date.now()
    db.prepare('UPDATE card_denylist SET released_at=? WHERE card_id=?').run(t, cardId)
    log.info('card unblocked', { cardId })
    c.set('audit', {
      entity: 'cards',
      entityId: cardId,
      summary: 'Карта разблокирована',
      before: { cardId, reason: cur.reason },
      after: { cardId, releasedAt: t },
    })
    return c.json({ ok: true, cardId, blocked: false })
  })

  .get('/disputes', (c) => c.json({
    disputes: db.prepare('SELECT * FROM disputes ORDER BY id DESC LIMIT 100').all(),
  }))

  .get('/cashback/:userId', (c) => {
    const id = Number(c.req.param('userId'))
    const rows = db.prepare(`SELECT * FROM cashback_ledger WHERE beneficiary_id=? ORDER BY id DESC LIMIT 100`).all(id)
    return c.json({ ledger: rows })
  })

  // Evotor catalog admin (stores from cloud + product push, no local device enroll)
  .route('/', adminEvotorCatalog)
  .route('/', adminEvotorTokens)

adminRoutes.route('/', adminAssignments)
adminRoutes.route('/', adminAnalytics)
adminRoutes.route('/', adminAi)
adminRoutes.route('/', adminConsole)
adminRoutes.route('/', adminStudio) // before adminStock: /inventory/overview must win over /inventory/:id
adminRoutes.route('/', adminStock)
adminRoutes.route('/', staffAdminRoutes)
