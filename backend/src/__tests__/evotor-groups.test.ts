/**
 * Группы товаров Эвотор — отдельный ресурс (`/stores/{id}/product-groups`).
 * Товары ссылаются на группу через parent_id; в products-API поля `group` не существует.
 * Регресс: обычный товар без родителя не получает parent_id.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-evgrp-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { toEvotorGroup, toEvotorProduct, ProductPushService } = await import('../integrations/evotor/sync/ProductPushService')

const STORE = '20261017-AD69-40F0-80D2-3C027B1A4BF8'

const row = (over: Record<string, unknown> = {}) => ({
  id: 1, name: 'Сиропы', price: 0, available: 1, counts_as_cup: 0, evotor_uuid: null,
  tax: null, measure: null, cost_price_kopecks: 0, free_eligible: 0,
  season_start_at: null, season_end_at: null, evotor_extra_json: null,
  modifier_scheme_id: null, recipe_text: null, recipe_cost_rub: null, recipe_seconds: null,
  catalog_source: 'SIXTH_CUP', is_group: 1, parent_product_id: null,
  ...over,
}) as any

describe('payload', () => {
  it('группа: только name и (опционально) parent_id', () => {
    expect(toEvotorGroup(row())).toEqual({ name: 'Сиропы' })
    expect(toEvotorGroup(row({ name: 'Молоко' }), 'grp-parent')).toEqual({ name: 'Молоко', parent_id: 'grp-parent' })
    const body = toEvotorGroup(row())
    for (const forbidden of ['price', 'tax', 'type', 'allow_to_sell', 'measure_name', 'article_number', 'group']) {
      expect(body).not.toHaveProperty(forbidden)
    }
  })

  it('группа не может уйти в products-API', () => {
    expect(() => toEvotorProduct(row(), STORE)).toThrow(/product-groups/)
  })

  it('обычный товар без родителя не получает parent_id', () => {
    const body = toEvotorProduct(row({ is_group: 0, name: 'Латте', price: 250, available: 1 }), STORE)
    expect(body).not.toHaveProperty('parent_id')
    expect(body).not.toHaveProperty('group')
    expect(body.allow_to_sell).toBe(true)
    expect(body.type).toBe('NORMAL')
  })

  it('дочерний товар получает parent_id = uuid группы', () => {
    const body = toEvotorProduct(row({ is_group: 0, name: 'Сироп карамель', price: 50 }), STORE, 'grp-uuid')
    expect(body.parent_id).toBe('grp-uuid')
  })
})

describe('push: группы раньше детей, parent_id на группу', () => {
  let groupId = 0
  let childId = 0

  const calls: { op: string; payload?: any; id?: string }[] = []
  // «Облако» для теста: живёт между push-ами, поэтому повтор не создаёт дубликат.
  const groups: { id: string; name: string }[] = []
  let groupUuid = ''

  const fake = {
    isConfigured: true,
    getProducts: async () => (calls.some((c) => c.op === 'create-product')
      ? [{ id: 'prod-1', name: 'Сироп карамель', articleNumber: `sc-${childId}` }]
      : []) as Record<string, unknown>[],
    getCloudProductGroups: async () => groups.map((g) => ({ ...g })),
    createCloudProductGroup: async (_s: string, payload: any) => {
      calls.push({ op: 'create-group', payload })
      groupUuid = `grp-${groupId}-${groups.length + 1}`
      groups.push({ id: groupUuid, name: payload.name })
      return { id: groupUuid, name: payload.name }
    },
    replaceCloudProductGroup: async (_s: string, id: string, payload: any) => {
      calls.push({ op: 'replace-group', payload, id })
      return {}
    },
    createCloudProduct: async (_s: string, payload: any) => {
      calls.push({ op: 'create-product', payload })
      return { id: 'prod-1' }
    },
    replaceCloudProduct: async (_s: string, id: string, payload: any) => {
      calls.push({ op: 'replace-product', payload, id })
      return {}
    },
    postProductExtras: async () => ({}),
  } as any

  beforeEach(() => {
    db.prepare(`INSERT OR IGNORE INTO evotor_stores(store_uuid,name,sync_enabled) VALUES(?,?,1)`).run(STORE, 'Багратиона')
    db.prepare('UPDATE evotor_stores SET sync_enabled=1, catalog_paused=0 WHERE store_uuid=?').run(STORE)

    const g = db.prepare(`INSERT INTO products(name,price,available,is_group,catalog_source,created_at,updated_at)
      VALUES('Сиропы',0,1,1,'SIXTH_CUP',?,?)`).run(Date.now(), Date.now())
    groupId = Number(g.lastInsertRowid)
    const c = db.prepare(`INSERT INTO products(name,price,available,is_group,parent_product_id,catalog_source,created_at,updated_at)
      VALUES('Сироп карамель',50,1,0,?,'SIXTH_CUP',?,?)`).run(groupId, Date.now(), Date.now())
    childId = Number(c.lastInsertRowid)
    calls.length = 0
    groups.length = 0
    groupUuid = ''
  })

  it('создаёт группу через product-groups, затем товар с parent_id группы', async () => {
    const svc = new ProductPushService(db, fake)
    const r = await svc.pushToStore(STORE)
    expect(r.errors).toEqual([])

    const createGroup = calls.find((c) => c.op === 'create-group')
    expect(createGroup?.payload).toEqual({ name: 'Сиропы' })

    const createProduct = calls.find((c) => c.op === 'create-product')
    expect(createProduct?.payload.parent_id).toBe(groupUuid)
    expect(createProduct?.payload).not.toHaveProperty('group')

    // связи проставлены: группа → grp-uuid, товар → prod-1
    const links = db.prepare('SELECT product_id AS p, evotor_uuid AS u FROM product_store_links WHERE store_uuid=? ORDER BY product_id')
      .all(STORE) as { p: number; u: string }[]
    expect(links.find((l) => l.p === groupId)?.u).toBe(groupUuid)
    expect(links.find((l) => l.p === childId)?.u).toBe('prod-1')
  })

  it('повторный push не создаёт вторую группу, а обновляет её', async () => {
    const svc = new ProductPushService(db, fake)
    await svc.pushToStore(STORE)
    const firstGroups = calls.filter((c) => c.op === 'create-group').length
    db.prepare(`UPDATE products SET name='Сиропы 2' WHERE id=?`).run(groupId)
    calls.length = 0
    await svc.pushToStore(STORE)
    expect(calls.filter((c) => c.op === 'create-group')).toHaveLength(0)
    expect(calls.some((c) => c.op === 'replace-group')).toBe(true)
    expect(firstGroups).toBe(1)
  })
})
