import type Database from 'better-sqlite3'

export function digitsForCount(count: number): number {
  if (count <= 0) return 1
  return Math.max(1, String(count).length)
}

export function formatCardCode(n: number, digits: number): string {
  return String(n).padStart(digits, '0')
}

export function ensureCardCode(db: Database.Database, userId: number): string {
  const cols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'card_code')) {
    db.exec(`ALTER TABLE users ADD COLUMN card_code TEXT`)
    try {
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_card_code ON users(card_code) WHERE card_code IS NOT NULL`,
      )
    } catch {}
  }

  const row = db.prepare('SELECT card_code FROM users WHERE id=?').get(userId) as
    | { card_code: string | null }
    | undefined
  if (row?.card_code) return row.card_code

  const maxRow = db
    .prepare(
      `SELECT MAX(CAST(card_code AS INTEGER)) AS m FROM users WHERE card_code GLOB '[0-9]*'`,
    )
    .get() as { m: number | null }
  const next = (maxRow?.m ?? 0) + 1
  const total =
    (
      db.prepare(`SELECT COUNT(*) AS n FROM users WHERE card_code IS NOT NULL`).get() as {
        n: number
      }
    ).n + 1
  const digits = digitsForCount(Math.max(total, next))
  const existing = db
    .prepare(`SELECT id, card_code FROM users WHERE card_code GLOB '[0-9]*'`)
    .all() as { id: number; card_code: string }[]
  const upd = db.prepare(`UPDATE users SET card_code=? WHERE id=?`)
  db.transaction(() => {
    for (const e of existing) {
      const num = parseInt(e.card_code, 10)
      if (!Number.isNaN(num)) upd.run(formatCardCode(num, digits), e.id)
    }
    upd.run(formatCardCode(next, digits), userId)
  })()
  return formatCardCode(next, digits)
}

export function findUserByCardCode(db: Database.Database, raw: string) {
  const cols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'card_code')) return null
  const code = raw.replace(/\D/g, '')
  if (!code) return null
  let u = db.prepare(`SELECT * FROM users WHERE card_code=?`).get(code)
  if (u) return u
  const n = parseInt(code, 10)
  if (Number.isNaN(n)) return null
  return db.prepare(`SELECT * FROM users WHERE CAST(card_code AS INTEGER)=?`).get(n) ?? null
}
