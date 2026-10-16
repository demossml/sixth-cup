/**
 * One-shot: re-encode existing product images to 480/960 WebP and update products.image_url.
 *
 *   cd backend && npx tsx scripts/reprocess-product-images.ts
 *
 * Safe to re-run: skips keys that already end with -480.webp when file exists.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '../src/db'
import { config } from '../src/config'
import { processProductImage } from '../src/lib/productImage'

function basenameFromUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const path = url.startsWith('http') ? new URL(url).pathname : url
    const m = path.match(/\/(?:uploads|api\/devices\/images)\/([a-zA-Z0-9._-]+)$/)
    return m?.[1] ?? null
  } catch {
    return null
  }
}

async function main() {
  const base = (config.publicBaseUrl || 'https://app.67coffee.ru').replace(/\/+$/, '')
  const rows = db.prepare(`SELECT id, image_url AS imageUrl FROM products WHERE image_url IS NOT NULL AND image_url != ''`).all() as {
    id: number
    imageUrl: string
  }[]

  let ok = 0
  let skip = 0
  let fail = 0

  for (const row of rows) {
    const key = basenameFromUrl(row.imageUrl)
    if (!key) {
      console.warn('skip id', row.id, 'no key', row.imageUrl)
      skip++
      continue
    }
    if (key.endsWith('-480.webp')) {
      const p = join(config.uploadsDir, key)
      if (existsSync(p)) {
        skip++
        continue
      }
    }

    // Prefer file on disk named as in URL; else try raw listing match
    let srcPath = join(config.uploadsDir, key)
    if (!existsSync(srcPath)) {
      console.warn('missing file', srcPath, 'id', row.id)
      fail++
      continue
    }

    try {
      const input = readFileSync(srcPath)
      const idPrefix = `${row.id}-${Date.now().toString(36)}`
      const processed = await processProductImage(input, config.uploadsDir, idPrefix)
      const newUrl = `${base}/uploads/${processed.thumbKey}`
      db.prepare(`UPDATE products SET image_url = ? WHERE id = ?`).run(newUrl, row.id)
      console.log('id', row.id, key, '→', processed.thumbKey, `${processed.thumbBytes}B`)
      ok++
    } catch (e) {
      console.error('fail id', row.id, e)
      fail++
    }
  }

  // Also process orphan files in uploads that look like photos but are not -480
  console.log(JSON.stringify({ ok, skip, fail, dir: config.uploadsDir }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
