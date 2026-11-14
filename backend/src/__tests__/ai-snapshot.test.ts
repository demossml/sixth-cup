import { describe, expect, it } from 'vitest'
import { db } from '../db'
import { businessSnapshot } from '../modules/admin/ai'

/**
 * Аудит 14.11.2026: помощник получал пять счётчиков и на 4 из 5 операционных
 * вопросов отвечал «данных нет». Снимок должен покрывать склад, техкарты и закупки.
 */
const DAY = 86_400_000

describe('businessSnapshot для ИИ-помощника', () => {
  it('отдаёт блоки продаж, меню, себестоимости, склада и закупок', () => {
    const t = Date.now()
    const productId = Number(
      db.prepare(`INSERT INTO products(name, price, available, created_at, updated_at) VALUES(?,?,1,?,?)`)
        .run('Снимок товар QA', 190, t, t).lastInsertRowid,
    )
    // Карта без товара — как 12 карт на проде до аудита.
    db.prepare(
      `INSERT INTO tech_cards(name, kind, output_qty, output_unit, status, write_off_mode, created_at, updated_at)
       VALUES('Снимок карта QA','dish',1,'pcs','active','ingredients',?,?)`,
    ).run(t, t)
    db.prepare(
      `INSERT INTO tech_cards(name, kind, output_qty, output_unit, product_id, status, write_off_mode, created_at, updated_at)
       VALUES('Снимок карта с товаром QA','dish',1,'pcs',?,'active','ingredients',?,?)`,
    ).run(productId, t, t)

    const snap = businessSnapshot(Date.now() - DAY, '24h')
    expect(snap.period).toBe('24h')
    expect(Object.keys(snap.sales).sort()).toEqual(['cups', 'failedDocs', 'revenueRub', 'sellDocs', 'withCard'])
    expect(snap.menu.products).toBeGreaterThan(0)
    expect(Object.keys(snap.menu)).toContain('addonSchemesEmpty')
    expect(snap.cost.cards).toBeGreaterThanOrEqual(2)
    expect(snap.cost.withoutProduct).toBeGreaterThanOrEqual(1)
    expect(snap.cost.topUnlinked).toContain('Снимок карта QA')
    expect(snap.stock.positions).toBeGreaterThanOrEqual(0)
    expect(Object.keys(snap.stock)).toEqual(['positions', 'noReceipts', 'productsWithoutNorm'])
    expect(Object.keys(snap.purchases)).toEqual(['suppliers', 'invoices', 'invoicesDraft'])
  })

  it('не выдумывает выручку: пустая база — нули', () => {
    const snap = businessSnapshot(Date.now() - DAY, '24h')
    expect(snap.sales.revenueRub).toBe(0)
    expect(snap.sales.cups).toBe(0)
  })
})
