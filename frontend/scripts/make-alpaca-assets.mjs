/**
 * Генератор ассетов «Приключений ламы» (SVG → PNG).
 *
 *   npm run alpaca:assets -w frontend      (или: node scripts/make-alpaca-assets.mjs)
 *
 * Пишет:
 *   src/game/alpaca/assets/svg/*.svg   — исходники (редактируются глазами)
 *   src/game/alpaca/assets/*.png       — то, что грузит BootScene
 *
 * Все PNG рисуются в «2x»: 1 мировой пиксель игры = 2 пикселя текстуры
 * (кадр ламы 192×192 показывается как 96×96).
 */
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(here, '../src/game/alpaca/assets')
const SVG_DIR = path.join(OUT, 'svg')
fs.mkdirSync(SVG_DIR, { recursive: true })

// ───────────────────────────── палитра 6.7 Coffee ─────────────────────────────
const C = {
  line: '#4A3828', // мягкий коричневый контур
  wool: '#F8F1E3',
  wool2: '#EADFC9',
  shade: '#D5C6AA',
  hoof: '#5A4535',
  blue: '#002FA7',
  blueDark: '#001F6B',
  blueLight: '#1A4DD6',
  cream: '#F6F3EE',
  gold: '#E2B25C',
  crema: '#C8A26E',
  pink: '#F2B8B0',
  wood: '#C99358',
  woodDark: '#8C5A2B',
  woodLight: '#E3B77C',
}

const f = (n) => Math.round(n * 100) / 100

