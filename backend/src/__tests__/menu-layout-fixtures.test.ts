/**
 * Базовая линия аудита «Редактор меню 6.7» (этап 0): фикстуры трёх реальных макетов
 * и общая геометрия листа (этап 1.1).
 *
 * Фикстуры держат формат `doc_json` в трёх состояниях: пустой лист, старый flow-макет
 * без координат и большой холст на 120 блоков. Тесты проверяют, что нормализация и
 * миграция их не ломают, а блоки остаются внутри безопасной области.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-menu-layout-fixtures-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { normalizeDoc, migrateDocToCanvas, collectBlockers, resolveDoc, formatMetrics } = await import('../modules/admin/menuLayoutDoc')
const { SHEET_SAFE, contentBox, placeBlock, footerBaselineY } = await import('../modules/admin/sheetGeometry')

const H = { 'X-Admin-Token': 'test-admin', 'content-type': 'application/json' }
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'))

beforeEach(() => {
  db.prepare('DELETE FROM menu_layouts').run()
})

describe('этап 0: фикстуры макетов', () => {
  it('пустой лист остаётся пустым', () => {
    const doc = migrateDocToCanvas(normalizeDoc(fixture('menu-layout-empty.json')))
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0]!.blocks).toHaveLength(0)
    expect(collectBlockers(resolveDoc(doc, 'live'))).toEqual([])
  })

  it('старый flow-макет мигрирует в координаты без потерь', () => {
    const raw = fixture('menu-layout-legacy-flow.json')
    const doc = migrateDocToCanvas(normalizeDoc(raw))
    const blocks = doc.pages[0]!.blocks
    // миграция может добавить блок (hero → kicker + заголовок), но не теряет ни одного исходного
    expect(blocks.length).toBeGreaterThanOrEqual(raw.pages[0].blocks.length)
    for (const b of raw.pages[0].blocks) expect(blocks.some((x) => x.id === b.id)).toBe(true)
    for (const b of blocks) {
      expect(Number.isFinite(b.xPct)).toBe(true)
      expect(Number.isFinite(b.yPct)).toBe(true)
      expect(b.xPct + b.wPct).toBeLessThanOrEqual(100.001)
      expect(b.yPct + b.hPct).toBeLessThanOrEqual(100.001)
    }
    // header → logo, hero → text, note → text
    expect(blocks.find((b) => b.id === 'h1')!.type).toBe('logo')
    expect(blocks.find((b) => b.id === 'hero1')!.type).toBe('text')
    expect(blocks.find((b) => b.id === 'note1')!.type).toBe('text')
    // повторная миграция ничего не двигает
    const again = migrateDocToCanvas(doc)
    expect(again.pages[0]!.blocks.map((b) => [b.xPct, b.yPct])).toEqual(blocks.map((b) => [b.xPct, b.yPct]))
  })

  it('большой макет на 120 блоков нормализуется и не выходит за лист', () => {
    const raw = fixture('menu-layout-120-blocks.json')
    const doc = migrateDocToCanvas(normalizeDoc(raw))
    const blocks = doc.pages[0]!.blocks
    expect(blocks).toHaveLength(120)
    expect(blocks.every((b) => b.wPct >= 6 && b.hPct >= 2)).toBe(true)
    expect(blocks.every((b) => b.xPct + b.wPct <= 100.001 && b.yPct + b.hPct <= 100.001)).toBe(true)
  })

  it('старый макет из БД отдаётся уже в координатах (миграция на чтении)', async () => {
    const raw = fixture('menu-layout-legacy-flow.json')
    const now = Date.now()
    const info = db
      .prepare(
        `INSERT INTO menu_layouts(title, format, status, theme_json, doc_json, price_mode, frozen_at, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run('Старый макет', 'a4_portrait', 'draft', '{}', JSON.stringify(raw), 'live', null, now, now)
    const id = Number(info.lastInsertRowid)

    const got = await app.request(`/api/admin/menu-layouts/${id}`, { headers: H })
    expect(got.status).toBe(200)
    const body = (await got.json()) as {
      layout: { doc: { pages: { blocks: { id: string; xPct: number; yPct: number }[] }[] } }
    }
    const blocks = body.layout.doc.pages[0]!.blocks
    expect(blocks.every((b) => Number.isFinite(b.xPct) && Number.isFinite(b.yPct))).toBe(true)
    expect(blocks.map((b) => b.id)).toContain('c1')

    // и он же сохраняется обратно без ошибок валидации
    const put = await app.request(`/api/admin/menu-layouts/${id}`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ doc: body.layout.doc }),
    })
    expect(put.status).toBe(200)
  })
})

describe('этап 1.1: единая геометрия листа', () => {
  it('безопасная область — доли ширины, одинаковые для всех форматов', () => {
    const a4 = formatMetrics('a4_portrait')
    const box = contentBox(a4.width, a4.height)
    expect(box.x).toBeCloseTo(a4.width * SHEET_SAFE.x, 5)
    expect(box.y).toBeCloseTo(a4.width * SHEET_SAFE.top, 5)
    expect(box.w).toBeCloseTo(a4.width * (1 - 2 * SHEET_SAFE.x), 5)
    expect(box.h).toBeCloseTo(a4.height - a4.width * (SHEET_SAFE.top + SHEET_SAFE.bottom), 5)

    const a3 = formatMetrics('a3_portrait')
    const wide = formatMetrics('screen_16_9')
    for (const m of [a3, wide]) {
      const b = contentBox(m.width, m.height)
      expect(b.x / m.width).toBeCloseTo(SHEET_SAFE.x, 6)
      expect(b.w / m.width).toBeCloseTo(1 - 2 * SHEET_SAFE.x, 6)
    }
  })

  it('блок в координатах % попадает туда же относительно листа, что и в CSS', () => {
    const m = formatMetrics('a4_portrait')
    const box = contentBox(m.width, m.height)
    const rect = placeBlock(box, { xPct: 0, yPct: 0, wPct: 50, hPct: 10 })
    // левый край — ровно на поле, а не на обрезе
    expect(rect.x).toBeCloseTo(m.width * SHEET_SAFE.x, 5)
    expect(rect.x).toBeGreaterThan(0)
    // ширина — половина безопасной области
    expect(rect.w).toBeCloseTo(box.w / 2, 5)
    // доля от листа совпадает с тем, что показывает холст (проценты от безопасной области)
    expect((rect.x + rect.w) / m.width).toBeCloseTo(SHEET_SAFE.x + ((1 - 2 * SHEET_SAFE.x) * 50) / 100, 6)
  })

  it('bleed сжимает безопасную область и сдвигает только её', () => {
    const m = formatMetrics('a4_portrait')
    const plain = contentBox(m.width, m.height)
    const withBleed = contentBox(m.width, m.height, 3)
    expect(withBleed.x).toBeCloseTo(plain.x + 3, 5)
    expect(withBleed.w).toBeCloseTo(plain.w - 6, 5)
    expect(withBleed.h).toBeCloseTo(plain.h - 6, 5)
  })

  it('подвал сидит внутри нижнего поля', () => {
    const m = formatMetrics('a4_portrait')
    const y = footerBaselineY(m.height, m.width)
    const bottomMargin = m.width * SHEET_SAFE.bottom
    // подвал ниже безопасной области, но на листе
    expect(y).toBeGreaterThan(m.height - bottomMargin)
    expect(y).toBeLessThan(m.height)
  })
})

describe('этап 1.1: превью = PDF', () => {
  /** Достаёт из PDF первое текстовое смещение (левая нижняя точка первой строки). */
  const textOrigins = (buf: Buffer): { x: number; y: number }[] => {
    const zlib = require('node:zlib') as typeof import('node:zlib')
    const raw = buf.toString('latin1')
    const out: { x: number; y: number }[] = []
    for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
      let body: Buffer
      try {
        body = zlib.inflateSync(Buffer.from(m[1]!, 'latin1'))
      } catch {
        continue
      }
      const text = body.toString('latin1')
      // PDFKit пишет позицию и матрицей `a b c d e f Tm`, и сдвигом `e f Td`.
      for (const t of text.matchAll(/([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) Tm/g)) {
        out.push({ x: Number(t[5]), y: Number(t[6]) })
      }
      for (const t of text.matchAll(/([\d.-]+) ([\d.-]+) Td/g)) out.push({ x: Number(t[1]), y: Number(t[2]) })
    }
    return out
  }

  const positionsOf = async (format: string, blocks: Record<string, unknown>[]) => {
    const created = await app.request('/api/admin/menu-layouts', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ title: 'Позиции', format }),
    })
    const { layout } = (await created.json()) as { layout: { id: number } }
    const put = await app.request(`/api/admin/menu-layouts/${layout.id}`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ doc: { pages: [{ id: 'page-1', blocks }] } }),
    })
    expect(put.status).toBe(200)
    const res = await app.request(`/api/admin/menu-layouts/${layout.id}/export.pdf?preset=screen&bleed=0&force=1`, {
      headers: H,
    })
    expect(res.status).toBe(200)
    return { pdf: Buffer.from(await res.arrayBuffer()), metrics: formatMetrics(format) }
  }

  it('блок x=0 стоит на поле, а не на обрезе — как в редакторе', async () => {
    const { pdf, metrics } = await positionsOf('a4_portrait', [
      { id: 't-left', type: 'text', text: 'Слева', xPct: 0, yPct: 0, wPct: 40, hPct: 8, fontSizePt: 12, sortOrder: 0 },
      { id: 't-quarter', type: 'text', text: 'Четверть', xPct: 25, yPct: 20, wPct: 40, hPct: 8, fontSizePt: 12, sortOrder: 1 },
    ])
    const box = contentBox(metrics.width, metrics.height)
    const xs = textOrigins(pdf).map((p) => p.x).filter((x) => x > 1)
    expect(xs.length).toBeGreaterThan(0)
    const near = (target: number, tol = 1.5) => xs.some((x) => Math.abs(x - target) < tol)
    expect(near(box.x), 'блок x=0 на границе безопасной области').toBe(true)
    expect(near(box.x + box.w * 0.25), 'блок x=25 % смещён внутрь').toBe(true)
    // ничего не начинается левее безопасной области — то есть не на обрезе
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(box.x - 1)
    expect(box.x).toBeGreaterThan(metrics.width * 0.04)
  })

  it('сдвиг по x/y в процентах даёт те же доли листа на A4 и A3', async () => {
    const block = (id: string, x: number, y: number) => ({
      id,
      type: 'text',
      text: id,
      xPct: x,
      yPct: y,
      wPct: 30,
      hPct: 8,
      fontSizePt: 12,
      sortOrder: 0,
    })
    for (const format of ['a4_portrait', 'a3_portrait', 'screen_16_9']) {
      const { pdf, metrics } = await positionsOf(format, [block('a', 0, 0), block('b', 50, 50)])
      const box = contentBox(metrics.width, metrics.height)
      const origins = textOrigins(pdf)
      const near = (target: number, tol: number) => origins.some((p) => Math.abs(p.x - target) < tol)
      expect(near(box.x, 2), `${format}: левый блок`).toBe(true)
      expect(near(box.x + box.w / 2, 2), `${format}: блок в середине`).toBe(true)
    }
  })

  it('вёрстка не меняется от bleed для screen-пресета', async () => {
    const { pdf, metrics } = await positionsOf('a4_portrait', [
      { id: 't', type: 'text', text: 'Т', xPct: 10, yPct: 10, wPct: 30, hPct: 8, fontSizePt: 12, sortOrder: 0 },
    ])
    const box = contentBox(metrics.width, metrics.height)
    const xs = textOrigins(pdf).map((p) => p.x).filter((x) => x > 1)
    expect(xs.some((x) => Math.abs(x - (box.x + box.w * 0.1)) < 1.5)).toBe(true)
  })
})

