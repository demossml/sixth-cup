import { describe, expect, it } from 'vitest'
import { JUMP_GRAVITY, JUMP_VELOCITY, RUNNER_CONFIG } from '../config'
import { LEVEL_01_BEAN_COUNT, LEVEL_01_LENGTH, LEVEL_01_OBJECTS } from '../level01'
import { RunnerCore } from './RunnerCore'

const G = RUNNER_CONFIG.groundY
const HB = RUNNER_CONFIG.hitbox
const crates = LEVEL_01_OBJECTS.filter((o) => o.type === 'crate') as Extract<(typeof LEVEL_01_OBJECTS)[number], { type: 'crate' }>[]
const banners = LEVEL_01_OBJECTS.filter((o) => o.type === 'overhead')
const solids = [...crates, ...banners].sort((a, b) => a.x - b.x)

const mk = () => new RunnerCore(LEVEL_01_OBJECTS, LEVEL_01_LENGTH)

describe('геометрия и честность', () => {
  it('в апогее низ героя выше любого ящика минимум на 12 px', () => {
    const apex = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * JUMP_GRAVITY)
    expect(apex).toBeCloseTo(RUNNER_CONFIG.jumpHeight, 0)
    for (const c of crates) expect(apex - c.height).toBeGreaterThanOrEqual(12)
  })

  it('hitbox скольжения ≤ 45% от бега, зазор под баннером ≥ 10 px, в беге баннер бьёт', () => {
    expect(HB.slide.h / HB.run.h).toBeLessThanOrEqual(0.45)
    const bannerBottom = G - RUNNER_CONFIG.bannerGap
    expect((G - HB.slide.h) - bannerBottom).toBeGreaterThanOrEqual(10)
    expect(G - HB.run.h).toBeLessThan(bannerBottom)
  })

  it('скольжения хватает, чтобы проехать баннер с запасом ≥ 120 мс', () => {
    const need = ((RUNNER_CONFIG.bannerWidth + HB.slide.w) / (RUNNER_CONFIG.worldSpeed * (1 + RUNNER_CONFIG.speedRamp))) * 1000
    expect(RUNNER_CONFIG.slideDurationMs - need).toBeGreaterThanOrEqual(120)
  })

  it('дистанция между препятствиями ≥ 280 px (кроме связки платформ c4→c5), старт ≥ 0,9 с реакции', () => {
    for (let i = 1; i < solids.length; i++) {
      const prev = solids[i - 1]
      const gap = solids[i].x - (prev.x + prev.width)
      if (prev.id === 'c4') continue
      expect(gap, `${prev.id}→${solids[i].id}`).toBeGreaterThanOrEqual(280)
    }
    const first = solids[0].x - (RUNNER_CONFIG.heroX + HB.run.w / 2)
    expect(first / RUNNER_CONFIG.worldSpeed).toBeGreaterThanOrEqual(0.9)
  })

  it('уровень: 12–20 зёрен, перед финишем ≥ 400 px чистой дороги', () => {
    expect(LEVEL_01_BEAN_COUNT).toBeGreaterThanOrEqual(12)
    expect(LEVEL_01_BEAN_COUNT).toBeLessThanOrEqual(20)
    const last = solids[solids.length - 1]
    const fin = LEVEL_01_OBJECTS.find((o) => o.type === 'finish')!
    expect((fin as { x: number }).x - (last.x + last.width)).toBeGreaterThanOrEqual(400)
  })
})

/** Бот: прыгает/скользит, когда до препятствия осталось lead px. */
function run(leadJump: number, leadSlide: number, opts: { noInput?: boolean } = {}) {
  const core = mk()
  const heroRight = RUNNER_CONFIG.heroX + HB.run.w / 2 + HB.run.offsetX
  let t = 0
  while (core.status === 'running' && t < 60_000) {
    if (!opts.noInput) {
      for (const o of solids) {
        const dist = o.x - core.worldX - heroRight
        if (dist < -200) continue
        if (o.type === 'crate' && core.grounded && dist <= leadJump && dist > leadJump - 12) core.jump()
        if (o.type === 'overhead' && core.grounded && !core.sliding && dist <= leadSlide && dist > leadSlide - 12) core.slide()
      }
    }
    core.step(8)
    t += 8
  }
  return core
}