// ───────────────────────────── геометрия ─────────────────────────────
/** Замкнутая гладкая кривая (Catmull-Rom → Bezier) по набору точек. */
function smoothClosed(pts) {
  const n = pts.length
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`
  }
  return d + 'Z'
}

/** Пушистый овал: радиус «дышит» по синусу — получается шерсть. */
function fluff(cx, cy, rx, ry, bumps = 9, amp = 0.06, phase = 0, n = 36) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    const k = 1 + amp * Math.sin(bumps * t + phase)
    pts.push([cx + Math.cos(t) * rx * k, cy + Math.sin(t) * ry * k])
  }
  return smoothClosed(pts)
}

/** Двузвенная нога: колено считается обратной кинематикой. dir: +1 колено вперёд, -1 назад. */
function legPoints(hx, hy, fx, fy, l1, l2, dir) {
  let dx = fx - hx
  let dy = fy - hy
  let d = Math.hypot(dx, dy)
  const max = l1 + l2 - 0.8
  if (d > max) {
    fx = hx + (dx / d) * max
    fy = hy + (dy / d) * max
    dx = fx - hx
    dy = fy - hy
    d = max
  }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a))
  const mx = hx + (dx * a) / d
  const my = hy + (dy * a) / d
  let px = -dy / d
  let py = dx / d
  if (px * dir < 0) {
    px = -px
    py = -py
  }
  return { hip: [hx, hy], knee: [mx + px * h, my + py * h], foot: [fx, fy] }
}

function leg(lp, fill, w = 10) {
  const { hip, knee, foot } = lp
  const pl = `M${f(hip[0])},${f(hip[1])} L${f(knee[0])},${f(knee[1])} L${f(foot[0])},${f(foot[1])}`
  return `
  <path d="${pl}" fill="none" stroke="${C.line}" stroke-width="${w + 6}" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${pl}" fill="none" stroke="${fill}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>
  <ellipse cx="${f(foot[0] + 2)}" cy="${f(foot[1] - 1)}" rx="8" ry="5" fill="${C.hoof}" stroke="${C.line}" stroke-width="2"/>`
}

// ───────────────────────────── лама ─────────────────────────────
/**
 * pose:
 *  body: [cx, cy, rx, ry], bodyRot
 *  neckBase: [x,y], head: [x,y], headRot
 *  legs: { nf, ff, nb, fb }  — позиции стоп [x,y]; hips: {f:[x,y], b:[x,y]}
 *  tailRot, scarf (амплитуда), eye: 'open'|'x'|'happy', earRot, stars
 */
function alpacaSVG(p) {
  const [bx, by, brx, bry] = p.body
  const hipF = p.hips.f
  const hipB = p.hips.b
  const legs = [
    legPoints(hipB[0], hipB[1], p.legs.fb[0], p.legs.fb[1], 31, 31, -1),
    legPoints(hipF[0], hipF[1], p.legs.ff[0], p.legs.ff[1], 31, 31, 1),
    legPoints(hipB[0], hipB[1], p.legs.nb[0], p.legs.nb[1], 31, 31, -1),
    legPoints(hipF[0], hipF[1], p.legs.nf[0], p.legs.nf[1], 31, 31, 1),
  ]
  const [nx, ny] = p.neckBase
  const [hx, hy] = p.head
  const midx = (nx + hx) / 2 - (p.neckBow ?? 10)
  const midy = (ny + hy) / 2 + 2
  const neck = `M${nx},${ny} Q${f(midx)},${f(midy)} ${hx - 4},${hy + 6}`

  const earRot = p.earRot ?? -22
  const eye =
    p.eye === 'x'
      ? `<path d="M${hx + 0},${hy - 8} l7,7 M${hx + 7},${hy - 8} l-7,7" stroke="${C.line}" stroke-width="2.6" stroke-linecap="round"/>`
      : p.eye === 'happy'
        ? `<path d="M${hx - 1},${hy - 3} q4.5,-6 9,0" fill="none" stroke="${C.line}" stroke-width="2.8" stroke-linecap="round"/>`
        : `<ellipse cx="${hx + 4}" cy="${hy - 4}" rx="3.8" ry="4.4" fill="#24180F"/>
           <circle cx="${hx + 5.4}" cy="${hy - 5.8}" r="1.3" fill="#fff"/>`

  const flap = p.scarf ?? 6
  // хвост шарфа: волнистая лента назад от узла у основания шеи
  const sx = nx + 6
  const sy = ny - 2
  const scarfTail = `M${sx},${sy} C${sx - 14},${sy + flap} ${sx - 28},${sy - flap} ${sx - 44},${sy + flap * 0.6}
    L${sx - 42},${sy + flap * 0.6 + 11} C${sx - 28},${sy - flap + 11} ${sx - 14},${sy + flap + 11} ${sx + 2},${sy + 11} Z`

  const stars = (p.stars ?? [])
    .map(
      ([x, y, s]) =>
        `<path d="M${x},${y - s} L${x + s * 0.3},${y - s * 0.3} L${x + s},${y} L${x + s * 0.3},${y + s * 0.3} L${x},${y + s} L${x - s * 0.3},${y + s * 0.3} L${x - s},${y} L${x - s * 0.3},${y - s * 0.3} Z" fill="${C.gold}" stroke="${C.line}" stroke-width="1.6" stroke-linejoin="round"/>`,
    )
    .join('')

  const tail = p.tail ?? [34, 100, -10]

  return `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
  <!-- тень -->
  ${p.shadow === false ? '' : `<ellipse cx="92" cy="186" rx="${p.shadowRx ?? 52}" ry="5" fill="#000" opacity="0.16"/>`}
  <!-- дальние ноги -->
  ${leg(legs[0], C.shade, 9)}
  ${leg(legs[1], C.shade, 9)}
  <!-- хвост -->
  <g transform="rotate(${tail[2]} ${tail[0] + 6} ${tail[1] + 6})">
    <path d="${fluff(tail[0], tail[1], 13, 9, 6, 0.1, 0.5, 24)}" fill="${C.wool2}" stroke="${C.line}" stroke-width="3" stroke-linejoin="round"/>
  </g>
  <!-- ближние ноги -->
  ${leg(legs[2], C.wool2, 10)}
  ${leg(legs[3], C.wool2, 10)}
  <!-- тело -->
  <g transform="rotate(${p.bodyRot ?? 0} ${bx} ${by})">
    <path d="${fluff(bx, by, brx, bry, 10, 0.055, 0.3, 40)}" fill="${C.wool}" stroke="${C.line}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M${bx - brx * 0.62},${by + bry * 0.55} Q${bx},${by + bry * 0.95} ${bx + brx * 0.62},${by + bry * 0.55}" fill="none" stroke="${C.shade}" stroke-width="5" stroke-linecap="round" opacity="0.8"/>
    <path d="M${bx - brx * 0.4},${by - bry * 0.4} q10,-6 20,0 M${bx + 2},${by - bry * 0.55} q10,-6 20,0" fill="none" stroke="${C.wool2}" stroke-width="3" stroke-linecap="round"/>
  </g>
  <!-- хвост шарфа (сзади шеи) -->
  <path d="${scarfTail}" fill="${C.blueLight}" stroke="${C.line}" stroke-width="2.6" stroke-linejoin="round"/>
  <!-- шея -->
  <path d="${neck}" fill="none" stroke="${C.line}" stroke-width="${(p.neckW ?? 27) + 6}" stroke-linecap="round"/>
  <path d="${neck}" fill="none" stroke="${C.wool}" stroke-width="${p.neckW ?? 27}" stroke-linecap="round"/>
  <!-- ухо дальнее -->
  <g transform="rotate(${earRot - 14} ${hx - 8} ${hy - 10})">
    <ellipse cx="${hx - 8}" cy="${hy - 22}" rx="5.2" ry="13" fill="${C.wool2}" stroke="${C.line}" stroke-width="2.6"/>
  </g>
  <!-- голова -->
  <g transform="rotate(${p.headRot ?? 0} ${hx} ${hy})">
    <path d="${fluff(hx, hy, 20, 16.5, 7, 0.045, 1, 28)}" fill="${C.wool}" stroke="${C.line}" stroke-width="3" stroke-linejoin="round"/>
    <!-- чёлка-пушок -->
    <path d="${fluff(hx - 3, hy - 15, 13, 9, 5, 0.12, 0, 22)}" fill="${C.wool}" stroke="${C.line}" stroke-width="2.6" stroke-linejoin="round"/>
    <!-- морда -->
    <ellipse cx="${hx + 15}" cy="${hy + 6}" rx="10.5" ry="9" fill="#F7E6D2" stroke="${C.line}" stroke-width="2.6"/>
    <ellipse cx="${hx + 22}" cy="${hy + 3.5}" rx="2.6" ry="2" fill="${C.line}"/>
    <path d="M${hx + 13},${hy + 12} q4,3 8,0" fill="none" stroke="${C.line}" stroke-width="2" stroke-linecap="round"/>
    <ellipse cx="${hx + 6}" cy="${hy + 6}" rx="5" ry="3.2" fill="${C.pink}" opacity="0.55"/>
    ${eye}
  </g>
  <!-- ухо ближнее -->
  <g transform="rotate(${earRot} ${hx - 3} ${hy - 10})">
    <ellipse cx="${hx - 3}" cy="${hy - 23}" rx="5.8" ry="14" fill="${C.wool}" stroke="${C.line}" stroke-width="2.8"/>
    <ellipse cx="${hx - 3}" cy="${hy - 22}" rx="2.6" ry="8.5" fill="${C.pink}" opacity="0.7"/>
  </g>
  <!-- шарф: один узнаваемый акцент бренда -->
  <g transform="rotate(${p.scarfRot ?? 8} ${nx + 4} ${ny + 2})">
    <rect x="${nx - 13}" y="${ny - 7}" width="30" height="16" rx="8" fill="${C.blue}" stroke="${C.line}" stroke-width="2.8"/>
    <path d="M${nx - 8},${ny - 4} l22,0 M${nx - 8},${ny + 4} l22,0" stroke="#fff" stroke-width="2" opacity="0.85" stroke-linecap="round"/>
  </g>
  ${stars}
</svg>`
}

// ——— позы ———
const HIP_F = [112, 128]
const HIP_B = [64, 128]
const GY = 184

function runPose(i) {
  const phi = (i * Math.PI) / 2 + Math.PI / 4
  const foot = (hipx, ph, bias) => {
    const dx = -26 * Math.cos(ph) + bias
    const lift = Math.max(0, Math.sin(ph)) * 20
    return [hipx + dx, GY - lift]
  }
  const bob = -3 * Math.abs(Math.sin(phi))
  const headBob = 3.5 * Math.cos(2 * phi)
  return {
    body: [88, 110 + bob, 50, 30],
    bodyRot: -1.5 + 1.5 * Math.cos(2 * phi),
    hips: { f: [HIP_F[0], HIP_F[1] + bob], b: [HIP_B[0], HIP_B[1] + bob] },
    legs: {
      nf: foot(HIP_F[0], phi, 8),
      ff: foot(HIP_F[0], phi + Math.PI, 8),
      nb: foot(HIP_B[0], phi + Math.PI, -6),
      fb: foot(HIP_B[0], phi, -6),
    },
    neckBase: [114, 92 + bob],
    head: [150, 42 + headBob + bob],
    headRot: 3 * Math.cos(phi),
    tail: [34, 101 + bob, -12 + 10 * Math.sin(phi)],
    scarf: 8 * Math.sin(phi + 1),
    earRot: -22 + 6 * Math.sin(phi),
    eye: 'open',
    shadowRx: 50,
  }
}

const POSES = {
  jumpUp: {
    body: [88, 108, 50, 30],
    bodyRot: -9,
    hips: { f: [HIP_F[0], 124], b: [HIP_B[0], 126] },
    legs: { nf: [142, 148], ff: [128, 156], nb: [26, 162], fb: [40, 172] },
    neckBase: [116, 90],
    head: [156, 36],
    headRot: -6,
    tail: [32, 94, -28],
    scarf: 12,
    earRot: -34,
    eye: 'happy',
    shadow: false,
  },
  jumpDown: {
    body: [88, 108, 50, 30],
    bodyRot: 5,
    hips: { f: [HIP_F[0], 128], b: [HIP_B[0], 128] },
    legs: { nf: [140, 166], ff: [124, 174], nb: [50, 176], fb: [34, 168] },
    neckBase: [116, 92],
    head: [153, 40],
    headRot: 5,
    tail: [32, 100, -4],
    scarf: -12,
    earRot: -46,
    eye: 'open',
    shadow: false,
  },
  slide0: {
    body: [86, 148, 50, 24],
    bodyRot: 10,
    hips: { f: [114, 158], b: [62, 158] },
    legs: { nf: [160, 183], ff: [146, 184], nb: [30, 183], fb: [46, 184] },
    neckBase: [118, 140],
    head: [160, 126],
    headRot: 12,
    neckW: 24,
    neckBow: 2,
    tail: [30, 150, 8],
    scarf: 3,
    scarfRot: 22,
    earRot: -78,
    eye: 'open',
    shadowRx: 60,
  },
  slide1: {
    body: [86, 150, 50, 22],
    bodyRot: 7,
    hips: { f: [114, 160], b: [62, 160] },
    legs: { nf: [164, 184], ff: [150, 183], nb: [26, 184], fb: [42, 183] },
    neckBase: [118, 142],
    head: [162, 130],
    headRot: 8,
    neckW: 24,
    neckBow: 2,
    tail: [28, 152, 14],
    scarf: -3,
    scarfRot: 20,
    earRot: -80,
    eye: 'open',
    shadowRx: 62,
  },
  hit: {
    body: [88, 112, 50, 30],
    bodyRot: -20,
    hips: { f: [HIP_F[0], 128], b: [HIP_B[0], 130] },
    legs: { nf: [144, 152], ff: [152, 164], nb: [28, 172], fb: [44, 150] },
    neckBase: [112, 94],
    head: [140, 44],
    headRot: -14,
    tail: [30, 98, -30],
    scarf: 14,
    earRot: -60,
    eye: 'x',
    stars: [
      [118, 16, 7],
      [150, 10, 5],
      [172, 30, 6],
    ],
  },
}

const FRAMES = [
  ['run0', alpacaSVG(runPose(0))],
  ['run1', alpacaSVG(runPose(1))],
  ['run2', alpacaSVG(runPose(2))],
  ['run3', alpacaSVG(runPose(3))],
  ['hit', alpacaSVG(POSES.hit)],
  ['jump0', alpacaSVG(POSES.jumpUp)],
  ['jump1', alpacaSVG(POSES.jumpDown)],
  ['slide0', alpacaSVG(POSES.slide0)],
  ['slide1', alpacaSVG(POSES.slide1)],
]

// ───────────────────────────── объекты мира ─────────────────────────────
const crateSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 112 112">
  <rect x="3" y="3" width="106" height="106" rx="9" fill="${C.wood}" stroke="${C.line}" stroke-width="5"/>
  <rect x="3" y="3" width="106" height="14" rx="7" fill="${C.woodLight}" opacity="0.7"/>
  <path d="M8,38 H104 M8,74 H104" stroke="${C.woodDark}" stroke-width="3" opacity="0.55"/>
  <!-- рамка -->
  <rect x="12" y="12" width="88" height="88" rx="5" fill="none" stroke="${C.woodDark}" stroke-width="5"/>
  <path d="M16,16 L96,96 M96,16 L16,96" stroke="${C.woodDark}" stroke-width="5" opacity="0.65"/>
  <!-- синий ярлык бренда -->
  <rect x="34" y="38" width="44" height="36" rx="7" fill="${C.blue}" stroke="${C.line}" stroke-width="3.5"/>
  <g transform="translate(56 56) rotate(-30)">
    <ellipse cx="0" cy="0" rx="8.5" ry="12" fill="${C.cream}"/>
    <path d="M0,-11 C-4,-4 4,4 0,11" fill="none" stroke="${C.blue}" stroke-width="2.6" stroke-linecap="round"/>
  </g>
  <circle cx="14" cy="14" r="3" fill="${C.line}"/><circle cx="98" cy="14" r="3" fill="${C.line}"/>
  <circle cx="14" cy="98" r="3" fill="${C.line}"/><circle cx="98" cy="98" r="3" fill="${C.line}"/>
</svg>`

// Баннер: висит сверху экрана до «зазора» над землёй. Низ ткани = groundY − 44 → в тексуре 2x.
const BANNER_W = 120 // 60 мировых px
const BANNER_H = 880 // 440 мировых px: ткань (до groundY-44) + 52 px запаса вниз для тени
const BANNER_HEM = BANNER_H - 2 * 52 // y нижней кромки ткани в текстуре
const bannerSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${BANNER_W}" height="${BANNER_H}" viewBox="0 0 ${BANNER_W} ${BANNER_H}">
  <ellipse cx="${BANNER_W / 2}" cy="${BANNER_H - 10}" rx="46" ry="9" fill="#000" opacity="0.18"/>
  <!-- ткань -->
  <path d="M6,0 H114 V${BANNER_HEM - 18} L100,${BANNER_HEM} L87,${BANNER_HEM - 14} L74,${BANNER_HEM} L60,${BANNER_HEM - 14} L46,${BANNER_HEM} L33,${BANNER_HEM - 14} L20,${BANNER_HEM} L6,${BANNER_HEM - 18} Z"
        fill="${C.blue}" stroke="${C.line}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M16,0 V${BANNER_HEM - 28} M104,0 V${BANNER_HEM - 28}" stroke="${C.blueLight}" stroke-width="5" opacity="0.7"/>
  <rect x="26" y="0" width="68" height="${BANNER_HEM - 30}" fill="${C.blueDark}" opacity="0.35"/>
  <!-- «6.7» -->
  <g transform="translate(60 ${BANNER_HEM - 190})">
    <circle r="40" fill="${C.cream}" stroke="${C.line}" stroke-width="4"/>
    <text x="0" y="12" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="34" fill="${C.blue}">6.7</text>
  </g>
  <!-- чашка внизу ткани -->
  <g transform="translate(60 ${BANNER_HEM - 92})">
    <path d="M-20,-14 H20 V6 Q20,24 0,24 Q-20,24 -20,6 Z" fill="${C.cream}" stroke="${C.line}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M20,-6 q14,0 14,10 q0,10 -14,10" fill="none" stroke="${C.cream}" stroke-width="5"/>
    <path d="M-8,-26 q-6,-8 0,-14 M6,-26 q-6,-8 0,-14" fill="none" stroke="${C.cream}" stroke-width="3.5" stroke-linecap="round" opacity="0.9"/>
  </g>
  <!-- золотые кисточки -->
  <path d="M20,${BANNER_HEM - 4} v14 M46,${BANNER_HEM - 4} v14 M74,${BANNER_HEM - 4} v14 M100,${BANNER_HEM - 4} v14" stroke="${C.gold}" stroke-width="5" stroke-linecap="round"/>
</svg>`

const beanSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="56" viewBox="0 0 48 56">
  <ellipse cx="24" cy="50" rx="13" ry="3.5" fill="#000" opacity="0.14"/>
  <g transform="rotate(-24 24 26)">
    <ellipse cx="24" cy="26" rx="15.5" ry="22" fill="#7A4A22" stroke="${C.line}" stroke-width="3.5"/>
    <ellipse cx="18" cy="17" rx="4" ry="8" fill="#A5703F" opacity="0.85"/>
    <path d="M24,6 C13,18 35,34 24,46" fill="none" stroke="#2E1A0B" stroke-width="3.8" stroke-linecap="round"/>
  </g>
  <path d="M38,8 l3,-6 l3,6 l6,3 l-6,3 l-3,6 l-3,-6 l-6,-3 Z" fill="${C.gold}" stroke="${C.line}" stroke-width="1.6" stroke-linejoin="round" transform="scale(0.7) translate(18 4)"/>
</svg>`

const FIN_W = 300
const FIN_H = 420
const finishSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${FIN_W}" height="${FIN_H}" viewBox="0 0 ${FIN_W} ${FIN_H}">
  <ellipse cx="150" cy="${FIN_H - 8}" rx="130" ry="9" fill="#000" opacity="0.16"/>
  <!-- колонны -->
  <rect x="20" y="70" width="40" height="${FIN_H - 84}" rx="6" fill="${C.cream}" stroke="${C.line}" stroke-width="5"/>
  <rect x="240" y="70" width="40" height="${FIN_H - 84}" rx="6" fill="${C.cream}" stroke="${C.line}" stroke-width="5"/>
  <path d="M30,80 V${FIN_H - 20} M270,80 V${FIN_H - 20}" stroke="${C.wool2}" stroke-width="5"/>
  <rect x="12" y="${FIN_H - 34}" width="56" height="22" rx="5" fill="${C.blue}" stroke="${C.line}" stroke-width="4"/>
  <rect x="232" y="${FIN_H - 34}" width="56" height="22" rx="5" fill="${C.blue}" stroke="${C.line}" stroke-width="4"/>
  <!-- арка -->
  <path d="M6,92 Q150,-22 294,92 L294,118 Q150,18 6,118 Z" fill="${C.blue}" stroke="${C.line}" stroke-width="5" stroke-linejoin="round"/>
  <!-- вывеска -->
  <g transform="translate(150 54)">
    <rect x="-86" y="-26" width="172" height="56" rx="14" fill="${C.cream}" stroke="${C.line}" stroke-width="5"/>
    <text x="0" y="14" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="27" fill="${C.blue}">6.7 COFFEE</text>
  </g>
  <!-- флажки -->
  <path d="M10,126 Q150,60 290,126" fill="none" stroke="${C.line}" stroke-width="3"/>
  ${[0, 1, 2, 3, 4, 5, 6, 7, 8]
    .map((i) => {
      const t = (i + 0.5) / 9
      const x = 10 + 280 * t
      const y = 126 - 4 * 15 * (1 - Math.pow(2 * t - 1, 2)) * 1.07
      const col = i % 3 === 0 ? C.gold : i % 3 === 1 ? C.cream : C.blueLight
      return `<path d="M${f(x - 9)},${f(y)} L${f(x + 9)},${f(y)} L${f(x)},${f(y + 20)} Z" fill="${col}" stroke="${C.line}" stroke-width="2.4" stroke-linejoin="round"/>`
    })
    .join('')}
  <!-- лента на земле -->
  <rect x="60" y="${FIN_H - 22}" width="180" height="10" fill="${C.cream}" stroke="${C.line}" stroke-width="3"/>
  ${[0, 1, 2, 3, 4, 5, 6, 7, 8]
    .map((i) => `<rect x="${60 + i * 20}" y="${FIN_H - 22}" width="10" height="10" fill="${C.blue}"/>`)
    .join('')}
</svg>`

// Земля: тротуар + бордюр + дорога. Период 256 px (2x) — бесшовно.
const GROUND_W = 256
const GROUND_H = 240 // 120 мировых px
const groundSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${GROUND_W}" height="${GROUND_H}" viewBox="0 0 ${GROUND_W} ${GROUND_H}">
  <rect width="${GROUND_W}" height="${GROUND_H}" fill="#555B6B"/>
  <!-- тротуар -->
  <rect y="0" width="${GROUND_W}" height="38" fill="#EADFC9"/>
  <rect y="0" width="${GROUND_W}" height="7" fill="#F8F1E3"/>
  <path d="M0,38 H${GROUND_W}" stroke="${C.line}" stroke-width="4"/>
  <path d="M64,0 V38 M128,0 V38 M192,0 V38 M0,19 H${GROUND_W}" stroke="#CDBE9F" stroke-width="3" opacity="0.8"/>
  <!-- бордюр -->
  <rect y="40" width="${GROUND_W}" height="16" fill="#C9C2B3"/>
  <rect y="40" width="${GROUND_W}" height="5" fill="#E2DCCD"/>
  <path d="M0,56 H${GROUND_W}" stroke="${C.line}" stroke-width="4"/>
  <!-- дорога -->
  <rect y="58" width="${GROUND_W}" height="${GROUND_H - 58}" fill="#575D6E"/>
  <rect y="58" width="${GROUND_W}" height="14" fill="#4A4F5F"/>
  <rect x="40" y="136" width="110" height="12" rx="5" fill="#F8F1E3" opacity="0.9"/>
  <circle cx="20" cy="104" r="2.5" fill="#6A7084"/><circle cx="196" cy="180" r="2.5" fill="#6A7084"/><circle cx="110" cy="206" r="2" fill="#6A7084"/>
</svg>`

// ───────────────────────────── параллакс ─────────────────────────────
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

// Облака (период 1920 = 960 мировых px)
function cloudsSVG() {
  const W = 1920
  const H = 300
  const r = rng(11)
  const cloud = (x, y, s) => `
    <g transform="translate(${x} ${y}) scale(${s})" fill="#fff" opacity="0.92">
      <ellipse cx="0" cy="0" rx="70" ry="26"/><ellipse cx="-44" cy="8" rx="44" ry="20"/>
      <ellipse cx="46" cy="8" rx="52" ry="22"/><ellipse cx="6" cy="-18" rx="40" ry="22"/>
    </g>`
  let s = ''
  const xs = [160, 560, 900, 1300, 1700]
  xs.forEach((x, i) => {
    s += cloud(x, 70 + r() * 150, 0.8 + r() * 0.7)
    void i
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${s}</svg>`
}

// Дальний силуэт города (период 2560 = 1280 мировых px)
function farSVG() {
  const W = 2560
  const H = 520
  const r = rng(5)
  let x = 0
  let s = ''
  while (x < W) {
    let w = 110 + Math.floor(r() * 130)
    if (W - x - w < 110) w = W - x
    const h = 200 + Math.floor(r() * 250)
    const col = ['#B6CBEA', '#A9C0E4', '#BFD2EE'][Math.floor(r() * 3)]
    s += `<rect x="${x}" y="${H - h}" width="${w}" height="${h}" fill="${col}"/>`
    if (r() > 0.5) s += `<rect x="${x + w * 0.3}" y="${H - h - 26}" width="${w * 0.4}" height="26" fill="${col}"/>`
    // окна
    for (let wy = H - h + 24; wy < H - 30; wy += 38) {
      for (let wx = x + 16; wx < x + w - 24; wx += 30) {
        if (r() > 0.55) s += `<rect x="${wx}" y="${wy}" width="14" height="18" rx="2" fill="#E6EFFC" opacity="0.8"/>`
      }
    }
    x += w
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${s}</svg>`
}

// Средний слой: фасады кофеен (период 1920 = 960 мировых px, 4 фасада по 480)
function midSVG() {
  const W = 1920
  const H = 460
  const facades = [
    { wall: '#F3E3C8', awning: C.blue, door: '#8C5A2B', sign: 'cup' },
    { wall: '#E9D3B2', awning: '#C8A26E', door: C.blueDark, sign: 'bean' },
    { wall: '#F5EBDD', awning: C.blueLight, door: '#8C5A2B', sign: '67' },
    { wall: '#EAD9BE', awning: C.blue, door: C.blueDark, sign: 'cup' },
  ]
  let s = ''
  facades.forEach((fc, i) => {
    const x0 = i * 480
    const top = 70 + (i % 2) * 40
    s += `<rect x="${x0 + 6}" y="${top}" width="468" height="${H - top}" fill="${fc.wall}" stroke="${C.line}" stroke-width="4" opacity="0.98"/>`
    s += `<rect x="${x0 + 6}" y="${top}" width="468" height="22" fill="#D9C4A0"/>`
    // окна верхнего этажа
    for (let k = 0; k < 3; k++) {
      s += `<rect x="${x0 + 40 + k * 140}" y="${top + 44}" width="86" height="96" rx="6" fill="#BFD8F2" stroke="${C.line}" stroke-width="3.5"/>
            <path d="M${x0 + 83 + k * 140},${top + 44} v96 M${x0 + 40 + k * 140},${top + 92} h86" stroke="${C.line}" stroke-width="2.5"/>`
    }
    // тент
    const ay = top + 175
    s += `<path d="M${x0 + 20},${ay} H${x0 + 460} L${x0 + 480},${ay + 54} H${x0 + 0} Z" fill="${fc.awning}" stroke="${C.line}" stroke-width="4" stroke-linejoin="round"/>`
    for (let k = 0; k < 11; k++) {
      s += `<rect x="${x0 + 14 + k * 42}" y="${ay + 4}" width="21" height="48" fill="#fff" opacity="0.28"/>`
    }
    // витрина и дверь
    s += `<rect x="${x0 + 40}" y="${ay + 70}" width="220" height="${H - ay - 70}" rx="6" fill="#FFE9B8" stroke="${C.line}" stroke-width="4"/>
          <rect x="${x0 + 40}" y="${ay + 70}" width="220" height="${H - ay - 70}" rx="6" fill="#fff" opacity="0.12"/>
          <rect x="${x0 + 300}" y="${ay + 70}" width="110" height="${H - ay - 70}" rx="6" fill="${fc.door}" stroke="${C.line}" stroke-width="4"/>
          <circle cx="${x0 + 394}" cy="${ay + 70 + (H - ay - 70) / 2}" r="5" fill="${C.gold}"/>`
    // вывеска
    const cx = x0 + 240
    const cy = top + 150
    if (fc.sign === 'cup') {
      s += `<g transform="translate(${cx} ${cy})"><path d="M-20,-12 H20 V8 Q20,24 0,24 Q-20,24 -20,8 Z" fill="#fff" stroke="${C.line}" stroke-width="3"/><path d="M20,-6 q12,0 12,9 q0,9 -12,9" fill="none" stroke="#fff" stroke-width="5"/></g>`
    } else if (fc.sign === 'bean') {
      s += `<g transform="translate(${cx} ${cy}) rotate(-25)"><ellipse rx="13" ry="19" fill="#7A4A22" stroke="${C.line}" stroke-width="3"/><path d="M0,-17 C-8,-6 8,6 0,17" fill="none" stroke="#2E1A0B" stroke-width="3"/></g>`
    } else {
      s += `<g transform="translate(${cx} ${cy})"><circle r="24" fill="#fff" stroke="${C.line}" stroke-width="3"/><text y="8" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="21" fill="${C.blue}">6.7</text></g>`
    }
    // горшки
    s += `<rect x="${x0 + 270}" y="${H - 56}" width="22" height="44" rx="4" fill="#B46A3C" stroke="${C.line}" stroke-width="3"/>
          <ellipse cx="${x0 + 281}" cy="${H - 66}" rx="22" ry="20" fill="#5FA46B" stroke="${C.line}" stroke-width="3"/>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${s}</svg>`
}

// Ближний слой: фонари, кусты (период 1920)
function nearSVG() {
  const W = 1920
  const H = 300
  let s = ''
  ;[260, 1220].forEach((x) => {
    s += `<rect x="${x - 5}" y="40" width="10" height="${H - 40}" rx="4" fill="#4C5666" stroke="${C.line}" stroke-width="3"/>
          <path d="M${x},46 q36,-4 40,22" fill="none" stroke="#4C5666" stroke-width="9" stroke-linecap="round"/>
          <ellipse cx="${x + 40}" cy="82" rx="16" ry="11" fill="#FFE9A8" stroke="${C.line}" stroke-width="3"/>
          <ellipse cx="${x + 40}" cy="92" rx="30" ry="12" fill="#FFE9A8" opacity="0.28"/>`
  })
  ;[620, 960, 1560, 1790].forEach((x, i) => {
    const w = 120 + (i % 2) * 40
    s += `<g transform="translate(${x} ${H})">
      <ellipse cx="0" cy="-40" rx="${w / 2}" ry="40" fill="#6FAE74" stroke="${C.line}" stroke-width="4"/>
      <ellipse cx="-${w / 5}" cy="-58" rx="${w / 4}" ry="22" fill="#86C28A" opacity="0.8"/>
      <circle cx="${w / 5}" cy="-30" r="5" fill="#F2B8B0"/><circle cx="-${w / 3}" cy="-24" r="4" fill="#F2B8B0"/>
    </g>`
  })
  // скамейка
  s += `<g transform="translate(1400 ${H})">
    <rect x="-46" y="-52" width="92" height="12" rx="4" fill="${C.wood}" stroke="${C.line}" stroke-width="3"/>
    <rect x="-46" y="-34" width="92" height="10" rx="4" fill="${C.woodLight}" stroke="${C.line}" stroke-width="3"/>
    <path d="M-38,-24 V0 M38,-24 V0" stroke="#4C5666" stroke-width="7" stroke-linecap="round"/>
  </g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${s}</svg>`
}

// ───────────────────────────── сборка ─────────────────────────────
async function renderPng(name, svg, { resizeTo } = {}) {
  fs.writeFileSync(path.join(SVG_DIR, `${name}.svg`), svg)
  let img = sharp(Buffer.from(svg), { density: 144 })
  if (resizeTo) img = img.resize(resizeTo[0], resizeTo[1])
  const buf = await img.png({ compressionLevel: 9 }).toBuffer()
  fs.writeFileSync(path.join(OUT, `${name}.png`), buf)
  return buf
}

async function main() {
  // spritesheet ламы: 5 колонок × 2 ряда, кадр 192×192
  // индексы: run 0..3, hit 4, jump 5..6, slide 7..8
  const COLS = 5
  const ROWS = 2
  const composites = []
  for (let i = 0; i < FRAMES.length; i++) {
    const [name, svg] = FRAMES[i]
    fs.writeFileSync(path.join(SVG_DIR, `alpaca-${name}.svg`), svg)
    const buf = await sharp(Buffer.from(svg), { density: 96 }).resize(192, 192).png().toBuffer()
    composites.push({ input: buf, left: (i % COLS) * 192, top: Math.floor(i / COLS) * 192 })
  }
  await sharp({
    create: { width: COLS * 192, height: ROWS * 192, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, 'alpaca.png'))

  await renderPng('crate', crateSVG, { resizeTo: [112, 112] })
  await renderPng('banner', bannerSVG, { resizeTo: [BANNER_W, BANNER_H] })
  await renderPng('bean', beanSVG, { resizeTo: [48, 56] })
  await renderPng('finish', finishSVG, { resizeTo: [FIN_W, FIN_H] })
  await renderPng('ground', groundSVG, { resizeTo: [GROUND_W, GROUND_H] })
  await renderPng('bg-clouds', cloudsSVG(), { resizeTo: [1920, 300] })
  await renderPng('bg-far', farSVG(), { resizeTo: [2560, 520] })
  await renderPng('bg-mid', midSVG(), { resizeTo: [1920, 460] })
  await renderPng('bg-near', nearSVG(), { resizeTo: [1920, 300] })

  console.log('assets written to', OUT)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
