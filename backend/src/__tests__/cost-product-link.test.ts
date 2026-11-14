import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { admin } from './wh-helpers'

/**
 * Аудит 14.11.2026 (P0): все 12 техкарт на проде были без productId, а розница
 * бралась из снимка карты — маржа считалась по цифре, которой нет в меню
 * (КАПУЧИНО 250: карта 250 ₽ против цены товара 190 ₽).
 */
function makeProduct(name: string, priceRub: number): number {
  const t = Date.now()
  return Number(
    db.prepare(`INSERT INTO products(name, price, available, created_at, updated_at) VALUES(?,?,1,?,?)`)
      .run(name, priceRub, t, t).lastInsertRowid,
  )
}

async function makeItem(name: string, costKop: number): Promise<number> {
  const r = await admin('POST', '/stock/items', { name, kind: 'raw', unit: 'g' })
  const id = Number(r.json.item?.id ?? r.json.id)
  await admin('PUT', `/cost/items/${id}`, { manualCostRub: costKop / 100 })
  return id
}

beforeEach(() => {
  db.prepare(`DELETE FROM tech_card_lines`).run()
  db.prepare(`DELETE FROM tech_card_versions`).run()
  db.prepare(`DELETE FROM tech_cards`).run()
  db.prepare(`DELETE FROM stock_item_cost_history`).run()
})

describe('техкарта ↔ товар каталога', () => {
  it('блюдо без productId не создаётся', async () => {
    const item = await makeItem('Сырьё без товара QA', 100)
    const r = await admin('POST', '/cost/tech-cards', {
      name: 'Блюдо без товара QA',
      kind: 'dish',
      lines: [{ stockItemId: item, qtyBrutto: 10 }],
    })
    expect(r.status).toBe(400)
    expect(String(r.json.error ?? '')).toMatch(/товар каталога/i)
  })

  it('несуществующий товар не привязывается', async () => {
    const r = await admin('POST', '/cost/tech-cards', { name: 'Фантом QA', kind: 'dish', productId: 999999 })
    expect(r.status).toBe(400)
    expect(String(r.json.error ?? '')).toMatch(/не найден/i)
  })

  it('заготовка создаётся без товара — она живёт внутри себестоимости', async () => {
    const r = await admin('POST', '/cost/tech-cards', { name: 'Заготовка QA', kind: 'semi' })
    expect(r.status).toBe(200)
    expect(r.json.card.productId).toBeNull()
    expect(r.json.card.productName).toBeNull()
  })

  it('розница берётся из цены товара, а не из снимка карты', async () => {
    const productId = makeProduct('Капучино 250 (товар)', 190)
    const item = await makeItem('Кофе для капучино QA', 200)
    const r = await admin('POST', '/cost/tech-cards', {
      name: 'Капучино 250 QA',
      kind: 'dish',
      productId,
      // Старый снимок карты: именно из-за него маржа была неверной.
      retailPriceRub: 250,
      lines: [{ stockItemId: item, qtyBrutto: 10 }],
    })
    expect(r.status).toBe(200)
    const card = r.json.card
    expect(card.retailSource).toBe('catalog')
    expect(card.retailRub).toBeCloseTo(190, 2)
    expect(card.catalogPriceRub).toBeCloseTo(190, 2)
    expect(card.productName).toBe('Капучино 250 (товар)')
    // 10 г × 2 ₽ = 20 ₽ себестоимость → фудкост 20/190 ≈ 10,5 %
    expect(card.costPerUnitRub).toBeCloseTo(20, 2)
    expect(card.foodCostPct).toBeCloseTo(10.5, 1)
    expect(card.marginRub).toBeCloseTo(170, 2)
  })

  it('правка карты без товара не проходит', async () => {
    const productId = makeProduct('Товар для правки QA', 200)
    const created = await admin('POST', '/cost/tech-cards', { name: 'Правка QA', kind: 'dish', productId })
    const id = created.json.card.id
    const off = await admin('PUT', `/cost/tech-cards/${id}`, { productId: null })
    expect(off.status).toBe(400)
    const rename = await admin('PUT', `/cost/tech-cards/${id}`, { name: 'Правка QA 2' })
    expect(rename.status).toBe(200)
  })

  it('список показывает привязку и считает непривязанные', async () => {
    const productId = makeProduct('Товар списка QA', 210)
    await admin('POST', '/cost/tech-cards', { name: 'С товаром QA', kind: 'dish', productId })
    // Легаси-карта без товара — как 12 карт на проде до аудита.
    const legacy = await admin('POST', '/cost/tech-cards', { name: 'Легаси QA', kind: 'dish', productId })
    db.prepare(`UPDATE tech_cards SET product_id=NULL WHERE id=?`).run(legacy.json.card.id)

    const list = await admin('GET', '/cost/tech-cards')
    expect(list.status).toBe(200)
    const linked = list.json.cards.find((c: { name: string }) => c.name === 'С товаром QA')
    expect(linked.productName).toBe('Товар списка QA')
    expect(linked.catalogPriceRub).toBeCloseTo(210, 2)
    expect(list.json.totals.withoutProduct).toBe(1)
    const orphan = list.json.cards.find((c: { name: string }) => c.name === 'Легаси QA')
    expect(orphan.insights.some((i: { code: string }) => i.code === 'no_product')).toBe(true)
  })
})
