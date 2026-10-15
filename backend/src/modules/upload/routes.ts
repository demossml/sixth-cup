import { randomBytes } from 'node:crypto'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { config } from '../../config'
import { bad } from '../../lib/errors'

const ALLOWED = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
])

const adminAuth = createMiddleware(async (c, next) => {
  if (c.req.header('X-Admin-Token') !== config.adminToken) throw bad('Forbidden', 403)
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
