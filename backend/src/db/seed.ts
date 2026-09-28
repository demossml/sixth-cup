import { config } from '../config'
import { grantVoucher } from '../modules/vouchers/service'
import { db } from './index'

export const DEMO_CUSTOMER_PHONE = '79000000001'
export const DEMO_FRIEND_PHONE = '79000000002'

export function seedDemoUsers() {
  db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO users(phone,nickname,invite_code,invited_by,cashback_balance,created_at)
                VALUES(?,?,?,?,?,?)`)
      .run(DEMO_CUSTOMER_PHONE, 'Демо Клиент', 'DEMO0001', null, 47, Date.now())
    db.prepare(`INSERT OR IGNORE INTO users(phone,nickname,invite_code,invited_by,cashback_balance,created_at)
                VALUES(?,?,?,?,?,?)`)
      .run(DEMO_FRIEND_PHONE, 'Друг Демо', 'DEMO0002', null, 0, Date.now())

    const customer = db.prepare('SELECT id FROM users WHERE phone=?').get(DEMO_CUSTOMER_PHONE) as { id: number }
    const friend = db.prepare('SELECT id FROM users WHERE phone=?').get(DEMO_FRIEND_PHONE) as { id: number }
    db.prepare('UPDATE users SET invited_by=? WHERE id=?').run(customer.id, friend.id)

    db.prepare('INSERT OR IGNORE INTO cards(user_id,paid_total,free_used,seq,updated_at) VALUES(?,?,?,?,?)')
      .run(customer.id, 4, 0, 0, Date.now())
    db.prepare('INSERT OR IGNORE INTO cards(user_id,paid_total,free_used,seq,updated_at) VALUES(?,?,?,?,?)')
      .run(friend.id, 0, 0, 0, Date.now())

    grantVoucher(customer.id, 'WELCOME')
  })()
}

export function resetDemo() {
  const customer = db.prepare('SELECT id FROM users WHERE phone=?').get(DEMO_CUSTOMER_PHONE) as { id: number } | undefined
  const friend = db.prepare('SELECT id FROM users WHERE phone=?').get(DEMO_FRIEND_PHONE) as { id: number } | undefined
  if (!customer || !friend) {
    seedDemoUsers()
    return
  }
  db.transaction(() => {
    for (const [id, paid, cb] of [[customer.id, 4, 47], [friend.id, 0, 0]] as const) {
      db.prepare('UPDATE cards SET paid_total=?, free_used=0, seq=0, updated_at=? WHERE user_id=?')
        .run(paid, Date.now(), id)
      db.prepare('UPDATE users SET cashback_balance=? WHERE id=?').run(cb, id)
      db.prepare('DELETE FROM vouchers WHERE user_id=?').run(id)
      db.prepare('DELETE FROM receipts WHERE user_id=?').run(id)
    }
    db.prepare('DELETE FROM cashback_ledger WHERE beneficiary_id IN (?,?) OR from_user_id IN (?,?)')
      .run(customer.id, friend.id, customer.id, friend.id)
    db.prepare('DELETE FROM disputes WHERE user_id IN (?,?)').run(customer.id, friend.id)
    grantVoucher(customer.id, 'WELCOME')
  })()
}

export function seedIfEmpty() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM stores').get() as { n: number }
  if (n > 0) return

  db.transaction(() => {
    db.prepare('INSERT INTO stores(name,address) VALUES(?,?)').run('Кофейня на Ленина', 'ул. Ленина, 1')
    db.prepare('INSERT INTO stores(name,address) VALUES(?,?)').run('Кофейня у вокзала', 'Привокзальная пл., 3')

    const pr = db.prepare('INSERT INTO products(name,price,emoji) VALUES(?,?,?)')
    pr.run('Американо', 150, '☕')
    pr.run('Капучино', 190, '🥛')
    pr.run('Латте', 210, '🥛')
    pr.run('Флэт уайт', 220, '☕')
    pr.run('Чай с лимоном', 120, '🍋')
    pr.run('Круассан', 130, '🥐')

    const vt = db.prepare('INSERT INTO voucher_templates(code,title,kind,value,valid_days) VALUES(?,?,?,?,?)')
    vt.run('WELCOME', 'Скидка 10% на первую покупку', 'percent', 10, 30)
    vt.run('WEEK15', 'Скидка 15% на этой неделе', 'percent', 15, 7)

    const now = Math.floor(Date.now() / 1000)
    const pm = db.prepare('INSERT INTO promos(title,body,emoji,sponsor,starts_at,ends_at) VALUES(?,?,?,?,?,?)')
    pm.run('Каждый 6-й стакан бесплатно', 'Копите стаканы — подарок получите автоматически.', '🎁', null, now, now + 365 * 86_400)
    pm.run('Приведи друга — получай 3%', 'За каждую покупку друга тебе 3% кэшбэком. Навсегда.', '🤝', null, now, now + 365 * 86_400)
    pm.run('Круассан к кофе −20%', 'Предложение партнёра — пекарни «Хлебный дом».', '🥐', 'Пекарня «Хлебный дом»', now, now + 30 * 86_400)

    if (config.isDev) {
      db.prepare('INSERT INTO devices(store_id,name,enroll_code,created_at) VALUES(?,?,?,?)')
        .run(1, 'Demo tablet', 'DEMO1234', Date.now())
      seedDemoUsers()
    }
  })()
}
