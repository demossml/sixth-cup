/**
 * Admin AI assistant — drafts only, no auto-writes to DB.
 * Mock provider when AI_ASSISTANT=0 or no API key.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { config } from '../../config'
import { periodSince } from './consoleLib'

type Role = 'owner' | 'manager' | 'viewer'

function roleOf(c: { get: (k: string) => unknown }): Role {
  return (c.get('adminRole' as never) as Role) || 'owner'
}

function requireWriteAi(c: { get: (k: string) => unknown }) {
  const r = roleOf(c)
  if (r === 'viewer') throw bad('Read-only admin token', 403)
  if (!config.aiAssistant) throw bad('AI assistant disabled', 503)
}

async function callProvider(system: string, user: string): Promise<string> {
  if (!config.aiApiKey || !config.aiAssistant) {
    // Deterministic mock for offline/dev
    return [
      '【черновик · mock】',
      system.slice(0, 80),
      '',
      user.slice(0, 400),
      '',
      '• Проверьте товары без фото',
      '• Сверьте чашки с counts_as_cup',
      '• Это подсказка, не отчёт Эвотор',
    ].join('\n')
  }
  const url = (config.aiBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.aiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.aiModel,
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(25000) : undefined,
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw bad(`AI provider error ${res.status}: ${t.slice(0, 120)}`, 502)
  }
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return j.choices?.[0]?.message?.content?.trim() || 'Пустой ответ модели'
}

const SYSTEM =
  'Ты помощник кофейни 6.7 Coffee. Отвечай по-русски кратко. Не выдумывай выручку. Не раскрывай персональные данные карт. Цифры только из переданного JSON. Это черновик для человека, не приказ.'

export const adminAi = new Hono()
  .post(
    '/ai/catalog-advice',
    zValidator('json', z.object({}).optional()),
    async (c) => {
      requireWriteAi(c)
      const quality = {
        noPhoto: (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM products WHERE available=1 AND (image_url IS NULL OR TRIM(image_url)='')`,
            )
            .get() as { n: number }
        ).n,
        noCategory: (
          db.prepare(`SELECT COUNT(*) AS n FROM products WHERE available=1 AND category_id IS NULL`).get() as {
            n: number
          }
        ).n,
        noLink: (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM products p WHERE p.available=1 AND NOT EXISTS (SELECT 1 FROM product_store_links l WHERE l.product_id=p.id AND l.evotor_uuid IS NOT NULL)`,
            )
            .get() as { n: number }
        ).n,
      }
      const sample = db
        .prepare(
          `SELECT id, name FROM products WHERE available=1 AND (image_url IS NULL OR TRIM(image_url)='') ORDER BY id LIMIT 15`,
        )
        .all() as { id: number; name: string }[]
      const text = await callProvider(
        SYSTEM,
        `Качество каталога: ${JSON.stringify(quality)}. Товары без фото: ${JSON.stringify(sample)}. Дай приоритетный список действий для администратора.`,
      )
      return c.json({ ok: true, provider: config.aiApiKey ? 'remote' : 'mock', text })
    },
  )
  .post(
    '/ai/content-draft',
    zValidator(
      'json',
      z.object({
        productName: z.string().max(80).optional(),
        tone: z.string().max(40).optional(),
        badge: z.string().max(20).optional(),
      }),
    ),
    async (c) => {
      requireWriteAi(c)
      const body = c.req.valid('json')
      const text = await callProvider(
        SYSTEM,
        `Сделай черновик новинки для PWA: title, body (2 предложения), ctaLabel, badge. Товар: ${body.productName || 'напиток сезона'}. Тон: ${body.tone || 'дружелюбный'}. Badge: ${body.badge || 'Новинка'}. Верни структурированно.`,
      )
      return c.json({
        ok: true,
        provider: config.aiApiKey ? 'remote' : 'mock',
        text,
        draft: {
          title: body.productName ? `Попробуйте ${body.productName}` : 'Новинка недели',
          body: text.slice(0, 280),
          ctaLabel: 'Подробнее',
          badge: body.badge || 'Новинка',
        },
      })
    },
  )
  .post(
    '/ai/anomaly-explain',
    zValidator('json', z.object({ period: z.string().max(20).optional() })),
    async (c) => {
      requireWriteAi(c)
      const now = Date.now()
      const { since } = periodSince(c.req.valid('json').period || '24h', now)
      const ops = db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN kind='SELL' THEN 1 ELSE 0 END),0) AS sells,
                  COALESCE(SUM(CASE WHEN kind='SELL' THEN cups_counted ELSE 0 END),0) AS cups
           FROM loyalty_ops WHERE created_at >= ? OR 1=1`,
        )
        .get(since) as { sells: number; cups: number }
      // Prefer filtering in JS if created_at messy
      const list = db
        .prepare(`SELECT created_at AS at, kind, cups_counted AS cups FROM loyalty_ops`)
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
      return c.json({ ok: true, provider: config.aiApiKey ? 'remote' : 'mock', text, snapshot: { sells, cups, since } })
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
        db
          .prepare(`SELECT COUNT(*) AS n FROM evotor_docs WHERE type='SELL' AND received_at>=?`)
          .get(since) as { n: number }
      ).n
      const text = await callProvider(
        SYSTEM,
        `Сводка смены (${period}): чеков SELL в 6.7 docs=${docs}. Напиши 5–8 строк для владельца кофейни, спокойным тоном.`,
      )
      return c.json({ ok: true, provider: config.aiApiKey ? 'remote' : 'mock', text })
    },
  )
