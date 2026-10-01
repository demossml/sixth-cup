import { sign } from 'hono/jwt'
import { config } from '../config'
import { db } from './index'
import { ensureCard } from '../modules/loyalty/proof'
import { grantVoucher } from '../modules/vouchers/service'

export const DEMO_CUSTOMER_PHONE = '+79001112233'
export const DEMO_FRIEND_PHONE = '+79004445566'

function now() {
  return Date.now()
}

function ensureDefaultOrganization(): number {
  const existing = db.prepare('SELECT id FROM organizations WHERE inn=?').get('0000000000') as { id: number } | undefined
  if (existing) return existing.id
  const t = now()
  const r = db.prepare(`
    INSERT INTO organizations(name, legal_name, inn, kpp, tax_regime, vat_rate, active, created_at, updated_at)
    VALUES(?,?,?,?,?,?,1,?,?)
  `).run('Демо ООО', 'ООО «6.7 Coffee»', '0000000000', null, 'usn_income', 0, t, t)
  return Number(r.lastInsertRowid)
}

export function seedIfEmpty() {
  const orgId = ensureDefaultOrganization()

  // Link any store without organization
  db.prepare('UPDATE stores SET organization_id=? WHERE organization_id IS NULL').run(orgId)

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM stores').get() as { n: number }
  if (n === 0) {
    db.prepare('INSERT INTO stores(name,address,organization_id) VALUES(?,?,?)')
      .run('Кофейня на Ленина', 'ул. Ленина, 1', orgId)
    db.prepare('INSERT INTO stores(name,address,organization_id) VALUES(?,?,?)')
      .run('Кофейня у вокзала', 'Привокзальная пл., 3', orgId)
  }

  const catCount = (db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n
  if (catCount === 0) {
    const t = now()
    const ins = db.prepare(
      'INSERT INTO categories(name, sort_order, available, created_at, updated_at) VALUES(?,?,1,?,?)'
    )
    ins.run('Напитки', 0, t, t)
    ins.run('Еда', 1, t, t)
    ins.run('Другое', 2, t, t)
  }

  const prodCount = (db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n
  if (prodCount === 0) {
    const drinks = db.prepare(`SELECT id FROM categories WHERE name='Напитки'`).get() as { id: number }
    const food = db.prepare(`SELECT id FROM categories WHERE name='Еда'`).get() as { id: number }
    const t = now()
    const pr = db.prepare(`
      INSERT INTO products(name,price,icon,available,description,category_id,sort_order,created_at,updated_at)
      VALUES(?,?,?,1,?,?,?,?,?)
    `)
    pr.run('Американо', 150, 'Coffee', 'Классический чёрный кофе', drinks.id, 0, t, t)
    pr.run('Капучино', 190, 'CupSoda', null, drinks.id, 1, t, t)
    pr.run('Латте', 210, 'Milk', null, drinks.id, 2, t, t)
    pr.run('Флэт уайт', 220, 'Coffee', null, drinks.id, 3, t, t)
    pr.run('Чай с лимоном', 120, 'Leaf', null, drinks.id, 4, t, t)
    pr.run('Круассан', 130, 'Croissant', null, food.id, 0, t, t)
  } else {
    // Backfill timestamps / default category for old rows
    const drinks = db.prepare(`SELECT id FROM categories WHERE name='Напитки'`).get() as { id: number } | undefined
    if (drinks) {
      db.prepare('UPDATE products SET category_id=? WHERE category_id IS NULL').run(drinks.id)
    }
    const t = now()
    db.prepare('UPDATE products SET created_at=? WHERE created_at IS NULL').run(t)
    db.prepare('UPDATE products SET updated_at=? WHERE updated_at IS NULL').run(t)
  }

  const vt = (db.prepare('SELECT COUNT(*) AS n FROM voucher_templates').get() as { n: number }).n
  if (vt === 0) {
    const ins = db.prepare(
      'INSERT INTO voucher_templates(code,title,kind,value,valid_days) VALUES(?,?,?,?,?)'
    )
    ins.run('WELCOME', 'Скидка 10% на первую покупку', 'percent', 10, 30)
    ins.run('WEEK15', 'Скидка 15% на этой неделе', 'percent', 15, 7)
  }

  const pm = (db.prepare('SELECT COUNT(*) AS n FROM promos').get() as { n: number }).n
  if (pm === 0) {
    const ts = Math.floor(Date.now() / 1000)
    const ins = db.prepare(
      'INSERT INTO promos(title,body,icon,sponsor,starts_at,ends_at) VALUES(?,?,?,?,?,?)'
    )
    ins.run(
      'Каждый 6.7 Coffee бесплатно',
      'Копите стаканы — подарок получите автоматически.',
      'Gift',
      null,
      ts,
      ts + 365 * 86_400
    )
    ins.run(
      'Приведи друга — получай 3%',
      'За каждую покупку друга тебе 3% кэшбэком. Навсегда.',
      'Users',
      null,
      ts,
      ts + 365 * 86_400
    )
  }

  if (config.isDev) {
    const dev = db.prepare(`SELECT id FROM devices WHERE enroll_code='DEMO1234'`).get()
    if (!dev) {
      const store = db.prepare('SELECT id FROM stores ORDER BY id LIMIT 1').get() as { id: number }
      db.prepare('INSERT INTO devices(store_id,name,enroll_code,created_at) VALUES(?,?,?,?)').run(
        store.id,
        'Demo tablet',
        'DEMO1234',
        Date.now()
      )
    }
    seedDemoUsers()
    seedModifiers()
  }
}

function seedModifiers() {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM modifiers').get() as { n: number }).n
  if (n > 0) return
  const t = Date.now()
  const ins = db.prepare(
    'INSERT INTO modifiers(name,price,group_key,available,sort_order,created_at,updated_at) VALUES(?,?,?,1,?,?,?)'
  )
  const mods = [
    ['Ваниль', 40, 'syrup', 0],
    ['Карамель', 40, 'syrup', 1],
    ['Лесной орех', 40, 'syrup', 2],
    ['Корица', 20, 'topping', 0],
    ['Взбитые сливки', 50, 'topping', 1],
    ['Овсяное молоко', 50, 'milk', 0],
    ['Кокосовое молоко', 50, 'milk', 1],
  ]
  const ids: number[] = []
  for (const [name, price, gk, sort] of mods) {
    const r = ins.run(name, price, gk, sort, t, t)
    ids.push(Number(r.lastInsertRowid))
  }
  const sch = db.prepare('INSERT INTO modifier_schemes(name,created_at,updated_at) VALUES(?,?,?)')
    .run('Кофе стандарт', t, t)
  const schemeId = Number(sch.lastInsertRowid)
  const link = db.prepare(
    'INSERT INTO modifier_scheme_items(scheme_id,modifier_id,required,max_count) VALUES(?,?,0,2)'
  )
  for (const id of ids) link.run(schemeId, id)
  // attach to drink-like products without scheme
  db.prepare(`
    UPDATE products SET modifier_scheme_id=?
    WHERE modifier_scheme_id IS NULL AND (
      lower(name) LIKE '%капуч%' OR lower(name) LIKE '%латте%' OR lower(name) LIKE '%амер%'
      OR lower(name) LIKE '%флэт%' OR lower(name) LIKE '%эспр%' OR icon='Coffee'
    )
  `).run(schemeId)
}


function seedDemoUsers() {
  const exists = db.prepare('SELECT id FROM users WHERE phone=?').get(DEMO_CUSTOMER_PHONE)
  if (exists) return
  const t = Date.now()
  const inv = db
    .prepare('INSERT INTO users(phone,nickname,invite_code,invited_by,created_at) VALUES(?,?,?,?,?)')
    .run(DEMO_CUSTOMER_PHONE, 'Демо Клиент', 'DEMOHOST', null, t)
  const hostId = Number(inv.lastInsertRowid)
  ensureCard(hostId)
  grantVoucher(hostId, 'WELCOME')
  const fr = db
    .prepare('INSERT INTO users(phone,nickname,invite_code,invited_by,created_at) VALUES(?,?,?,?,?)')
    .run(DEMO_FRIEND_PHONE, 'Демо Друг', 'DEMOFRND', hostId, t)
  ensureCard(Number(fr.lastInsertRowid))
}

export function resetDemo() {
  db.exec(`
    DELETE FROM cashback_ledger;
    DELETE FROM disputes;
    DELETE FROM receipts;
    DELETE FROM vouchers;
    DELETE FROM cards;
    DELETE FROM users;
    DELETE FROM sms_codes;
  `)
  seedDemoUsers()
}

export async function demoToken(phone = DEMO_CUSTOMER_PHONE) {
  const u = db.prepare('SELECT id FROM users WHERE phone=?').get(phone) as { id: number }
  return sign({ sub: u.id, exp: Math.floor(Date.now() / 1000) + 86400 * 180 }, config.jwtSecret)
}
