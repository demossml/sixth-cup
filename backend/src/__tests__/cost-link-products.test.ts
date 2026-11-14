import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { admin } from './wh-helpers'

/**
 * Best-effort связка техкарт с товарами по названию (аудит 14.11.2026).
 * Связываем только однозначные совпадения: спорные остаются человеку.
 */
function makeProduct(name: string): number {
  const t = Date.now()
  return Number(
    db.prepare(`INSERT INTO products(name, price, available, created_at, updated_at) VALUES(?,?,1,?,?)`)
      .run(name, 0, t, t).lastInsertRowid,
  )
}

/** Легаси-карта без товара (так выглядели все 12 карт на проде). */
function legacyCard(name: string, kind = 'dish'): number {
  const t = Date.now()
  const id = Number(
    db.prepare(`INSERT INTO tech_cards(name, kind, output_qty, output_unit, status, write_off_mode, created_at, updated_at)
                VALUES(?,?,1,'pcs','active','ingredients',?,?)`).run(name, kind, t, t).lastInsertRowid,
  )
  db.prepare(`INSERT INTO tech_card_versions(card_id, valid_from, note, created_at) VALUES(?,?,?,?)`).run(id, t, 'легаси', t)
  return id
}

beforeEach(() => {
  db.prepare(`DELETE FROM tech_card_lines`).run()
  db.prepare(`DELETE FROM tech_card_versions`).run()
  db.prepare(`DELETE FROM tech_cards`).run()
})

describe('POST /cost/tech-cards/link-products', () => {
  it('по умолчанию только показывает план, данные не меняет', async () => {
    const productId = makeProduct('Капучино 250 мл')
    const cardId = legacyCard('КАПУЧИНО 250')

    const dry = await admin('POST', '/cost/tech-cards/link-products', {})
    expect(dry.status).toBe(200)
    expect(dry.json.applied).toBe(0)
    expect(dry.json.matched).toEqual([
      { cardId, cardName: 'КАПУЧИНО 250', productId, productName: 'Капучино 250 мл' },
    ])
    const after = db.prepare(`SELECT product_id AS p FROM tech_cards WHERE id=?`).get(cardId) as { p: number | null }
    expect(after.p).toBeNull()
  })

  it('dry=0 связывает карту с товаром', async () => {
    const productId = makeProduct('Латте 350 мл')
    const cardId = legacyCard('Латте 350')
    const apply = await admin('POST', '/cost/tech-cards/link-products?dry=0', {})
    expect(apply.status).toBe(200)
    expect(apply.json.applied).toBe(1)
    const after = db.prepare(`SELECT product_id AS p FROM tech_cards WHERE id=?`).get(cardId) as { p: number | null }
    expect(after.p).toBe(productId)
  })

  it('неоднозначные и неизвестные имена уходят в unresolved', async () => {
    // Два товара с одинаковым нормализованным именем — как дубли в каталоге.
    makeProduct('Раф 300 мл')
    makeProduct('Раф 300 мл')
    const orphan = legacyCard('Раф 999')
    const ambiguousCard = legacyCard('Раф 300')
    const plan = await admin('POST', '/cost/tech-cards/link-products', {})
    const names = plan.json.unresolved.map((u: { cardName: string; reason: string }) => u.cardName + ':' + u.reason)
    expect(plan.json.matched).toHaveLength(0)
    expect(names.some((n: string) => n.startsWith('Раф 999'))).toBe(true)
    expect(names.some((n: string) => n.startsWith('Раф 300'))).toBe(true)
    expect(orphan).toBeGreaterThan(0)
    expect(ambiguousCard).toBeGreaterThan(0)
  })

  it('заготовки не трогаем — им товар не нужен', async () => {
    makeProduct('Молоко взбитое')
    legacyCard('Молоко взбитое', 'semi')
    const plan = await admin('POST', '/cost/tech-cards/link-products', {})
    expect(plan.json.matched).toHaveLength(0)
    expect(plan.json.unresolved).toHaveLength(0)
  })
})
