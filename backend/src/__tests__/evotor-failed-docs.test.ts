import { describe, it, expect } from 'vitest'
import { app } from '../app'
import { config } from '../config'
import { db } from '../db'

/**
 * Аудит 14.11.2026: на «Сегодня» в таблице «Кассы» стояло «Ошибки 4», но что
 * именно не обработалось — из UI было не понять. Теперь счётчик открывает
 * список документов с человеческим текстом ошибки.
 */
const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }
const call = async (p: string) => {
  const r = await app.request(`/api/admin${p}`, { headers: H })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any }
}

const STORE = 'store-failed-docs'
const NOW = Date.now()

function doc(id: string, status: string, error: string | null, at = NOW) {
  db.prepare(
    `INSERT OR REPLACE INTO evotor_docs
       (store_uuid, doc_id, type, close_date_ms, source, status, attempts, last_error, received_at)
     VALUES (?, ?, 'SELL', ?, 'poll', ?, 1, ?, ?)`,
  ).run(STORE, id, at, status, error, at)
}

describe('GET /evotor/failed-docs', () => {
  it('пустой список, когда ошибок нет', async () => {
    doc('doc-ok', 'PROCESSED', null)
    const r = await call('/evotor/failed-docs')
    expect(r.status).toBe(200)
    expect(Array.isArray(r.json.docs)).toBe(true)
    expect(r.json.docs.find((d: any) => d.docId === 'doc-ok')).toBeUndefined()
  })

  it('отдаёт упавшие документы с человеческим текстом ошибки', async () => {
    doc('doc-401', 'FAILED', 'EvotorApiError: status=401 unauthorized')
    const r = await call('/evotor/failed-docs')
    expect(r.status).toBe(200)
    const found = r.json.docs.find((d: any) => d.docId === 'doc-401')
    expect(found).toBeTruthy()
    expect(found.storeUuid).toBe(STORE)
    expect(found.type).toBe('SELL')
    expect(found.error).toContain('Токен Эвотор отклонён')
    expect(found.at).toBeGreaterThan(0)
  })

  it('без текста ошибки не молчит', async () => {
    doc('doc-silent', 'FAILED', null)
    const r = await call('/evotor/failed-docs')
    const found = r.json.docs.find((d: any) => d.docId === 'doc-silent')
    expect(found.error.length).toBeGreaterThan(5)
  })

  it('фильтр по точке и лимит работают', async () => {
    doc('doc-limit-1', 'FAILED', 'boom', NOW + 2000)
    doc('doc-limit-2', 'FAILED', 'boom', NOW + 1000)
    const other = await call('/evotor/failed-docs?store=' + STORE + '&limit=1')
    expect(other.json.docs.length).toBe(1)
    expect(other.json.docs[0].docId).toBe('doc-limit-1')
    const none = await call('/evotor/failed-docs?store=other-store')
    expect(none.json.docs.length).toBe(0)
  })
})
