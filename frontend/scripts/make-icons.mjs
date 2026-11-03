/**
 * Иконки и favicon из единственного мастера — `public/logo-mark.png`
 * (синий маскот с сердцем «6.7 COFFEE», прозрачный фон).
 *
 *   npm run icons -w frontend
 *
 * Бренд-правило: между 6 и 7 — **квадратная** точка (■), не круглая «.».
 * В мастере она уже нарисована квадратом 7×7 на базовой линии. Здесь мы дополнительно
 * перерисовываем её жёстким квадратом ПОСЛЕ масштабирования: при уменьшении LANCZOS
 * смазывал углы (3×4, fill 0.85), из-за чего на 16–48 px точка выглядела круглой.
 *
 * Размеры:
 *  • 192/512 — весь маскот на белом (launcher, apple-touch, manifest);
 *  • 48/64   — кроп сердца с «6■7 COFFEE»;
 *  • 16/32   — плотный кроп только «6■7»: с COFFEE на 16 px надпись субпиксельна.
 */
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'

const MASTER = 'public/logo-mark.png'
const OUT_DIRS = ['public', '../frontend-admin/public'] // клиент + админка

/** Маскот занимает 80% квадрата — безопасная зона для maskable-иконок. */
const FILL = 0.8
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }
/** Цвет сердца под цифрами — фон для кропов. */
const HEART = { r: 25, g: 186, b: 211, alpha: 1 }
/** Цвет цифр в мастере (совпадает с нарисованной точкой). */
const DIGIT = { r: 241, g: 245, b: 248, alpha: 1 }

/** Кропы в координатах мастера 512×512 (см. docs/brand/README.md). */
const MICRO = { left: 218, top: 275, width: 94, height: 94 } // «6■7»
const COMPACT = { left: 205, top: 272, width: 120, height: 120 } // «6■7» + COFFEE

/** Точка в мастере: bbox измерен по альфе (8×8, fill 1.0). */
const DOT = { x0: 263, x1: 270, y1: 346 }

/**
 * Жёсткий квадрат точки на готовой картинке.
 * `scale` — во сколько раз картинка больше/меньше мастера, `dx/dy` — смещение мастера в ней.
 */
async function stampDot(size, scale, dx, dy) {
  // На мелких размерах точка получается 1 px и визуально исчезает: держим минимум 2 px,
  // это всё ещё квадрат (сторона = высоте), просто чуть плотнее оригинала.
  const minSide = size <= 32 ? 2 : 1
  const side = Math.max(minSide, Math.round((DOT.x1 - DOT.x0 + 1) * scale))
  const left = Math.round(dx + DOT.x0 * scale)
  const top = Math.round(dy + DOT.y1 * scale) - side + 1
  const square = await sharp({
    create: { width: side, height: side, channels: 4, background: DIGIT },
  })
    .png()
    .toBuffer()
  return { input: square, left: Math.max(0, left), top: Math.max(0, top) }
}

/** Весь маскот по центру на белом фоне. */
async function fullIcon(size, fill = FILL) {
  const inner = Math.round(size * fill)
  const offset = (size - inner) / 2
  const scale = inner / 512
  const mascot = await sharp(MASTER).resize(inner, inner, { fit: 'inside' }).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: mascot, left: Math.round(offset), top: Math.round(offset) }, await stampDot(size, scale, offset, offset)])
    .png()
}

/** Кроп надписи на сердце — чтобы квадратная точка читалась на мелких размерах. */
async function cropIcon(size, region) {
  const scale = size / region.width
  const patch = await sharp(MASTER).extract(region).resize(size, size, { fit: 'fill' }).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: HEART } })
    .composite([
      { input: patch, left: 0, top: 0 },
      await stampDot(size, scale, -region.left * scale, -region.top * scale),
    ])
    .png()
}

async function write(name, buffer) {
  for (const dir of OUT_DIRS) {
    await mkdir(dir, { recursive: true })
    await sharp(buffer).toFile(`${dir}/${name}`)
  }
}

await write('icon-192.png', await (await fullIcon(192)).toBuffer())
await write('icon-512.png', await (await fullIcon(512)).toBuffer())
await write('favicon-16.png', await (await cropIcon(16, MICRO)).toBuffer())
await write('favicon-32.png', await (await cropIcon(32, MICRO)).toBuffer())
await write('favicon-48.png', await (await cropIcon(48, COMPACT)).toBuffer())
await write('favicon-64.png', await (await cropIcon(64, COMPACT)).toBuffer())

console.log('icons ready: icon-192/512, favicon-16/32/48/64 → frontend/public + frontend-admin/public')
