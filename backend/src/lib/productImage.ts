/**
 * Resize product photos for Evotor cashier (weak CPU/GPU).
 * Thumb: max edge 480 WebP — used as product image_url / catalog imageUrl.
 * Full:  max edge 960 WebP — optional, admin/PWA detail if needed later.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

export const THUMB_MAX_PX = 480
export const FULL_MAX_PX = 960
export const WEBP_QUALITY = 75

export type ProcessedProductImage = {
  /** Filename in uploadsDir, e.g. 1733-ab12-480.webp */
  thumbKey: string
  fullKey: string
  thumbBytes: number
  fullBytes: number
}

export async function processProductImage(
  input: Buffer,
  uploadsDir: string,
  idPrefix: string,
): Promise<ProcessedProductImage> {
  const base = sharp(input, { failOn: 'none' }).rotate() // honour EXIF
  const meta = await base.metadata()
  if (!meta.width || !meta.height) {
    throw new Error('invalid_image')
  }

  const thumbKey = `${idPrefix}-480.webp`
  const fullKey = `${idPrefix}-960.webp`

  const thumbBuf = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize({
      width: THUMB_MAX_PX,
      height: THUMB_MAX_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toBuffer()

  const fullBuf = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize({
      width: FULL_MAX_PX,
      height: FULL_MAX_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toBuffer()

  writeFileSync(join(uploadsDir, thumbKey), thumbBuf)
  writeFileSync(join(uploadsDir, fullKey), fullBuf)

  return {
    thumbKey,
    fullKey,
    thumbBytes: thumbBuf.length,
    fullBytes: fullBuf.length,
  }
}
