/**
 * Бан за невыкуп должен быть виден и снимаем в карточке клиента.
 *
 * Раньше снять бан можно было только на странице «Предзаказы» списком; в карточке
 * клиента бана не было видно вообще, поэтому поддержка не понимала, почему гость
 * не может оформить заказ.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-customer-ban-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { ensurePreorderTables } = await import('../modules/orders/service')

const H_ADMIN = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }
const JSONH = { 'content-type': 'application/json' }

type Ban = { until: number; reason: string; orderId: string | null } | null

async function guestId(): Promise<number> {
  const r = await app.request('/api/auth/guest', { method: 'POST', headers: JSONH, body: '{}' })
  const { token } = (await r.json()) as { token: string }
  const payload = JSON.parse(Buffer.from(token.split('.')[1] as string, 'base64url').toString('utf8')) as { sub: number }
  return Number(payload.sub)
}

const detail = async (id: number) => {
  const res = await app.request(`/api/admin/customers/${id}`, { headers: H_ADMIN })
  return { status: res.status, body: (await res.json()) as { preorderBan: Ban; hints: string[] } }
}

describe('бан за невыкуп в карточке клиента', () => {
  it('виден, снимается кнопкой и больше не блокирует заказ', async () => {
    ensurePreorderTables(db as never)
    const id = await guestId()
    const until = Math.floor(Date.now() / 1000) + 3 * 3600
    db.prepare(`INSERT INTO preorder_bans(user_id, until, reason, order_id, created_at, lifted_at)
      VALUES(?,?, 'no_show', 'order-1', ?, NULL)`).run(id, until, Math.floor(Date.now() / 1000))

    const before = await detail(id)
    expect(before.status).toBe(200)
    expect(before.body.preorderBan?.until).toBe(until)
    expect(before.body.preorderBan?.reason).toBe('no_show')
    expect(before.body.hints.join(' ')).toContain('Бан за невыкуп')

    const lift = await app.request(`/api/admin/preorder/bans/${id}/lift`, { method: 'POST', headers: H_ADMIN })
    expect(lift.status).toBe(200)
    expect(((await lift.json()) as { lifted: boolean }).lifted).toBe(true)

    const after = await detail(id)
    expect(after.body.preorderBan).toBeNull()
    expect(after.body.hints.join(' ')).not.toContain('Бан за невыкуп')
  })

  it('без бана карточка отдаёт null', async () => {
    const id = await guestId()
    const res = await detail(id)
    expect(res.status).toBe(200)
    expect(res.body.preorderBan).toBeNull()
  })

  it('истёкший бан не показывается и снимается на чтении', async () => {
    ensurePreorderTables(db as never)
    const id = await guestId()
    db.prepare(`INSERT INTO preorder_bans(user_id, until, reason, order_id, created_at, lifted_at)
      VALUES(?,?, 'no_show', NULL, ?, NULL)`).run(id, Math.floor(Date.now() / 1000) - 60, Math.floor(Date.now() / 1000))
    expect((await detail(id)).body.preorderBan).toBeNull()
    const row = db.prepare('SELECT lifted_at FROM preorder_bans WHERE user_id=?').get(id) as { lifted_at: number | null }
    expect(row.lifted_at).not.toBeNull()
  })
})
