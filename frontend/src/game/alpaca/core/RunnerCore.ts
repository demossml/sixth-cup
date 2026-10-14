import { JUMP_GRAVITY, JUMP_VELOCITY, RUNNER_CONFIG, type HitboxKind } from '../config'
import { FINISH_WIDTH } from '../level01'
import type { AlpacaState, LevelObject } from '../types'

/**
 * Чистая игровая логика без Phaser: движение мира, прыжок/скольжение, посадка на ящики,
 * столкновения, сбор зёрен. Сцена только рисует состояние, тесты гоняют его без браузера.
 */

export type Rect = { left: number; right: number; top: number; bottom: number }

export type CoreEvent =
  | { type: 'jump'; x: number; y: number }
  | { type: 'land'; x: number; y: number; platform: boolean; impact: number }
  | { type: 'slideStart' }
  | { type: 'slideEnd' }
  | { type: 'bean'; id: string; x: number; y: number; special?: boolean }
  | { type: 'hit'; by: 'crate' | 'overhead' | 'inspector' | 'projectile' }
  | { type: 'finish' }

type Crate = { id: string; left: number; right: number; top: number; landable: boolean }
type Banner = { id: string; left: number; right: number; bottom: number; moving: boolean }
type Bean = { id: string; x: number; y: number; taken: boolean; special: boolean }
type Hazard = { id: string; type: 'inspector' | 'projectile'; x: number; y: number; width: number; height: number }
type SpeedZone = { id: string; x: number; width: number }

const BEAN_W = 22
const BEAN_H = 26
const BEAN_PICKUP_PAD = 6

export type CoreStatus = 'running' | 'hit' | 'finished'

export class RunnerCore {
  worldX = 0
  playMs = 0
  status: CoreStatus = 'running'
  /** Ступни героя (экранная y). */
  bottom: number = RUNNER_CONFIG.groundY
  vy = 0
  grounded = true
  sliding = false
  platformId: string | null = null
  beans = 0
  events: CoreEvent[] = []

  private slideMs = 0
  private coyoteMs = 0
  private bufferMs = 0
  private acc = 0

  private readonly crates: Crate[] = []
  private readonly banners: Banner[] = []
  private readonly beanList: Bean[] = []
  private readonly hazards: Hazard[] = []
  private readonly inspectorTriggers: { id: string; x: number }[] = []
  private readonly speedZones: SpeedZone[] = []
  private readonly chaseMode: boolean
  private readonly windMode: boolean
  private doubleJumpAvailable = false
  chaseActive = false
  chaseGap = 150
  private readonly finishCenter: number
  readonly beanTotal: number
  readonly length: number

  constructor(objects: LevelObject[], length: number, chaseMode = false, windMode = false) {
    this.chaseMode = chaseMode
    this.windMode = windMode
    const G = RUNNER_CONFIG.groundY
    for (const o of objects) {
      if (o.type === 'crate') {
        this.crates.push({ id: o.id, left: o.x, right: o.x + o.width, top: G - o.height, landable: o.landable !== false })
      } else if (o.type === 'overhead' || o.type === 'movingOverhead') {
        this.banners.push({ id: o.id, left: o.x, right: o.x + o.width, bottom: G - RUNNER_CONFIG.bannerGap, moving: o.type === 'movingOverhead' })
      } else if (o.type === 'bean') {
        this.beanList.push({ id: o.id, x: o.x, y: o.y, taken: false, special: !!o.special })
      } else if (o.type === 'inspector') {
        if (this.chaseMode) this.inspectorTriggers.push({ id: o.id, x: o.x })
        else this.hazards.push({ id: o.id, type: 'inspector', x: o.x, y: G - 68, width: 52, height: 68 })
      } else if (o.type === 'projectile') {
        this.hazards.push({ id: o.id, type: 'projectile', x: o.x, y: o.y, width: o.width, height: o.height })
      } else if (o.type === 'closedZone') {
        this.speedZones.push({ id: o.id, x: o.x, width: o.width })
      }
    }
    const fin = objects.find((o) => o.type === 'finish')
    this.finishCenter = (fin?.type === 'finish' ? fin.x : Infinity) + FINISH_WIDTH / 2
    this.beanTotal = this.beanList.length
    this.length = length
  }

