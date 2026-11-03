/**
 * Иконки PWA из единственного мастера — `public/logo-mark.png`
 * (синий маскот с сердцем «6.7 COFFEE», прозрачный фон).
 *
 *   npm run icons -w frontend
 *
 * Раньше скрипт собирал иконки из `public/icon.svg` со старым силуэтом ламы.
 * Теперь мастер — растр, поэтому исходник только один: `logo-mark.png`.
 * Мастер получен из JPEG владельца (`docs/brand/67-logo-source.jpg`): фон вырезан
 * заливкой от краёв, поэтому белые буквы на сердце и морда остались непрозрачными.
 */
import sharp from 'sharp'

const MASTER = 'public/logo-mark.png'
/** Маскот занимает 80% квадрата — безопасная зона для maskable-иконок. */
const FILL = 0.8
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }

/** Иконка: маскот по центру на белом непрозрачном фоне. */
async function icon(size, fill = FILL) {
  const inner = Math.round(size * fill)
  const mascot = await sharp(MASTER).resize(inner, inner, { fit: 'inside' }).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: mascot, gravity: 'center' }])
    .png()
}

for (const size of [192, 512]) {
  await (await icon(size)).toFile(`public/icon-${size}.png`)
}

// favicon: тот же маскот чуть крупнее — на 32 px отступы съедают детали
for (const size of [32, 64]) {
  await (await icon(size, 0.88)).toFile(`public/favicon-${size}.png`)
}

console.log('icons ready: icon-192, icon-512, favicon-32, favicon-64 (source: logo-mark.png)')
