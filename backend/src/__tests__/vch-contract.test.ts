import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-vch-contract-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { app } = await import('../app')
const { db } = await import('../db')
const { config } = await import('../config')
const { vouchersForResolve, activeVouchers, todayDay } = await import('../modules/vouchers/service')

let seq = 0
function person(name = 'ct'): { id: number; cardId: string } {
  const code = String(71000 + ++seq)
  db.prepare('INSERT OR IGNORE INTO stores(id,name,address) VALUES(1,?,?)').run('Точка теста', 'адрес')
  db.prepare(
    `INSERT INTO users(nickname, phone, invite_code, card_id, card_code, created_at) VALUES(?,?,?,?,?,?)`,
  ).run(`${name}-${code}`, `+7710${code}`, `CT${code}`, `CARD-CT-${code}`, code, Date.now())
  const id = Number((db.prepare('SELECT MAX(id) AS id FROM users').get() as { id: number }).id)
  db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(?,?)').run(id, Date.now())
  return { id, cardId: `CARD-CT-${code}` }
}

function templateId(): number {
  db.prepare(
    "INSERT OR IGNORE INTO voucher_templates(code,title,kind,value,valid_days) VALUES('WELCOME','Скидка 10%','percent',10,30)",
  ).run()
  return (db.prepare("SELECT id FROM voucher_templates WHERE code='WELCOME'").get() as { id: number }).id
}

function give(userId: number, opts: { title?: string; kind?: 'percent' | 'fixed'; value?: number; expiresDay?: number; usedAt?: number | null } = {}): number {
  const info = db
    .prepare('INSERT INTO vouchers(user_id,template_id,title,kind,value,expires_day,used_at) VALUES(?,?,?,?,?,?,?)')
    .run(
      userId,
      templateId(),
      opts.title ?? 'Скидка 10%',
      opts.kind ?? 'percent',
      opts.value ?? 10,
      opts.expiresDay ?? todayDay() + 10,
      opts.usedAt ?? null,
    )
  return Number(info.lastInsertRowid)
}

describe('STEP-V02: контракт ваучеров для кассы', () => {
  it('нет ваучеров → пустой список', () => {
    const u = person()
    expect(vouchersForResolve(u.id)).toEqual([])
  })

  it('один percent-ваучер → поля ровно по контракту', () => {
    const u = person()
    const id = give(u.id, { expiresDay: todayDay() + 7 })
    expect(vouchersForResolve(u.id)).toEqual([
      {
        id,
        title: 'Скидка 10%',
        kind: 'percent',
        value: 10,
        redemptionMode: 'once',
        stackableWithFreeCup: false,
        expiresDay: todayDay() + 7,
        imageUrl: null,
      },
    ])
  })

  it('fixed остаётся в копейках', () => {
    const u = person()
    give(u.id, { kind: 'fixed', value: 30000, title: 'Сертификат 300' })
    const v = vouchersForResolve(u.id)[0]
    expect(v.kind).toBe('fixed')
    expect(v.value).toBe(30000)
  })

  it('использованный и просроченный не попадают', () => {
    const u = person()
    give(u.id, { usedAt: Date.now() })
    give(u.id, { expiresDay: todayDay() - 1 })
    expect(vouchersForResolve(u.id)).toEqual([])
  })

  it('некорректные значения пропускаются', () => {
    const u = person()
    give(u.id, { kind: 'percent', value: 0 })
    give(u.id, { kind: 'percent', value: 101 })
    give(u.id, { kind: 'fixed', value: 0 })
    give(u.id, { title: '   ' })
    expect(vouchersForResolve(u.id)).toEqual([])
  })

  it('порядок: ближайший срок, затем меньший id', () => {
    const u = person()
    const late = give(u.id, { title: 'Поздний', expiresDay: todayDay() + 20 })
    const earlyA = give(u.id, { title: 'Ранний-A', expiresDay: todayDay() + 3 })
    const earlyB = give(u.id, { title: 'Ранний-B', expiresDay: todayDay() + 3 })
    // равный срок → меньший id первым
    expect(vouchersForResolve(u.id).map((v) => v.id)).toEqual([earlyA, earlyB, late])
  })

  it('лимит max работает', () => {
    const u = person()
    give(u.id, { expiresDay: todayDay() + 1 })
    give(u.id, { expiresDay: todayDay() + 2 })
    give(u.id, { expiresDay: todayDay() + 3 })
    expect(vouchersForResolve(u.id, 2)).toHaveLength(2)
    expect(vouchersForResolve(u.id)).toHaveLength(3)
    expect(vouchersForResolve(u.id, config.maxVouchersInResolve)).toHaveLength(3)
  })

  it('чужой ваучер не попадает', () => {
    const mine = person()
    const other = person()
    give(other.id)
    expect(vouchersForResolve(mine.id)).toEqual([])
  })
})