  // ───────────── состояние для рендера ─────────────
  get state(): AlpacaState {
    if (this.status === 'hit') return 'hit'
    if (this.status === 'finished') return 'finished'
    if (!this.grounded) return 'jumping'
    return this.sliding ? 'sliding' : 'running'
  }

  get speed(): number {
    const base = RUNNER_CONFIG.worldSpeed * (1 + RUNNER_CONFIG.speedRamp * Math.min(1, this.worldX / this.length))
    const inClosedZone = this.speedZones.some(zone => this.worldX >= zone.x && this.worldX <= zone.x + zone.width)
    const windDrift = this.windMode ? 1 + Math.sin(this.playMs / 650) * 0.035 : 1
    return base * (inClosedZone ? 1.22 : 1) * windDrift
  }

  get progress01(): number {
    return Math.min(1, this.worldX / this.length)
  }

  get hitboxKind(): HitboxKind {
    if (this.sliding && this.grounded) return 'slide'
    return this.grounded ? 'run' : 'jump'
  }

  heroRect(): Rect {
    const hb = RUNNER_CONFIG.hitbox[this.hitboxKind]
    const cx = RUNNER_CONFIG.heroX + hb.offsetX
    return { left: cx - hb.w / 2, right: cx + hb.w / 2, top: this.bottom - hb.h, bottom: this.bottom }
  }

  isBeanTaken(id: string): boolean {
    return this.beanList.find((b) => b.id === id)?.taken ?? false
  }

  drainEvents(): CoreEvent[] {
    const e = this.events
    this.events = []
    return e
  }

  // ───────────── ввод ─────────────
  jump() {
    if (this.status !== 'running') return
    if (this.grounded || this.coyoteMs > 0) {
      this.startJump()
    } else if (this.doubleJumpAvailable) {
      this.doubleJumpAvailable = false
      this.vy = -JUMP_VELOCITY * 0.88
      this.events.push({ type: 'jump', x: RUNNER_CONFIG.heroX, y: this.bottom })
    } else {
      this.bufferMs = RUNNER_CONFIG.jumpBufferMs
    }
  }

  slide() {
    if (this.status !== 'running') return
    if (!this.grounded) {
      // свайп вниз в воздухе = быстрое падение
      this.vy = Math.max(this.vy, RUNNER_CONFIG.fastFallVy)
      return
    }
    if (this.sliding) return
    this.sliding = true
    this.slideMs = 0
    this.events.push({ type: 'slideStart' })
  }

  private startJump() {
    if (this.sliding) {
      this.sliding = false
      this.events.push({ type: 'slideEnd' })
    }
    this.grounded = false
    this.platformId = null
    this.coyoteMs = 0
    this.bufferMs = 0
    this.vy = -JUMP_VELOCITY
    this.events.push({ type: 'jump', x: RUNNER_CONFIG.heroX, y: this.bottom })
  }

  // ───────────── симуляция ─────────────
  /** Продвинуть игру на dtMs (внутри — фиксированные подшаги). */
  step(dtMs: number) {
    if (this.status !== 'running') return
    this.acc += Math.min(dtMs, RUNNER_CONFIG.maxDeltaMs)
    while (this.acc >= RUNNER_CONFIG.stepMs && this.status === 'running') {
      this.acc -= RUNNER_CONFIG.stepMs
      this.sub(RUNNER_CONFIG.stepMs)
    }
  }