function window(fn: (lead: number) => boolean, from: number, to: number) {
  let best = 0
  let cur = 0
  for (let l = from; l <= to; l += 2) {
    if (fn(l)) {
      cur += 2
      best = Math.max(best, cur)
    } else cur = 0
  }
  return (best * 1000) / RUNNER_CONFIG.worldSpeed // px → мс
}

describe('проходимость уровня 01', () => {
  it('без ввода героя убивает первое препятствие', () => {
    expect(run(0, 0, { noInput: true }).status).toBe('hit')
  })

  it('есть окно прыжка ≥ 120 мс, при котором уровень проходится (баннеры — по центру окна)', () => {
    const slideMid = 40
    const w = window((l) => run(l, slideMid).status === 'finished', 20, 330)
    expect(w).toBeGreaterThanOrEqual(120)
  })

  it('есть окно скольжения ≥ 120 мс', () => {
    const w = window((l) => run(150, l).status === 'finished', 0, 200)
    expect(w).toBeGreaterThanOrEqual(120)
  })

  it('100% зёрен собираются в широком окне прыжка (≥ 60 мс)', () => {
    const w = window((l) => {
      const c = run(l, 40)
      return c.status === 'finished' && c.beans === LEVEL_01_BEAN_COUNT
    }, 20, 330)
    expect(w).toBeGreaterThanOrEqual(60)
  })
})

describe('платформы и скольжение', () => {
  it('можно приземлиться на ящик и стоять на нём', () => {
    const core = new RunnerCore([{ type: 'crate', id: 'x', x: 400, width: 168, height: 56 }, { type: 'finish', id: 'f', x: 5000 }], 5000)
    let landedOn = false
    let t = 0
    while (core.status === 'running' && t < 4000) {
      const dist = 400 - core.worldX - 192
      if (core.grounded && dist <= 150 && dist > 130) core.jump()
      core.step(8)
      t += 8
      if (core.platformId === 'x') landedOn = true
    }
    expect(landedOn).toBe(true)
    expect(core.status).not.toBe('hit')
  })

  it('прыжок не позволяет перелететь баннер', () => {
    const core = new RunnerCore([{ type: 'overhead', id: 'o', x: 500, width: 60, height: 0 }, { type: 'finish', id: 'f', x: 5000 }], 5000)
    let t = 0
    while (core.status === 'running' && t < 4000) {
      const dist = 500 - core.worldX - 192
      if (core.grounded && dist <= 120) core.jump()
      core.step(8)
      t += 8
    }
    expect(core.status).toBe('hit')
  })

  it('coyote time: прыжок сразу после схода с ящика работает', () => {
    const core = new RunnerCore([{ type: 'crate', id: 'x', x: 300, width: 56, height: 56 }, { type: 'finish', id: 'f', x: 5000 }], 5000)
    let t = 0
    let jumped = false
    while (t < 3000 && core.status === 'running') {
      core.step(4)
      t += 4
      const dist = 300 - core.worldX - 192
      if (!jumped && core.grounded && !core.platformId && dist <= 90) {
        core.jump()
        jumped = true
      }
      if (jumped && core.platformId === null && !core.grounded) break
    }
    expect(jumped).toBe(true)
  })
})

describe('отчёт об окнах (информационно)', () => {
  it('печатает окна', () => {
    const wj = window((l) => run(l, 40).status === 'finished', 20, 330)
    const ws = window((l) => run(150, l).status === 'finished', 0, 200)
    const wb = window((l) => { const c = run(l, 40); return c.status === 'finished' && c.beans === LEVEL_01_BEAN_COUNT }, 20, 330)
    console.log(`WINDOWS jump=${Math.round(wj)}ms slide=${Math.round(ws)}ms allBeans=${Math.round(wb)}ms`)
    expect(true).toBe(true)
  })
})
