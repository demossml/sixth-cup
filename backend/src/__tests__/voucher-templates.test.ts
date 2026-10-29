/**
 * Блок D: шаблоны ваучеров V1.
 * D2 — сервис CRUD и валидация; D3 — админ-API; D4 — только активные шаблоны выдаются;
 * D5 — resolve отдаёт ваучеры лишь для QR и только реально предъявляемые.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-vtpl-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { app } = await import('../app')
const { db } = await import('../db')
const {
  activeVouchers, createTemplate, getTemplate, grantVoucher, grantVoucherOnce, listTemplates, updateTemplate,
  vouchersForResolve,
} = await import('../modules/vouchers/service')
const { buildCardProof } = await import('../modules/loyalty/proof')
const { config } = await import('../config')

const admin = { 'Content-Type': 'application/json', 'X-Admin-Token': 'test-admin' }
const proxy = (dev: string) => ({
  'Content-Type': 'application/json', Authorization: 'proxy-secret',
  'X-Evotor-Store-Uuid': 'store-1', 'X-Evotor-Device-UUID': dev,
})

let seq = 0
function guestUser(): number {
  const code = String(90000 + ++seq)
  const t = Date.now()
  db.prepare('INSERT INTO users(nickname, phone, invite_code, card_id, card_code, created_at) VALUES(?,?,?,?,?,?)')
    .run(`vt-${code}`, `+7999${code}`, `VT${code}`, `CARD-${code}`, code, t)
  const id = Number((db.prepare('SELECT MAX(id) AS id FROM users').get() as { id: number }).id)
  db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(?,?)').run(id, t)
  return id
}

describe('D1: миграция и seed', () => {
  it('на чистой БД есть новые колонки и журнал гашений', () => {
    const cols = (t: string) =>
      (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)
    expect(cols('voucher_templates')).toEqual(
      expect.arrayContaining(['active', 'image_url', 'redemption_mode', 'max_per_day', 'max_total', 'stackable_with_free_cup']),
    )
    expect(cols('vouchers')).toContain('redemptions_count')
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='voucher_redemptions'").get(),
    ).toBeTruthy()
  })

  it('seed создаёт WELCOME активным и повторный запуск его не дублирует', async () => {
    const { seedIfEmpty } = await import('../db/seed')
    seedIfEmpty()
    seedIfEmpty()
    const rows = db.prepare("SELECT id, title, kind, value, valid_days AS validDays, active, redemption_mode AS mode FROM voucher_templates WHERE code='WELCOME'").all() as {
      id: number
      title: string
      kind: string
      value: number
      validDays: number
      active: number
      mode: string
    }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'percent', value: 10, validDays: 30, active: 1, mode: 'once' })
    // активный WELCOME реально выдаётся без ручных правок
    const uid = guestUser()
    expect(grantVoucherOnce(uid, 'WELCOME')).toBe(true)
  })
})

describe('D2: сервис шаблонов', () => {
  it('создаёт, читает и обновляет шаблон', () => {
    const created = createTemplate({
      code: 'spring', title: 'Весенняя скидка', kind: 'percent', value: 15, validDays: 14,
    })!
    expect(created.code).toBe('SPRING')
    expect(created.active).toBe(true)
    expect(created.redemptionMode).toBe('once')
    expect(created.stackableWithFreeCup).toBe(true)
    expect(getTemplate('SPRING')?.title).toBe('Весенняя скидка')

    const updated = updateTemplate(created.id, { value: 20, redemptionMode: 'multi', maxPerDay: 2 })!
    expect(updated.value).toBe(20)
    expect(updated.redemptionMode).toBe('multi')
    expect(updated.maxPerDay).toBe(2)
  })

  it('обновляет шаблон и по коду, а не только по id', () => {
    createTemplate({ code: 'BY-CODE', title: 'По коду', kind: 'fixed', value: 50, validDays: 4 })
    const updated = updateTemplate('by-code', { title: 'По коду (изм.)' })!
    expect(updated.title).toBe('По коду (изм.)')
    expect(updated.code).toBe('BY-CODE')
  })

  it('не даёт создать дубликат кода', () => {
    createTemplate({ code: 'DUP', title: 'Дубликат', kind: 'fixed', value: 100, validDays: 5 })
    expect(() => createTemplate({ code: 'dup', title: 'Дубликат 2', kind: 'fixed', value: 100, validDays: 5 }))
      .toThrow(/уже существует/i)
  })

  it('валидирует значение, срок и режим гашения', () => {
    expect(() => createTemplate({ code: 'BAD1', title: 'x', kind: 'percent', value: 120, validDays: 5 }))
      .toThrow(/100/)
    expect(() => createTemplate({ code: 'BAD2', title: 'x', kind: 'fixed', value: 0, validDays: 5 }))
      .toThrow(/больше нуля/i)
    expect(() => createTemplate({ code: 'BAD3', title: 'x', kind: 'fixed', value: 10, validDays: 0 }))
      .toThrow(/минимум 1/i)
    expect(() => updateTemplate(getTemplate('DUP')!.id, { redemptionMode: 'weekly' as never }))
      .toThrow(/once или multi/i)
  })

  it('listTemplates скрывает выключенные, если не просили обратное', () => {
    const off = createTemplate({ code: 'OFF', title: 'Выключен', kind: 'fixed', value: 50, validDays: 3, active: false })!
    expect(listTemplates().some((t) => t.id === off.id)).toBe(false)
    expect(listTemplates({ includeInactive: true }).some((t) => t.id === off.id)).toBe(true)
  })
})

describe('D3: админ-API шаблонов', () => {
  it('создаёт шаблон через POST', async () => {
    const r = await app.request('/api/admin/voucher-templates', {
      method: 'POST', headers: admin,
      body: JSON.stringify({ code: 'api1', title: 'Через API', kind: 'fixed', value: 300, validDays: 7 }),
    })
    expect(r.status).toBe(201)
    const body = await r.json() as any
    expect(body.template.code).toBe('API1')
    expect(body.template.active).toBe(true)
  })

  it('патчит шаблон и отдаёт его в списке', async () => {
    const created = createTemplate({ code: 'API2', title: 'До', kind: 'fixed', value: 100, validDays: 7 })!
    const r = await app.request(`/api/admin/voucher-templates/${created.id}`, {
      method: 'PATCH', headers: admin,
      body: JSON.stringify({ title: 'После', active: false, imageUrl: 'https://cdn.test/v.png' }),
    })
    expect(r.status).toBe(200)
    const body = await r.json() as any
    expect(body.template.title).toBe('После')
    expect(body.template.active).toBe(false)
    expect(body.template.imageUrl).toBe('https://cdn.test/v.png')

    const all = await app.request('/api/admin/voucher-templates?all=1', { headers: admin })
    expect(((await all.json()) as any).templates.some((t: any) => t.id === created.id)).toBe(true)
  })

  it('отказывает по несуществующему id и по кривому адресу картинки', async () => {
    const missing = await app.request('/api/admin/voucher-templates/99999', {
      method: 'PATCH', headers: admin, body: JSON.stringify({ title: 'Нет такого' }),
    })
    expect(missing.status).toBe(400)
    const badImg = await app.request('/api/admin/voucher-templates', {
      method: 'POST', headers: admin,
      body: JSON.stringify({ code: 'api3', title: 'x', kind: 'fixed', value: 10, validDays: 2, imageUrl: 'javascript:alert(1)' }),
    })
    expect(badImg.status).toBe(400)
  })
})

describe('D3: карточка клиента показывает состояние ваучера', () => {
  it('отдаёт режим гашения, счётчик и код шаблона', async () => {
    createTemplate({
      code: 'CARD-MULTI', title: 'Многоразовый', kind: 'fixed', value: 150, validDays: 9, redemptionMode: 'multi',
    })
    const uid = guestUser()
    grantVoucher(uid, 'CARD-MULTI')
    const r = await app.request(`/api/admin/customers/${uid}`, { headers: admin })
    expect(r.status).toBe(200)
    const j = (await r.json()) as { vouchers: { title: string; redemptionMode: string; redemptionsCount: number; templateCode: string }[] }
    const row = j.vouchers.find((v) => v.title === 'Многоразовый')
    expect(row).toMatchObject({ redemptionMode: 'multi', redemptionsCount: 0, templateCode: 'CARD-MULTI' })
  })
})

describe('D4: выдача только активных шаблонов', () => {
  it('grant неактивного шаблона → ошибка', () => {
    const off = createTemplate({ code: 'OFF2', title: 'Выключен', kind: 'fixed', value: 50, validDays: 3, active: false })!
    const uid = guestUser()
    expect(() => grantVoucher(uid, off.code)).toThrow(/выключен/i)
    expect(() => grantVoucherOnce(uid, off.code)).toThrow(/выключен/i)
  })

  it('админ не выдаёт выключенный шаблон массово и по одному', async () => {
    const off = createTemplate({ code: 'OFF3', title: 'Выключен', kind: 'fixed', value: 70, validDays: 3, active: false })!
    const uid = guestUser()
    const bulk = await app.request('/api/admin/vouchers/grant-all', {
      method: 'POST', headers: admin, body: JSON.stringify({ code: off.code }),
    })
    expect(bulk.status).toBe(400)
    const single = await app.request(`/api/admin/customers/${uid}/vouchers`, {
      method: 'POST', headers: admin, body: JSON.stringify({ code: off.code }),
    })
    expect(single.status).toBe(400)
    const preview = await app.request(`/api/admin/vouchers/grant-all/preview?code=${off.code}`, { headers: admin })
    expect(preview.status).toBe(400)
    const n = (db.prepare('SELECT COUNT(*) AS n FROM vouchers WHERE template_id=?').get(off.id) as { n: number }).n
    expect(n).toBe(0)
  })

  it('WELCOME через grantVoucherOnce не дублируется', () => {
    // WELCOME уже создан сидом в D1 — берём его, а не создаём заново.
    expect(getTemplate('WELCOME')).toBeTruthy()
    const uid = guestUser()
    expect(grantVoucherOnce(uid, 'WELCOME')).toBe(true)
    expect(grantVoucherOnce(uid, 'WELCOME')).toBe(false)
    const n = (db.prepare('SELECT COUNT(*) AS n FROM vouchers WHERE user_id=?').get(uid) as { n: number }).n
    expect(n).toBe(1)
  })
})

describe('D5: ваучеры в resolve', () => {
  // STEP-V05: ваучеры в resolve отдаются только при включённом флаге.
  beforeEach(() => { config.vouchersInResolve = true })
  afterEach(() => { config.vouchersInResolve = false })

  it('QR отдаёт активные ваучеры, числовой код — нет', async () => {
    createTemplate({ code: 'RES1', title: 'Кофе в подарок', kind: 'fixed', value: 200, validDays: 5 })
    const uid = guestUser()
    grantVoucher(uid, 'RES1')

    expect(vouchersForResolve(uid)).toHaveLength(1)
    expect(vouchersForResolve(uid)[0]).toMatchObject({ title: 'Кофе в подарок', kind: 'fixed', value: 200 })

    const byQr = await app.request('/api/devices/loyalty/resolve', {
      method: 'POST', headers: proxy('dev-vtpl-1'), body: JSON.stringify({ code: buildCardProof(uid) }),
    })
    expect(byQr.status).toBe(200)
    const qr = await byQr.json() as any
    expect(qr.kind).toBe('token')
    expect(qr.vouchers).toHaveLength(1)
    // D-05/D-06: контракт кассы всегда once и не совмещается с подарком.
    expect(qr.vouchers[0]).toMatchObject({ title: 'Кофе в подарок', redemptionMode: 'once', stackableWithFreeCup: false })

    const cardCode = (db.prepare('SELECT card_code FROM users WHERE id=?').get(uid) as { card_code: string }).card_code
    const manual = await app.request('/api/devices/loyalty/resolve', {
      method: 'POST', headers: proxy('dev-vtpl-1'), body: JSON.stringify({ code: cardCode }),
    })
    const num = await manual.json() as any
    expect(num.kind).toBe('code')
    expect(num.vouchers).toEqual([])
  })

  it('погашенный once и истёкший ваучер в список не попадают', async () => {
    createTemplate({ code: 'RES2', title: 'Одноразовый', kind: 'fixed', value: 100, validDays: 5 })
    const uid = guestUser()
    grantVoucher(uid, 'RES2')
    const id = vouchersForResolve(uid)[0].id
    db.prepare('UPDATE vouchers SET used_at=? WHERE id=?').run(Math.floor(Date.now() / 1000), id)
    expect(vouchersForResolve(uid)).toHaveLength(0)

    createTemplate({ code: 'RES3', title: 'Просроченный', kind: 'fixed', value: 100, validDays: 1 })
    const uid2 = guestUser()
    grantVoucher(uid2, 'RES3')
    db.prepare('UPDATE vouchers SET expires_day=? WHERE user_id=?').run(1, uid2)
    expect(vouchersForResolve(uid2)).toHaveLength(0)
  })

  it('выключенный шаблон скрывает ваучер и в карточке гостя (PWA /sync)', () => {
    createTemplate({ code: 'RES5', title: 'Показываем', kind: 'fixed', value: 100, validDays: 5 })
    const uid = guestUser()
    grantVoucher(uid, 'RES5')
    expect(activeVouchers(uid)).toHaveLength(1)
    updateTemplate('RES5', { active: false })
    expect(activeVouchers(uid)).toHaveLength(0)
  })

  it('выключенный шаблон скрывает ваучер из resolve', async () => {
    const uid2 = guestUser()
    grantVoucher(uid2, 'RES1')
    expect(vouchersForResolve(uid2)).toHaveLength(1)
    updateTemplate(getTemplate('RES1')!.id, { active: false })
    expect(vouchersForResolve(uid2)).toHaveLength(0)
  })
})
