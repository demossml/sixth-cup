/**
 * P3-3: проверка печатаемости — dpi фото и контраст текста.
 * Кегль < 7 pt проверяется в resolveDoc, здесь — то, что видно только на бумаге.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

const dir = mkdtempSync(join(tmpdir(), 'sc-print-checks-'))
const uploads = join(dir, 'uploads')
mkdirSync(uploads, { recursive: true })
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = uploads
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { parseImageSize, uploadsImageSize, contrastRatio, clearImageSizeCache, printChecks, MIN_PRINT_DPI } = await import(
  '../modules/admin/printChecks'
)
const { DEFAULT_THEME, formatMetrics } = await import('../modules/admin/menuLayoutDoc')

/** Минимальный PNG нужного размера: только заголовок IHDR и пустой IDAT. */
function png(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0)
  ihdr.write('IHDR', 4, 'ascii')
  ihdr.writeUInt32BE(width, 8)
  ihdr.writeUInt32BE(height, 12)
  ihdr[16] = 8 // bit depth
  ihdr[17] = 6 // RGBA
  const idat = deflateSync(Buffer.alloc(4))
  const idatChunk = Buffer.alloc(idat.length + 12)
  idatChunk.writeUInt32BE(idat.length, 0)
  idatChunk.write('IDAT', 4, 'ascii')
  idat.copy(idatChunk, 8)
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
  return Buffer.concat([sig, ihdr, idatChunk, iend])
}

beforeEach(() => clearImageSizeCache())

describe('P3-3: размеры картинки из заголовка файла', () => {
  it('читает PNG', () => {
    expect(parseImageSize(png(800, 600))).toEqual({ w: 800, h: 600 })
  })

  it('читает JPEG по маркеру кадра', () => {
    const buf = Buffer.from([
      0xff, 0xd8, // SOI
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0 длиной 4
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, // SOF0: h=600, w=800
      0x00,
    ])
    expect(parseImageSize(buf)).toEqual({ w: 800, h: 600 })
  })

  it('не падает на мусоре и пустом файле', () => {
    expect(parseImageSize(Buffer.from('not an image'))).toBeNull()
    expect(parseImageSize(Buffer.alloc(0))).toBeNull()
  })

  it('читает размер из uploads и кэширует', () => {
    writeFileSync(join(uploads, 'tiny.png'), png(40, 40))
    expect(uploadsImageSize('/uploads/tiny.png')).toEqual({ w: 40, h: 40 })
    clearImageSizeCache()
    expect(uploadsImageSize('/uploads/missing.png')).toBeNull()
    expect(uploadsImageSize('https://example.com/a.png')).toBeNull()
  })
})

describe('P3-3: контраст', () => {
  it('считает по WCAG', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21)
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBe(1)
  })
})

const block = (over: Record<string, unknown>) => ({
  id: 'b1',
  type: 'image',
  xPct: 0,
  yPct: 0,
  wPct: 50,
  hPct: 10,
  fontSizePt: 12,
  bold: false,
  fit: 'cover',
  url: null,
  showPhoto: false,
  displayImageUrl: null,
  warnings: [],
  ...over,
})

const doc = (blocks: unknown[]) =>
  ({ pages: [{ id: 'p1', blocks }], schemaVersion: 1 }) as unknown as Parameters<typeof printChecks>[0]

describe('P3-3: проверки листа', () => {
  it('маленькое фото даёт замечание с dpi', () => {
    writeFileSync(join(uploads, 'small.png'), png(40, 40))
    const out = printChecks(doc([block({ url: '/uploads/small.png' })]), DEFAULT_THEME, 'a4_portrait')
    const dpi = out.find((b) => b.code === 'low_dpi')
    expect(dpi).toBeTruthy()
    expect(dpi!.blockId).toBe('b1')
    expect(dpi!.text).toContain(`меньше ${MIN_PRINT_DPI}`)
  })

  it('фото достаточной плотности проходит молча', () => {
    // A4 шириной 210 мм: половина листа — 105 мм. 2000 px на 105 мм ≈ 484 dpi.
    writeFileSync(join(uploads, 'big.png'), png(2000, 2000))
    const out = printChecks(doc([block({ url: '/uploads/big.png' })]), DEFAULT_THEME, 'a4_portrait')
    expect(out.filter((b) => b.code === 'low_dpi')).toHaveLength(0)
  })

  it('низкий контраст текста ловится, нормальный — нет', () => {
    const text = block({ id: 't1', type: 'text', fontSizePt: 12 })
    const bad = printChecks(doc([text]), { ...DEFAULT_THEME, bg: '#F4EFE6', text: '#F1EADF' }, 'a4_portrait')
    expect(bad.find((b) => b.code === 'low_contrast')?.blockId).toBe('t1')

    const good = printChecks(doc([text]), { ...DEFAULT_THEME, bg: '#FFFFFF', text: '#111111' }, 'a4_portrait')
    expect(good.filter((b) => b.code === 'low_contrast')).toHaveLength(0)
  })

  it('для крупного текста порог ниже', () => {
    // 4:1 проходит для крупного (≥ 18 pt), но не для мелкого: AA требует 4,5.
    const theme = { ...DEFAULT_THEME, bg: '#FFFFFF', text: '#7F7F7F' }
    const small = printChecks(doc([block({ id: 's', type: 'text', fontSizePt: 12 })]), theme, 'a4_portrait')
    const large = printChecks(doc([block({ id: 'l', type: 'text', fontSizePt: 22 })]), theme, 'a4_portrait')
    expect(small.some((b) => b.code === 'low_contrast')).toBe(true)
    expect(large.some((b) => b.code === 'low_contrast')).toBe(false)
  })

  it('фон градиента учитывается сверху листа', () => {
    const text = block({ id: 'g', type: 'text', fontSizePt: 12 })
    // Текст светлый: на светлом градиенте он теряется, на тёмном — читается.
    const lightTop = { ...DEFAULT_THEME, bg: '#000000', text: '#F2F2F2', gradient: { from: '#FFFFFF', to: '#000000', angle: 0 } }
    const darkTop = { ...DEFAULT_THEME, bg: '#FFFFFF', text: '#F2F2F2', gradient: { from: '#111111', to: '#FFFFFF', angle: 0 } }
    expect(printChecks(doc([text]), lightTop, 'a4_portrait').some((b) => b.code === 'low_contrast')).toBe(true)
    expect(printChecks(doc([text]), darkTop, 'a4_portrait').some((b) => b.code === 'low_contrast')).toBe(false)
  })

  it('формат влияет на dpi: на большем листе тот же блок реже', () => {
    writeFileSync(join(uploads, 'mid.png'), png(30, 30))
    const a4 = printChecks(doc([block({ url: '/uploads/mid.png' })]), DEFAULT_THEME, 'a4_portrait')
    const a3 = printChecks(doc([block({ url: '/uploads/mid.png' })]), DEFAULT_THEME, 'a3_portrait')
    const dpiOf = (list: { code: string; text: string }[]) => Number((list.find((b) => b.code === 'low_dpi')?.text ?? '0').match(/\d+/)?.[0] ?? 0)
    // На A3 тот же блок физически крупнее — плотность ниже.
    expect(dpiOf(a3)).toBeLessThan(dpiOf(a4))
    expect(formatMetrics('a3_portrait').width).toBeGreaterThan(formatMetrics('a4_portrait').width)
  })
})