describe('этап 1.5: картинки только из uploads', () => {
  const mkLayout = async () => {
    const created = await app.request('/api/admin/menu-layouts', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ title: 'Фото' }),
    })
    const { layout } = (await created.json()) as { layout: { id: number } }
    return layout.id
  }

  it('внешняя ссылка не проходит валидацию', async () => {
    const id = await mkLayout()
    const res = await app.request(`/api/admin/menu-layouts/${id}`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({
        doc: {
          pages: [
            {
              id: 'page-1',
              blocks: [{ id: 'img', type: 'image', url: 'https://evil.example/x.png', xPct: 0, yPct: 0, wPct: 20, hPct: 20 }],
            },
          ],
        },
      }),
    })
    expect(res.status).toBe(400)
  })

  it('старый макет с внешним URL чистится, а пропавший файл даёт блокер image_unreadable', async () => {
    const id = await mkLayout()
    const now = Date.now()
    db.prepare(
      `UPDATE menu_layouts SET doc_json=?, updated_at=? WHERE id=?`,
    ).run(
      JSON.stringify({
        pages: [
          {
            id: 'page-1',
            blocks: [
              { id: 'ext', type: 'image', url: 'https://evil.example/x.png', xPct: 0, yPct: 0, wPct: 20, hPct: 20, zIndex: 0, sortOrder: 0 },
              { id: 'gone', type: 'image', url: '/uploads/missing-file.png', xPct: 30, yPct: 0, wPct: 20, hPct: 20, zIndex: 1, sortOrder: 1 },
            ],
          },
        ],
      }),
      now,
      id,
    )
    const got = await app.request(`/api/admin/menu-layouts/${id}`, { headers: H })
    const body = (await got.json()) as {
      layout: {
        doc: { pages: { blocks: { id: string; url: string | null; imageMissing?: boolean }[] }[] }
        blockers: { blockId: string; code: string }[]
      }
    }
    const blocks = body.layout.doc.pages[0]!.blocks
    // внешняя ссылка не сохраняется в документе
    expect(blocks.find((b) => b.id === 'ext')!.url).toBeNull()
    // а отсутствующий файл — блокер печати
    expect(blocks.find((b) => b.id === 'gone')!.imageMissing).toBe(true)
    expect(body.layout.blockers.some((b) => b.blockId === 'gone' && b.code === 'image_unreadable')).toBe(true)
  })
})

