import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-vch-mig-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.EVOTOR_PROXY_TOKEN = 'proxy-secret'

const { db } = await import('../db')
const { config } = await import('../config')

describe('STEP-V01: миграция и флаг конфига', () => {
  it('у loyalty_reservations есть колонка benefit_voucher_ids', () => {
    const cols = (db.prepare('PRAGMA table_info(loyalty_reservations)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('benefit_voucher_ids')
  })

  it('миграция 037 зарегистрирована', () => {
    const row = db.prepare("SELECT id FROM schema_migrations WHERE id LIKE '037%'").get() as { id: string } | undefined
    expect(row?.id).toBe('037_voucher_reservation')
  })

  it('флаг resolve по умолчанию выключен, лимит 10', () => {
    expect(config.vouchersInResolve).toBe(false)
    expect(config.maxVouchersInResolve).toBe(10)
  })

  it('старая вставка резерва без колонки проходит, значение NULL', () => {
    db.prepare('INSERT OR IGNORE INTO stores(id,name,address) VALUES(1,?,?)').run('Точка теста', 'адрес')
    db.prepare(
      `INSERT INTO users(nickname, phone, invite_code, card_id, card_code, created_at)
       VALUES('mig','+70000000001','MIG1','CARD-MIG','900001',?)`,
    ).run(Date.now())
    const uid = (db.prepare("SELECT id FROM users WHERE card_id='CARD-MIG'").get() as { id: number }).id
    const nowSec = Math.floor(Date.now() / 1000)
    db.prepare(
      `INSERT INTO loyalty_reservations(id,card_id,benefit_free,benefit_cb,store_uuid,device_uuid,status,created_at,expires_at)
       VALUES('R-mig',?,0,0,'store-1','dev-1','RESERVED',?,?)`,
    ).run(`CARD-MIG-${uid}`, nowSec, nowSec + 90)
    const row = db.prepare("SELECT benefit_voucher_ids AS v FROM loyalty_reservations WHERE id='R-mig'").get() as { v: string | null }
    expect(row.v).toBeNull()
  })
})
