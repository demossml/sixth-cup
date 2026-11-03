/**
 * Иконки и favicon из единственного мастера — `public/logo-mark.png`
 * (синий маскот с сердцем «6.7 COFFEE», прозрачный фон).
 *
 *   npm run icons -w frontend
 *
 * Бренд-правило: между 6 и 7 — **квадратная** точка (■), а не круглая «.».
 * Она уже нарисована в мастере (квадрат 7×7 на базовой линии цифр), поэтому здесь
 * ничего не дорисовывается — только масштабирование.
 *
 * Размеры:
 *  • 192/512 — весь маскот на белом (launcher, apple-touch, manifest);
 *  • 48/64   — кроп сердца с «6■7 COFFEE»;
 *  • 16/32   — плотный кроп только «6■7»: на 16 px надпись с COFFEE физически
 *              не читается, а квадрат должен читаться, поэтому кадрируем по цифрам.
 */
import sharp from 'sharp'

const MASTER = 'public/logo-mark.png'
/** Маскот занимает 80% квадрата — безопасная зона для maskable-иконок. */
const FILL = 0.8
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }
/** Цвет сердца под цифрами — фон для кропов. */
const HEART = { r: 25, g: 186, b: 211, alpha: 1 }

/** Кропы в координатах мастера 512×512 (см. docs/brand/README.md). */
const MICRO = { left: 218, top: 275, width: 94, height: 94 } // «6■7»
const COMPACT = { left: 205, top: 272, width: 120, height: 120 } // «6■7» + COFFEE

/** Весь маскот по центру на белом фоне. */
async function fullIcon(size, fill = FILL) {
  const inner = Math.round(size * fill)
  const mascot = await sharp(MASTER).resize(inner, inner, { fit: 'inside' }).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: mascot, gravity: 'center' }])
    .png()
}

/** Кроп надписи на сердце — чтобы квадратная точка читалась на мелких размерах. */
async function cropIcon(size, region) {
  const patch = await sharp(MASTER).extract(region).resize(size, size, { fit: 'fill' }).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: HEART } })
    .composite([{ input: patch, gravity: 'center' }])
    .png()
}

for (const size of [192, 512]) {
  await (await fullIcon(size)).toFile(`public/icon-${size}.png`)
}
await (await cropIcon(16, MICRO)).toFile('public/favicon-16.png')
await (await cropIcon(32, MICRO)).toFile('public/favicon-32.png')
await (await cropIcon(48, COMPACT)).toFile('public/favicon-48.png')
await (await cropIcon(64, COMPACT)).toFile('public/favicon-64.png')

console.log('icons ready: icon-192/512, favicon-16/32/48/64 (source: logo-mark.png, квадратная точка в «6■7»)')
