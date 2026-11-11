/**
 * F15: план продаж по позициям — расходы раскладываются по структуре меню,
 * а не «поровну на весь объём» (100 шт плана не должны давать 2 500 ₽ в каждую чашку).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { admin } from './wh-helpers'

async function createItem(name: string, costKop: number) {
  const r = await admin('POST', '/stock/items', { name, kind: 'raw', unit: 'g' })
  const id = Number(r.json.item?.id ?? r.json.id)
  await admin('PUT', `/cost/items/${id}`, { manualCostRub: costKop / 100 })
  return id
}

async function createCard(name: string, priceRub: number) {
  const item = await createItem(`Сырьё ${name}`, 100)
  const r = await admin('POST', '/cost/tech-cards', {
    name,
    kind: 'dish',
    outputQty: 1,
    retailPriceRub: priceRub,
    lines: [{ stockItemId: item, qtyBrutto: 10 }],
  })
  expect(r.status).toBe(200)
  return r.json.card.id as number
}

beforeEach(() => {
  db.prepare(`DELETE FROM tech_card_lines`).run()
  db.prepare(`DELETE FROM tech_card_versions`).run()
  db.prepare(`DELETE FROM tech_cards`).run()
  db.prepare(`DELETE FROM cost_sales_plan`).run()
  db.prepare(`DELETE FROM sales_lines`).run()
  db.prepare(`DELETE FROM cost_overheads`).run()
  db.prepare(`DELETE FROM cost_settings`).run()
  db.prepare(`DELETE FROM stock_item_cost_history`).run()
})

describe('F15: план продаж по позициям', () => {
  it('без позиций и статей отвечает пустым планом, а не ошибкой', async () => {
    const r = await admin('GET', '/cost/sales-plan')
    expect(r.status).toBe(200)
    expect(r.json.rows).toEqual([])
    expect(r.json.source).toBe('none')
  })

  it('план по позициям задаёт доли, а не «поровну»', async () => {
    const cap = await createCard('Капучино план QA', 300)
    const esp = await createCard('Эспрессо план QA', 150)
    await admin('POST', '/cost/overheads', { name: 'Аренда QA', kind: 'rent', amountRub: 250_000 })
    await admin('PUT', '/cost/settings', { allocation: 'revenue', enabled: true })

    const saved = await admin('PUT', '/cost/sales-plan', {
      rows: [
        { cardId: cap, unitsPerMonth: 70 },
        { cardId: esp, unitsPerMonth: 20 },
      ],
    })
    expect(saved.status).toBe(200)
    expect(saved.json.source).toBe('plan')
    expect(saved.json.totalUnits).toBe(90)

    const byName = new Map<string, any>(saved.json.rows.map((x: any) => [x.name, x]))
    expect(byName.get('Капучино план QA').sharePct).toBeCloseTo(87.5, 1) // 21 000 из 24 000
    expect(byName.get('Эспрессо план QA').sharePct).toBeCloseTo(12.5, 1)
    // Надбавка на порцию у дорогого капучино больше, чем у эспрессо.
    expect(byName.get('Капучино план QA').overheadPerUnitRub).toBeGreaterThan(
      byName.get('Эспрессо план QA').overheadPerUnitRub,
    )
    // В разбивке видно, из чего состоит надбавка.
    expect(byName.get('Капучино план QA').breakdownRub[0].name).toBe('Аренда')
  })

  it('карта получает свою долю расходов, а не общую', async () => {
    const cap = await createCard('Капучино доля QA', 300)
    const esp = await createCard('Эспрессо доля QA', 150)
    await admin('POST', '/cost/overheads', { name: 'Аренда QA', kind: 'rent', amountRub: 100_000 })
    await admin('PUT', '/cost/settings', { allocation: 'revenue', enabled: true })
    await admin('PUT', '/cost/sales-plan', {
      rows: [
        { cardId: cap, unitsPerMonth: 50 },
        { cardId: esp, unitsPerMonth: 50 },
      ],
    })

    const capCard = await admin('GET', `/cost/tech-cards/${cap}`)
    const espCard = await admin('GET', `/cost/tech-cards/${esp}`)
    // Одинаковый план, но разная цена → разная аренда в чашке.
    expect(capCard.json.card.overheadPerUnitRub).toBeGreaterThan(espCard.json.card.overheadPerUnitRub)
    expect(capCard.json.card.overheadSharePct).toBeCloseTo(66.7, 1)
    expect(capCard.json.card.fullCostPerUnitRub).toBeGreaterThan(capCard.json.card.costPerUnitRub)
  })

  it('фактические чеки важнее плана', async () => {
    const cap = await createCard('Капучино факт QA', 300)
    await createCard('Эспрессо факт QA', 150)
    await admin('POST', '/cost/overheads', { name: 'Аренда QA', kind: 'rent', amountRub: 100_000 })
    await admin('PUT', '/cost/settings', { allocation: 'revenue', enabled: true })
    await admin('PUT', '/cost/sales-plan', { rows: [{ cardId: cap, unitsPerMonth: 30 }] })
    db.prepare(
      `INSERT INTO sales_lines(store_uuid, doc_id, product_id, name_snapshot, qty, sum_kopecks, closed_at)
       VALUES('s-qa','doc-plan-1', NULL, 'Капучино факт QA', 80, ?, ?)`,
    ).run(80 * 30_000, Date.now())

    const r = await admin('GET', '/cost/sales-plan')
    expect(r.json.source).toBe('sales')
    expect(r.json.totals.actualUnits).toBe(80)
  })

  it('сумма плана по позициям становится общим планом продаж', async () => {
    const a = await createCard('Позиция А QA', 200)
    const b = await createCard('Позиция Б QA', 250)
    await admin('PUT', '/cost/sales-plan', {
      rows: [
        { cardId: a, unitsPerMonth: 120 },
        { cardId: b, unitsPerMonth: 80 },
      ],
    })
    const over = await admin('GET', '/cost/overheads')
    expect(over.json.plannedUnitsPerMonth).toBe(200)
  })
})
