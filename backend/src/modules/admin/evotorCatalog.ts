/**
 * Admin: Evotor stores from API + product push (no local device enroll).
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { EvotorClient } from '../../integrations/evotor/client/EvotorClient'
import { ProductPushService } from '../../integrations/evotor/sync/ProductPushService'
import { PollService } from '../../integrations/evotor/sync/PollService'
import { bad } from '../../lib/errors'

function asArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  return []
}

export const adminEvotorCatalog = new Hono()
  /** Magazines from Cloud — source of truth for "which store" */
  .get('/evotor/stores', async (c) => {
    const client = new EvotorClient()
    if (!client.isConfigured) throw bad('EVOTOR_API_TOKEN not set', 503)
    try {
      const raw = await client.getStores()
      const items = asArray(raw).map((s) => {
        const o = s as Record<string, unknown>
        return {
          uuid: o.uuid ?? o.id,
          name: o.name,
          address: o.address ?? null,
          code: o.code ?? null,
        }
      })
      return c.json({ stores: items })
    } catch (e) {
      throw bad(String(e), 502)
    }
  })

  /** Push our catalog → one store in Evotor */
  .post(
    '/evotor/stores/:storeUuid/push-products',
    async (c) => {
      const storeUuid = c.req.param('storeUuid')
      const svc = new ProductPushService(db)
      const result = await svc.pushToStore(storeUuid)
      if (result.errors.length && result.pushed === 0) {
        throw bad(result.errors.join('; '), 502)
      }
      return c.json(result)
    },
  )

  /** Pull product count from Evotor (verify) */
  .get('/evotor/stores/:storeUuid/products', async (c) => {
    const storeUuid = c.req.param('storeUuid')
    const client = new EvotorClient()
    if (!client.isConfigured) throw bad('EVOTOR_API_TOKEN not set', 503)
    try {
      const raw = await client.getProducts(storeUuid)
      const items = asArray(raw)
      return c.json({
        count: items.length,
        products: items.slice(0, 50).map((p) => {
          const o = p as Record<string, unknown>
          return {
            uuid: o.uuid ?? o.id,
            name: o.name,
            price: o.price,
            allowToSell: o.allowToSell ?? o.allow_to_sell,
          }
        }),
      })
    } catch (e) {
      throw bad(String(e), 502)
    }
  })

  /** One-shot poll documents (manual) */
  .post('/evotor/poll', async (c) => {
    const poll = new PollService(db)
    try {
      const r = await poll.runFast()
      return c.json(r)
    } catch (e) {
      throw bad(String(e), 502)
    }
  })