describe('этап 1.4: версии и конфликты', () => {
  const mkLayout = async () => {
    const created = await app.request('/api/admin/menu-layouts', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ title: 'Версии' }),
    })
    const { layout } = (await created.json()) as { layout: { id: number; rev: number } }
    return layout
  }

  it('rev растёт на каждом сохранении', async () => {
    const layout = await mkLayout()
    expect(layout.rev).toBe(1)
    const put = await app.request(`/api/admin/menu-layouts/${layout.id}`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ title: 'Версии 2', baseRev: 1 }),
    })
    expect(put.status).toBe(200)
    const body = (await put.json()) as { layout: { rev: number } }
    expect(body.layout.rev).toBe(2)
  })

  it('устаревший baseRev даёт 409 rev_conflict с актуальным документом', async () => {
    const layout = await mkLayout()
    await app.request(`/api/admin/menu-layouts/${layout.id}`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ title: 'Правка с десктопа', baseRev: 1 }),
    })
    const stale = await app.request(`/api/admin/menu-layouts/${layout.id}`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ title: 'Правка с телефона', baseRev: 1 }),
    })
    expect(stale.status).toBe(409)
    const body = (await stale.json()) as { error: string; rev: number; layout: { title: string; rev: number } }
    expect(body.error).toBe('rev_conflict')
    expect(body.rev).toBe(2)
    // клиенту возвращается актуальная версия, чтобы он мог показать разницу
    expect(body.layout.title).toBe('Правка с десктопа')
    expect(body.layout.rev).toBe(2)
  })

  it('без baseRev сохранение разрешено (старые клиенты) и тоже поднимает rev', async () => {
    const layout = await mkLayout()
    const res = await app.request(`/api/admin/menu-layouts/${layout.id}`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ title: 'Без версии' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { layout: { rev: number } }
    expect(body.layout.rev).toBe(2)
  })
})