  private sub(ms: number) {
    const dt = ms / 1000
    const G = RUNNER_CONFIG.groundY
    this.playMs += ms
    this.worldX += this.speed * dt
    if (this.chaseMode) {
      if (this.inspectorTriggers.some(trigger => this.worldX + RUNNER_CONFIG.heroX >= trigger.x)) this.chaseActive = true
      if (this.chaseActive) {
        this.chaseGap -= dt * 10.5
        if (this.chaseGap <= 46) return this.die('inspector')
      }
    }

    if (this.sliding) {
      this.slideMs += ms
      if (this.slideMs >= RUNNER_CONFIG.slideDurationMs) {
        this.sliding = false
        this.events.push({ type: 'slideEnd' })
      }
    }
    if (!this.grounded) {
      this.coyoteMs = Math.max(0, this.coyoteMs - ms)
    }
    this.bufferMs = Math.max(0, this.bufferMs - ms)

    const prevBottom = this.bottom

    if (!this.grounded) {
      this.vy += JUMP_GRAVITY * dt
      this.bottom += this.vy * dt
    } else if (this.platformId) {
      // стоим на ящике: пока он под ногами
      const c = this.crates.find((k) => k.id === this.platformId)
      const r = this.heroRect()
      if (!c || r.right <= c.left - this.worldX || r.left >= c.right - this.worldX) {
        this.grounded = false
        this.platformId = null
        this.vy = 0
        this.coyoteMs = RUNNER_CONFIG.coyoteMs
      }
    }

    if (!this.grounded && this.bottom >= G) {
      this.land(G, null)
    }

    // ящики
    const r = this.heroRect()
    for (const c of this.crates) {
      const l = c.left - this.worldX
      const rr = c.right - this.worldX
      if (r.right <= l || r.left >= rr) continue
      if (r.bottom <= c.top || r.top >= G) continue
      const pen = r.bottom - c.top
      if (this.vy >= 0 && c.landable && (prevBottom <= c.top + 6 || pen <= RUNNER_CONFIG.ledgeAssistPx)) {
        this.land(c.top, c.id)
        r.bottom = this.bottom
        r.top = this.bottom - (RUNNER_CONFIG.hitbox[this.hitboxKind].h)
        continue
      }
      if (pen <= RUNNER_CONFIG.ledgeAssistPx) continue // зацепили угол — прощаем
      return this.die('crate')
    }

    // баннеры: проходимы только со скольжением (верх героя ниже кромки)
    const r2 = this.heroRect()
    for (const b of this.banners) {
      const l = b.left - this.worldX
      const rr = b.right - this.worldX
      if (r2.right <= l || r2.left >= rr) continue
      const bannerBottom = b.bottom + (b.moving ? Math.sin(this.playMs / 500) * 8 : 0)
      if (r2.top < bannerBottom) return this.die('overhead')
    }

    // Инспектор и летящие предметы: честные прямоугольные hitbox; прыжок позволяет избежать удара.
    for (const h of this.hazards) {
      const left = h.x - this.worldX
      const right = left + h.width
      const top = h.y
      const bottom = h.y + h.height
      if (r2.left < right && r2.right > left && r2.top < bottom && r2.bottom > top) {
        return this.die(h.type)
      }
    }

    // зёрна
    const pad = BEAN_PICKUP_PAD
    for (const b of this.beanList) {
      if (b.taken) continue
      const bx = b.x - this.worldX
      if (
        r2.left - pad < bx + BEAN_W / 2 &&
        r2.right + pad > bx - BEAN_W / 2 &&
        r2.top - pad < b.y + BEAN_H / 2 &&
        r2.bottom + pad > b.y - BEAN_H / 2
      ) {
        b.taken = true
        this.beans++
        if (b.special) {
          this.doubleJumpAvailable = true
          if (this.chaseMode && this.chaseActive) this.chaseGap = Math.min(190, this.chaseGap + 42)
        }
        this.events.push({ type: 'bean', id: b.id, x: bx, y: b.y, special: b.special })
      }
    }

    if (this.worldX + RUNNER_CONFIG.heroX >= this.finishCenter) {
      this.status = 'finished'
      this.events.push({ type: 'finish' })
    }
  }

  private land(y: number, platform: string | null) {
    const impact = this.vy
    this.bottom = y
    this.vy = 0
    this.grounded = true
    this.platformId = platform
    this.coyoteMs = 0
    this.doubleJumpAvailable = false
    this.events.push({ type: 'land', x: RUNNER_CONFIG.heroX, y, platform: platform !== null, impact })
    if (this.bufferMs > 0) this.startJump()
  }

  private die(by: 'crate' | 'overhead' | 'inspector' | 'projectile') {
    this.status = 'hit'
    this.sliding = false
    this.events.push({ type: 'hit', by })
  }
}
