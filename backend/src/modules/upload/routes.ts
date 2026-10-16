import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { config } from '../../config'
import { db } from '../../db'
import { bad } from '../../lib/errors'

const ALLOWED = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
])

function safeEq(given: string, expected: string): boolean {
  if (!expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Same table as auth/routes — failed admin token attempts per IP. */
function hitRate(key: string, max: number, windowMs: number) {
  const now = Date.now()
  const row = db.prepare('SELECT count, window_start FROM rate_limits WHERE key=?')
    .get(key) as { count: number; window_start: number } | undefined
  if (!row || now - row.window_start > windowMs) {
    db.prepare('INSERT OR REPLACE INTO rate_limits(key, count, window_start) VALUES(?,?,?)').run(key, 1, now)
    return
  }
  if (row.count >= max) throw bad('Слишком много запросов. Попробуйте позже.', 429)
  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key=?').run(key)
}

function clientIp(c: { req: { header: (n: string) => string | undefined } }): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || 'unknown'
}

const adminAuth = createMiddleware(async (c, next) => {
  const given = c.req.header('X-Admin-Token') ?? ''
  if (!safeEq(given, config.adminToken)) {
    hitRate(`admin-ip:${clientIp(c)}`, 30, 15 * 60_000)
    throw bad('Forbidden', 403)
  }
  await next()
})

/**
 * POST /api/admin/upload  multipart field "file"
 * Returns { url, key } where url is public path /uploads/<file>
 */
export const uploadRoutes = new Hono()
  .use('*', adminAuth)
  .post('/', async (c) => {
    mkdirSync(config.uploadsDir, { recursive: true })
    const body = await c.req.parseBody({ all: true })
    const file = body['file']
    if (!file || typeof file === 'string') throw bad('file required', 400)

    const f = file as File
    const mime = f.type || 'application/octet-stream'
    const ext = ALLOWED.get(mime)
    if (!ext) throw bad('Разрешены JPG, PNG, WebP, MP4 и WebM', 400)
    const isVideo = mime.startsWith('video/')
    const maxBytes = isVideo ? 20 * 1024 * 1024 : config.maxUploadBytes
    if (f.size > maxBytes) throw bad(isVideo ? 'Видео слишком большое (максимум 20 МБ)' : 'Фото слишком большое (максимум 2 МБ)', 400)

    const key = `${Date.now()}-${randomBytes(8).toString('hex')}${ext}`
    const dest = join(config.uploadsDir, key)
    const buf = Buffer.from(await f.arrayBuffer())
    await pipeline(Readable.from(buf), createWriteStream(dest))

    const path = `/uploads/${key}`
    const base = (config.publicBaseUrl || '').replace(/\/+$/, '')
    const url = base ? `${base}${path}` : path
    return c.json({ url, key, path })
  })
