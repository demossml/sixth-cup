/**
 * P3-4: QR на меню и дата актуальности цен.
 * QR генерирует сервер и складывает в uploads; в блоке хранится `{{date}}`,
 * которую подставляет resolveDoc при печати.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-qr-date-'))
const uploads = join(dir, 'uploads')
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = uploads
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { fillPrintDate, PRINT_DATE_TOKEN } = await import('../modules/admin/menuLayoutDoc')

const H = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }

const mkLayout = async () => {
  const created = await app.request('/api/admin/menu-layouts', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ title: 'QR' }),
  })
  return ((await created.json()) as { layout: { id: number } }).layout.id
}

beforeEach(() => {
  db.prepare('DELETE FROM menu_layout_shares').run()
  db.prepare('DELETE FROM menu_layouts').run()
})

describe('P3-4: QR на листе', () => {
  it('генерирует PNG в uploads и возвращает путь', async () => {
    const id = await mkLayout()
    const res = await app.request(`/api/admin/menu-layouts/${id}/qr`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ url: 'https://67coffee.ru/menu' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string; target: string }
    expect(body.url).toMatch(/^\/uploads\/qr-\d+-[0-9a-f]{12}\.png$/)
    expect(body.target).toBe('https://67coffee.ru/menu')
    expect(existsSync(join(uploads, body.url.slice('/uploads/'.length)))).toBe(true)
  })

  it('без ссылки берёт адрес по умолчанию', async () => {
    const id = await mkLayout()
    const res = await app.request(`/api/admin/menu-layouts/${id}/qr`, { method: 'POST', headers: H, body: '{}' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { target: string }).target).toMatch(/^https:\/\//)
  })

  it('не принимает javascript: и пустые схемы', async () => {
    const id = await mkLayout()
    for (const url of ['javascript:alert(1)', 'ftp://example.com', 'без схемы']) {
      const res = await app.request(`/api/admin/menu-layouts/${id}/qr`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ url }),
      })
      expect(res.status).toBe(400)
    }
  })
})

describe('P3-4: дата цен', () => {
  it('подставляет дату в формате dd.MM.yyyy', () => {
    const now = new Date(2026, 10, 11, 15, 0, 0).getTime()
    expect(fillPrintDate(`цены на ${PRINT_DATE_TOKEN}`, now)).toBe('цены на 11.11.2026')
  })

  it('текст без токена не трогает', () => {
    expect(fillPrintDate('свежая обжарка')).toBe('свежая обжарка')
    expect(fillPrintDate(null)).toBeNull()
  })

  it('в собранном документе дата уже подставлена, а в блоке остаётся токен', async () => {
    const id = await mkLayout()
    const doc = {
      pages: [
        {
          id: 'p1',
          blocks: [
            { id: 't1', type: 'text', xPct: 0, yPct: 0, wPct: 60, hPct: 6, text: 'цены на {{date}}', fontSizePt: 8, zIndex: 0, sortOrder: 0 },
          ],
        },
      ],
    }
    await app.request(`/api/admin/menu-layouts/${id}`, { method: 'PUT', headers: H, body: JSON.stringify({ doc }) })

    const view = (await (await app.request(`/api/admin/menu-layouts/${id}`, { headers: H })).json()) as {
      layout: { doc: { pages: { blocks: { text?: string }[] }[] } }
    }
    const text = view.layout.doc.pages[0]!.blocks[0]!.text ?? ''
    expect(text).toMatch(/^цены на \d{2}\.\d{2}\.\d{4}$/)
    expect(text).not.toContain('{{date}}')
  })
})
