/**
 * Admin AI assistant — drafts only, no auto-writes to DB.
 * Provider: DeepSeek (OpenAI-compatible). Settings from env + app_settings (admin UI).
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { periodSince } from './consoleLib'
import { DEEPSEEK_MODELS, getAiSettingsPublic, resolveAiConfig, saveAiSettings } from '../../lib/aiSettings'

type Role = 'owner' | 'manager' | 'viewer'

function roleOf(c: { get: (k: string) => unknown }): Role {
  return (c.get('adminRole' as never) as Role) || 'owner'
}

function requireWriteAi(c: { get: (k: string) => unknown }) {
  const r = roleOf(c)
  if (r === 'viewer') throw bad('Read-only admin token', 403)
  const cfg = resolveAiConfig()
  if (!cfg.enabled) throw bad('ИИ выключен. Включите в Система → ИИ.', 503)
  if (!cfg.hasKey) throw bad('Нет API-ключа DeepSeek. Укажите в Система → ИИ.', 503)
}

async function callProvider(system: string, user: string): Promise<string> {
  const cfg = resolveAiConfig()
  if (!cfg.enabled || !cfg.hasKey) {
    return [
      '【черновик · mock — ключ не задан】',
      'Откройте Система → ИИ, выберите DeepSeek и сохраните API-ключ.',
      '',
      user.slice(0, 300),
    ].join('\n')
  }
  const url = cfg.baseUrl.replace(/\/$/, '') + '/chat/completions'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(45000) : undefined,
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw bad(`DeepSeek error ${res.status}: ${t.slice(0, 180)}`, 502)
  }
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return j.choices?.[0]?.message?.content?.trim() || 'Пустой ответ модели'
}

const SYSTEM =
  'Ты помощник кофейни 6.7 Coffee. Отвечай по-русски кратко и по делу. ' +
  'Правила: (1) цифры только из переданного JSON, ничего не выдумывай; ' +
  '(2) если данных нет — так и скажи и перечисли, каких полей не хватает; ' +
  '(3) когда объясняешь процесс, называй реальные экраны админки 6.7: ' +
  '«Закупки → Поставщики», «Закупки → Новая накладная → Создать черновик → Провести», ' +
  '«Склад → Остатки / Нормы / Списания», «Себестоимость → Техкарты», «Меню → Товары», ' +
  '«Касса → Токены», «Клиенты», «Сегодня»; ' +
  '(4) не раскрывай персональные данные карт; (5) это черновик для человека, а не приказ.'

/** Снимок состояния бизнеса для помощника: только то, что реально есть в БД. */
export function businessSnapshot(since: number, period: string) {
  const one = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number })?.n ?? 0
  const ops = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(result_rub),0) AS rub, COALESCE(SUM(cups_counted),0) AS cups
         FROM loyalty_ops WHERE kind='SELL' AND created_at>=?`,
    )
    .get(since) as { n: number; rub: number; cups: number }
  const unlinked = db
    .prepare(
      `SELECT name FROM tech_cards WHERE product_id IS NULL AND kind <> 'semi' ORDER BY name COLLATE NOCASE LIMIT 5`,
    )
    .all() as { name: string }[]
  return {
    period,
    sales: {
      sellDocs: one(`SELECT COUNT(*) AS n FROM evotor_docs WHERE type='SELL' AND received_at>=?`, since),
      withCard: ops.n,
      cups: ops.cups,
      revenueRub: Math.round(Number(ops.rub) || 0),
      failedDocs: one(`SELECT COUNT(*) AS n FROM evotor_docs WHERE status='FAILED'`),
    },
    menu: {
      products: one(`SELECT COUNT(*) AS n FROM products WHERE available=1`),
      noPhoto: one(`SELECT COUNT(*) AS n FROM products WHERE available=1 AND (image_url IS NULL OR image_url='')`),
      noCategory: one(`SELECT COUNT(*) AS n FROM products WHERE available=1 AND (category_id IS NULL OR category_id=0)`),
      addonSchemesEmpty: one(
        `SELECT COUNT(*) AS n FROM modifier_schemes s
          WHERE NOT EXISTS (SELECT 1 FROM modifier_scheme_options o WHERE o.scheme_id=s.id)`,
      ),
    },
    cost: {
      cards: one(`SELECT COUNT(*) AS n FROM tech_cards`),
      withoutProduct: one(`SELECT COUNT(*) AS n FROM tech_cards WHERE product_id IS NULL AND kind <> 'semi'`),
      topUnlinked: unlinked.map((r) => r.name),
    },
    stock: {
      positions: one(`SELECT COUNT(*) AS n FROM stock_items WHERE active=1`),
      noReceipts: one(
        `SELECT COUNT(*) AS n FROM stock_items i WHERE i.active=1 AND NOT EXISTS (
           SELECT 1 FROM purchase_invoice_lines l JOIN purchase_invoices v ON v.id=l.invoice_id
            WHERE l.stock_item_id=i.id AND v.status='posted')`,
      ),
      productsWithoutNorm: one(
        `SELECT COUNT(*) AS n FROM products p WHERE p.available=1 AND NOT EXISTS (
           SELECT 1 FROM product_stock_norms n WHERE n.product_id=p.id)`,
      ),
    },
    purchases: {
      suppliers: one(`SELECT COUNT(*) AS n FROM suppliers`),
      invoices: one(`SELECT COUNT(*) AS n FROM purchase_invoices`),
      invoicesDraft: one(`SELECT COUNT(*) AS n FROM purchase_invoices WHERE status='draft'`),
    },
  }
}

export const adminAi = new Hono()
  .get('/ai/settings', (c) => {
    return c.json(getAiSettingsPublic())
  })
  .put(
    '/ai/settings',
    zValidator(
      'json',
      z.object({
        enabled: z.boolean().optional(),
        model: z.enum(DEEPSEEK_MODELS as unknown as [string, ...string[]]).optional(),
        apiKey: z.string().max(200).optional().nullable(),
        clearKey: z.boolean().optional(),
      }),
    ),
    (c) => {
      if (roleOf(c) === 'viewer') throw bad('Read-only', 403)
      try {
        const body = c.req.valid('json')
        const pub = saveAiSettings({
          enabled: body.enabled,
          model: body.model,
          apiKey: body.apiKey,
          clearKey: body.clearKey,
        })
        return c.json({ ok: true, ...pub })
      } catch (e) {
        throw bad(e instanceof Error ? e.message : 'Save failed', 400)
      }
    },
  )
  .post(
    '/ai/catalog-advice',
    zValidator('json', z.object({}).optional()),
    async (c) => {
      requireWriteAi(c)
      const quality = {
        noPhoto: (
          db.prepare(`SELECT COUNT(*) AS n FROM products WHERE available=1 AND (image_url IS NULL OR image_url='')`).get() as {
            n: number
          }
        ).n,
        noCategory: (
          db.prepare(`SELECT COUNT(*) AS n FROM products WHERE available=1 AND (category_id IS NULL OR category_id=0)`).get() as {
            n: number
          }
        ).n,
        total: (db.prepare(`SELECT COUNT(*) AS n FROM products WHERE available=1`).get() as { n: number }).n,
      }
      const text = await callProvider(
        SYSTEM,
        `Каталог JSON: ${JSON.stringify(quality)}. Дай 5 конкретных шагов улучшить меню (фото, группы, counts_as_cup). Без выдуманных SKU.`,
      )
      return c.json({ ok: true, provider: resolveAiConfig().hasKey ? 'deepseek' : 'mock', text, quality })
    },
  )
  .post(
    '/ai/content-draft',
    zValidator('json', z.object({ productName: z.string().max(120).optional() }).optional()),
    async (c) => {
      requireWriteAi(c)
      const body = (c.req.valid('json') || {}) as { productName?: string }
      const name = body.productName?.trim() || 'Новинка'
      const text = await callProvider(
        SYSTEM,
        `Составь короткий маркетинговый текст для напитка «${name}» в кофейне 6.7 Coffee: заголовок, 2 предложения, CTA, badge (одно слово).`,
      )
      return c.json({
        ok: true,
        provider: 'deepseek',
        text,
        draft: {
          title: name,
          body: text,
          ctaLabel: 'В меню',
          badge: 'Новинка',
        },
      })
    },
  )
  .post(
    '/ai/ask',
    zValidator('json', z.object({ question: z.string().min(1).max(600), period: z.string().max(20).optional() })),
    async (c) => {
      requireWriteAi(c)
      const { question, period: per } = c.req.valid('json')
      const { since, period } = periodSince(per || '24h', Date.now())
      // Снимок шире пяти счётчиков: без склада/техкарт/закупок помощник отвечал
      // «данных нет» на 4 из 5 операционных вопросов (аудит 14.11.2026).
      const snapshot = businessSnapshot(since, period)
      const text = await callProvider(SYSTEM, `Данные JSON: ${JSON.stringify(snapshot)}. Вопрос владельца: ${question}`)
      return c.json({ ok: true, provider: resolveAiConfig().hasKey ? 'deepseek' : 'mock', text, snapshot })
    },
  )
  .post(
    '/ai/anomaly-explain',
    zValidator('json', z.object({ period: z.string().max(20).optional() }).optional()),
    async (c) => {
      requireWriteAi(c)
      const now = Date.now()
      const body = (c.req.valid('json') || {}) as { period?: string }
      const { since } = periodSince(body.period || '24h', now)
      const list = db
        .prepare(`SELECT created_at AS at, kind, cups_counted AS cups FROM loyalty_ops ORDER BY created_at DESC LIMIT 500`)
        .all() as { at: unknown; kind: string; cups: number }[]
      let sells = 0
      let cups = 0
      for (const o of list) {
        const at = typeof o.at === 'number' ? o.at : Date.parse(String(o.at)) || 0
        if (at && at < since) continue
        if (o.kind === 'SELL') {
          sells += 1
          cups += Number(o.cups) || 0
        }
      }
      const text = await callProvider(
        SYSTEM,
        `Период since=${since}. Продаж с картой: ${sells}, чашек: ${cups}. Дай 3–5 гипотез почему метрики могут быть низкими (карта не сканируется, sync выкл, counts_as_cup). Без выдуманных чисел.`,
      )
      return c.json({
        ok: true,
        provider: 'deepseek',
        text,
        snapshot: { sells, cups, since },
      })
    },
  )
  .post(
    '/ai/shift-summary',
    zValidator('json', z.object({ period: z.string().max(20).optional() }).optional()),
    async (c) => {
      requireWriteAi(c)
      const now = Date.now()
      const body = (c.req.valid('json') || {}) as { period?: string }
      const { since, period } = periodSince(body.period || '24h', now)
      const docs = (
        db.prepare(`SELECT COUNT(*) AS n FROM evotor_docs WHERE type='SELL' AND received_at>=?`).get(since) as {
          n: number
        }
      ).n
      const text = await callProvider(
        SYSTEM,
        `Сводка смены (${period}): чеков SELL в 6.7 docs=${docs}. Напиши 5–8 строк для владельца кофейни, спокойным тоном.`,
      )
      return c.json({ ok: true, provider: 'deepseek', text })
    },
  )
