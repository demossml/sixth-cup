import { describe, expect, it } from 'vitest'
import { db } from '../db'
import { admin } from './wh-helpers'

/**
 * Аудит 14.11.2026: две схемы добавок висели с 0 позиций при 13 и 25 товарах —
 * на кассе это пустая группа «Дополнительно». Счётчики должны быть в ответе,
 * чтобы админка показала проблему.
 */
function productWithScheme(name: string, schemeId: number): void {
  const t = Date.now()
  db.prepare(
    `INSERT INTO products(name, price, available, modifier_scheme_id, created_at, updated_at)
     VALUES(?,?,1,?,?,?)`,
  ).run(name, 100, schemeId, t, t)
}

describe('GET /modifier-schemes — счётчики состава', () => {
  it('пустая схема отдаёт itemsCount=0 и productCount>0', async () => {
    const created = await admin('POST', '/modifier-schemes', { name: 'Пустая схема QA', options: [] })
    expect(created.status).toBe(200)
    const id = Number(created.json.id)
    productWithScheme('Товар с пустой схемой QA', id)

    const list = await admin('GET', '/modifier-schemes')
    expect(list.status).toBe(200)
    const mine = list.json.schemes.find((s: { id: number }) => s.id === id)
    expect(mine.itemsCount).toBe(0)
    expect(mine.productCount).toBe(1)
  })

  it('после наполнения itemsCount растёт', async () => {
    const created = await admin('POST', '/modifier-schemes', {
      name: 'Схема с составом QA',
      options: [
        { kind: 'zero', groupKey: 'syrup', name: 'Без сиропа', isDefault: true, maxCount: 1 },
        { kind: 'zero', groupKey: 'extra', name: 'Без топпинга', maxCount: 1 },
      ],
    })
    expect(created.status).toBe(200)
    const id = Number(created.json.id)
    const list = await admin('GET', '/modifier-schemes')
    const mine = list.json.schemes.find((s: { id: number }) => s.id === id)
    expect(mine.itemsCount).toBe(2)
    expect(mine.productCount).toBe(0)
  })
})
