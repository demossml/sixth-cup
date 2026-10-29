import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-vch-free-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { config } = await import('../config')
const { db } = await import('../db')

const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }
const adm = async (m: string, p: string, b?: unknown) => {
  const r = await app.request('/api/admin' + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })
  return { s: r.status, j: (await r.json().catch(() => ({}))) as any }
}

const row = (name: string) =>
  db.prepare('SELECT counts_as_cup AS cup, free_eligible AS free FROM products WHERE name=?').get(name) as
    | { cup: number; free: number }
    | undefined

describe('STEP-V08: free_eligible по умолчанию = counts_as_cup', () => {
  it('новый напиток без флагов получает чашку и подарок', async () => {
    const r = await adm('POST', '/products', { name: 'Латте-тест-N3', price: 250, icon: 'Coffee', available: true })
    expect(r.s).toBeLessThan(400)
    expect(row('Латте-тест-N3')).toEqual({ cup: 1, free: 1 })
  })

  it('явный freeEligible: false уважается', async () => {
    await adm('POST', '/products', { name: 'Латте-без-подарка-N3', price: 250, icon: 'Coffee', available: true, freeEligible: false })
    expect(row('Латте-без-подарка-N3')).toEqual({ cup: 1, free: 0 })
  })

  it('countsAsCup: false без freeEligible даёт оба нуля', async () => {
    await adm('POST', '/products', { name: 'Сироп-N3', price: 50, icon: 'Coffee', available: true, countsAsCup: false })
    expect(row('Сироп-N3')).toEqual({ cup: 0, free: 0 })
  })

  it('эвристика для не-напитка даёт оба нуля', async () => {
    // Схема админки по умолчанию ставит icon='Coffee', а эвристика считает напитком уже по иконке,
    // поэтому «не напиток» задаётся явной иконкой.
    await adm('POST', '/products', { name: 'Мерч-тест-N3', price: 500, icon: 'Box', available: true })
    expect(row('Мерч-тест-N3')).toEqual({ cup: 0, free: 0 })
  })

  it('повторное сохранение без freeEligible не меняет флаг', async () => {
    const created = await adm('POST', '/products', {
      name: 'Латте-фикс-N3', price: 250, icon: 'Coffee', available: true, freeEligible: false,
    })
    const id = created.j.id as number
    expect(row('Латте-фикс-N3')).toEqual({ cup: 1, free: 0 })
    await adm('POST', '/products', { id, name: 'Латте-фикс-N3', price: 250, icon: 'Coffee', available: true })
    expect(row('Латте-фикс-N3')).toEqual({ cup: 1, free: 0 })
  })
})
