/** Admin view + synchronization for Evotor Cloud catalog. */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { EvotorClient } from '../../integrations/evotor/client/EvotorClient'
import { ProductPushService } from '../../integrations/evotor/sync/ProductPushService'
import { PollService } from '../../integrations/evotor/sync/PollService'
import { bad } from '../../lib/errors'


function persistEmployees(items: Record<string, unknown>[]) {
  const now = Date.now()
  const upsert = db.prepare(`INSERT INTO evotor_employees(employee_uuid,name,phone,role,store_uuid,raw_json,updated_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(employee_uuid) DO UPDATE SET name=excluded.name,phone=excluded.phone,role=excluded.role,store_uuid=excluded.store_uuid,raw_json=excluded.raw_json,updated_at=excluded.updated_at`)
  for (const o of items) {
    const uuid = String(o.uuid ?? o.id ?? o.employeeUuid ?? '').trim()
    if (!uuid) continue
    upsert.run(uuid, o.name ?? o.fullName ?? null, o.phone ?? null, o.role ?? null, o.storeUuid ?? o.store_id ?? null, JSON.stringify(o), now)
  }
}

function asArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    for (const k of ['items', 'stores', 'employees', 'products', 'data']) {
      if (Array.isArray(o[k])) return o[k].filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    }
  }
  return []
}

const client = () => {
  const value = new EvotorClient()
  if (!value.isConfigured) throw bad('EVOTOR_API_TOKEN not set', 503)
  return value
}

export const adminEvotorCatalog = new Hono()
  .get('/evotor/stores', async (c) => {
    try {
      const items = asArray(await client().getStores())
      const now = Date.now()
      const upsert = db.prepare(`INSERT INTO evotor_stores(store_uuid,name,address,code,raw_json,updated_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(store_uuid) DO UPDATE SET name=excluded.name,address=excluded.address,code=excluded.code,raw_json=excluded.raw_json,updated_at=excluded.updated_at`)
      for (const o of items) {
        const uuid = String(o.uuid ?? o.id ?? '').trim()
        if (!uuid) continue
        upsert.run(uuid, o.name ?? null, o.address ?? null, o.code ?? null, JSON.stringify(o), now)
        db.prepare(`INSERT OR IGNORE INTO evotor_sync_state(store_uuid,last_seen_close_ms) VALUES(?,0)`).run(uuid)
      }
      return c.json({ stores: items.map((o) => ({ uuid: o.uuid ?? o.id, name: o.name, address: o.address ?? null, code: o.code ?? null })) })
    } catch (e) {
      throw bad(String(e), 502)
    }
  })

  .get('/evotor/employees', async (c) => {
    try {
      const items = asArray(await client().getEmployees())
      persistEmployees(items)
      return c.json({ employees: items.map((o) => ({
        uuid: o.uuid ?? o.id ?? o.employeeUuid,
        name: o.name ?? o.fullName ?? null,
        phone: o.phone ?? null,
        role: o.role ?? null,
        storeUuid: o.storeUuid ?? o.store_id ?? null,
      })) })
    } catch (e) {
      throw bad(String(e), 502)
    }
  })

  .post('/evotor/sync', zValidator('json', z.object({ storeUuid: z.string().optional() }).default({})), async (c) => {
    try {
      const p = c.req.valid('json')
      const evotor = client()
      const svc = new ProductPushService(db, evotor)
      const stores = p.storeUuid
        ? [p.storeUuid]
        : asArray(await evotor.getStores()).map((s) => String(s.uuid ?? s.id ?? '')).filter(Boolean)
      const result: Record<string, unknown> = { stores: stores.length, catalog: [] }
      const catalog: unknown[] = []
      for (const storeUuid of stores) catalog.push({ storeUuid, ...(await svc.syncStore(storeUuid)) })
      result.catalog = catalog
      const employeeRaw = asArray(await evotor.getEmployees())
      persistEmployees(employeeRaw)
      const employees = employeeRaw.map((o) => ({
        uuid: o.uuid ?? o.id ?? o.employeeUuid, name: o.name ?? o.fullName ?? null,
        storeUuid: o.storeUuid ?? o.store_id ?? null,
      }))
      result.employees = employees.length
      return c.json(result)
    } catch (e) {
      throw bad(String(e), 502)
    }
  })

  .post('/evotor/stores/:storeUuid/sync', async (c) => {
    const storeUuid = c.req.param('storeUuid')
    try {
      const svc = new ProductPushService(db, client())
      return c.json(await svc.syncStore(storeUuid))
    } catch (e) {
      throw bad(String(e), 502)
    }
  })

  .post('/evotor/stores/:storeUuid/push-products', async (c) => {
    const storeUuid = c.req.param('storeUuid')
    try {
      return c.json(await new ProductPushService(db, client()).pushToStore(storeUuid))
    } catch (e) {
      throw bad(String(e), 502)
    }
  })

  .get('/evotor/stores/:storeUuid/products', async (c) => {
    const storeUuid = c.req.param('storeUuid')
    try {
      const raw = asArray(await client().getProducts(storeUuid))
      const mapped = db.prepare(`SELECT l.product_id AS productId,l.evotor_uuid AS evotorUuid,p.name AS localName,p.catalog_source AS catalogSource
        FROM product_store_links l JOIN products p ON p.id=l.product_id WHERE l.store_uuid=?`).all(storeUuid)
      const byUuid = new Map((mapped as Record<string, unknown>[]).map((r) => [String(r.evotorUuid), r]))
      return c.json({
        count: raw.length,
        products: raw.slice(0, 200).map((o) => {
          const uuid = String(o.uuid ?? o.id ?? '')
          const local = byUuid.get(uuid)
          return { uuid, name: o.name, price: o.price, allowToSell: o.allowToSell ?? o.allow_to_sell, localProductId: local?.productId ?? null, catalogSource: local?.catalogSource ?? null }
        }),
      })
    } catch (e) {
      throw bad(String(e), 502)
    }
  })

  .get('/evotor/stores/:storeUuid/products/drift', async (c) => {
    const storeUuid = c.req.param('storeUuid')
    try {
      return c.json(await new ProductPushService(db, client()).verifyStore(storeUuid))
    } catch (e) {
      throw bad(String(e), 502)
    }
  })

  .post('/evotor/poll', async (c) => {
    try { return c.json(await new PollService(db, client()).runFast()) }
    catch (e) { throw bad(String(e), 502) }
  })
