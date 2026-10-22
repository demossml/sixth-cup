import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { EvotorClient } from '../../integrations/evotor/client/EvotorClient'
import {
  createToken,
  deactivateToken,
  decryptToken,
  ensureTokenSchema,
  listTokensPublic,
  updateToken,
} from '../../integrations/evotor/tokenStore'

/** Owner-only Evotor cloud API tokens (multi-cabinet). */
export const adminEvotorTokens = new Hono()
  .get('/evotor/tokens', (c) => {
    ensureTokenSchema(db)
    return c.json({ tokens: listTokensPublic(db) })
  })
  .post(
    '/evotor/tokens',
    zValidator(
      'json',
      z.object({
        label: z.string().max(120).optional().default('Токен'),
        token: z.string().min(8).max(2000),
        storeUuids: z.array(z.string().min(1).max(80)).default([]),
      }),
    ),
    (c) => {
      const role = (c as unknown as { get: (k: string) => string }).get('adminRole') || 'owner'
      if (role !== 'owner') throw bad('Insufficient role', 403)
      const body = c.req.valid('json')
      try {
        const row = createToken(db, { ...body, createdBy: role })
        ;(c as unknown as { set: (k: string, v: unknown) => void }).set('audit', {
          entity: 'evotor_tokens',
          summary: `Токен «${row.label}» создан (${row.tokenHint})`,
          after: { id: row.id, stores: row.storeUuids.length },
        })
        return c.json({ token: row })
      } catch (e) {
        throw bad(String(e), 400)
      }
    },
  )
  .patch(
    '/evotor/tokens/:id',
    zValidator(
      'json',
      z.object({
        label: z.string().min(1).max(120).optional(),
        token: z.string().min(8).max(2000).optional(),
        active: z.boolean().optional(),
        storeUuids: z.array(z.string().min(1).max(80)).optional(),
      }),
    ),
    (c) => {
      const role = (c as unknown as { get: (k: string) => string }).get('adminRole') || 'owner'
      if (role !== 'owner') throw bad('Insufficient role', 403)
      const id = Number(c.req.param('id'))
      const body = c.req.valid('json')
      const row = updateToken(db, id, body)
      if (!row) throw bad('Token not found', 404)
      ;(c as unknown as { set: (k: string, v: unknown) => void }).set('audit', {
        entity: 'evotor_tokens',
        summary: `Токен #${id} обновлён`,
        after: { id, active: row.active, stores: row.storeUuids.length },
      })
      return c.json({ token: row })
    },
  )
  .delete('/evotor/tokens/:id', (c) => {
    const role = (c as unknown as { get: (k: string) => string }).get('adminRole') || 'owner'
    if (role !== 'owner') throw bad('Insufficient role', 403)
    const id = Number(c.req.param('id'))
    if (!deactivateToken(db, id)) throw bad('Token not found', 404)
    ;(c as unknown as { set: (k: string, v: unknown) => void }).set('audit', {
      entity: 'evotor_tokens',
      summary: `Токен #${id} отключён`,
    })
    return c.json({ ok: true })
  })
  .post('/evotor/tokens/:id/probe', async (c) => {
    const role = (c as unknown as { get: (k: string) => string }).get('adminRole') || 'owner'
    if (role !== 'owner') throw bad('Insufficient role', 403)
    ensureTokenSchema(db)
    const id = Number(c.req.param('id'))
    const row = db.prepare(`SELECT token_enc FROM evotor_api_tokens WHERE id=?`).get(id) as { token_enc: string } | undefined
    if (!row) throw bad('Token not found', 404)
    let plain: string
    try {
      plain = decryptToken(row.token_enc)
    } catch {
      throw bad('Cannot decrypt token', 500)
    }
    try {
      const client = new EvotorClient(plain)
      const raw = await client.getStores()
      const items = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown[] }).items)
          ? (raw as { items: unknown[] }).items
          : []
      return c.json({
        ok: true,
        stores: items.length,
        sample: items.slice(0, 3).map((o) => {
          const r = o as Record<string, unknown>
          return { uuid: r.uuid ?? r.id, name: r.name }
        }),
      })
    } catch (e) {
      throw bad(`Probe failed: ${String(e).slice(0, 200)}`, 502)
    }
  })
