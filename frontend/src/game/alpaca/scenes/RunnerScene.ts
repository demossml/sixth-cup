import Phaser from 'phaser'
import { RUNNER_CONFIG, isDebugHitbox } from '../config'
import {
  FINISH_WIDTH,
  LEVEL_01_BEAN_COUNT,
  LEVEL_01_LENGTH,
  LEVEL_01_NAME,
  LEVEL_01_OBJECTS,
} from '../level01'
import type { GameAction, GameBridge, GameStatus, RunnerRunResult } from '../types'
import { InputController } from '../systems/InputController'
import { RunnerCore, type CoreEvent } from '../core/RunnerCore'
import { ALPACA_FRAMES, ALPACA_ORIGIN, ALPACA_SCALE } from '../entities/Alpaca'

type Phase = 'idle' | 'countdown' | 'running' | 'dying' | 'finishing' | 'done'

const G = RUNNER_CONFIG.groundY
const W = RUNNER_CONFIG.width
const H = RUNNER_CONFIG.height
const COUNTDOWN_MS = 1200
const DYING_MS = 700
const FINISHING_MS = 1500
/** y верха баннера-изображения: низ ткани (G − gap) минус высота ткани в мировых px (388). */
const BANNER_TOP = G - RUNNER_CONFIG.bannerGap - 388
const FONT = '"Geologica Variable","Golos Text",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'

type Item = { id: string; x: number; y: number; sprite: Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite; width: number }

export class RunnerScene extends Phaser.Scene {
  private bridge!: GameBridge
  private status: GameStatus = 'loading'
  private phase: Phase = 'idle'
  private core!: RunnerCore
  private inputCtl: InputController | null = null

  private phaseMs = 0
  private visX = 0 // «визуальный» worldX (после финиша мир тормозит плавно)
  private finishSlow = 1
  private runId = ''
  private lastHud = ''
  private dustTimer = 0

  private hero!: Phaser.GameObjects.Sprite
  private heroLift = 0 // визуальный отрыв (кувырок при ударе)
  private sqx = 1
  private sqy = 1

  private sky!: Phaser.GameObjects.Image
  private clouds!: Phaser.GameObjects.TileSprite
  private far!: Phaser.GameObjects.TileSprite
  private mid!: Phaser.GameObjects.TileSprite
  private near!: Phaser.GameObjects.TileSprite
  private ground!: Phaser.GameObjects.TileSprite

  private beans: (Item & { base: number; idx: number })[] = []
  private crates: Item[] = []
  private banners: Item[] = []
  private finish!: Item

  private dust!: Phaser.GameObjects.Particles.ParticleEmitter
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter
  private confetti!: Phaser.GameObjects.Particles.ParticleEmitter
  private pops: Phaser.GameObjects.Text[] = []
  private banner!: Phaser.GameObjects.Text
  private debugG: Phaser.GameObjects.Graphics | null = null

  constructor() {
    super('Runner')
  }

  // ───────────────────────── жизненный цикл ─────────────────────────
  create() {
    this.bridge = this.game.registry.get('bridge') as GameBridge
    this.buildWorld()
    this.core = this.newCore()
    this.resetVisuals()
    this.inputCtl = new InputController(this.game.canvas, (a) => this.onAction(a))
    this.inputCtl.setEnabled(false)
    if (isDebugHitbox()) this.debugG = this.add.graphics().setDepth(50)
    if (new URLSearchParams(window.location.search).has('debug')) {
      ;(window as unknown as { __alpacaScene?: RunnerScene }).__alpacaScene = this // только при ?debug / ?debug=1
    }

    const onVis = () => {
      if (this.status === 'playing') this.pauseGame()
    }
    this.game.events.on('visibility-pause', onVis)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('visibility-pause', onVis)
      this.inputCtl?.destroy()
      this.inputCtl = null
    })

    this.setStatus('ready')
    this.bridge.onScene?.(this)
  }

  /** Для отладки/тестов (?debug=1): прыжок мира вперёд. */
  public debugSkipTo(worldX: number) {
    this.core.worldX = worldX
  }

  private newCore() {
    return new RunnerCore(LEVEL_01_OBJECTS, LEVEL_01_LENGTH)
  }

  private buildWorld() {
    this.sky = this.add.image(0, 0, 'sky').setOrigin(0, 0).setDisplaySize(W, H).setDepth(0)
    this.add.image(790, 110, 'sun').setDepth(0.5).setScale(1.1)
    this.clouds = this.add.tileSprite(0, 20, W, 150, 'bg-clouds').setOrigin(0, 0).setTileScale(0.5).setDepth(1)
    this.far = this.add.tileSprite(0, G - 250, W, 260, 'bg-far').setOrigin(0, 0).setTileScale(0.5).setDepth(2).setAlpha(0.85)
    this.mid = this.add.tileSprite(0, G - 224, W, 230, 'bg-mid').setOrigin(0, 0).setTileScale(0.5).setDepth(3)
    this.near = this.add.tileSprite(0, G - 146, W, 150, 'bg-near').setOrigin(0, 0).setTileScale(0.5).setDepth(4)
    this.ground = this.add.tileSprite(0, G - 8, W, H - G + 8, 'ground').setOrigin(0, 0).setTileScale(0.5).setDepth(5)

    const U = RUNNER_CONFIG.crateUnit
    let bi = 0
    for (const o of LEVEL_01_OBJECTS) {
      if (o.type === 'bean') {
        const s = this.add.image(o.x, o.y, 'bean').setScale(0.5).setDepth(7)
        this.beans.push({ id: o.id, x: o.x, y: o.y, sprite: s, width: 24, base: o.y, idx: bi++ })
      } else if (o.type === 'crate') {
        const s = this.add
          .tileSprite(o.x, G, o.width, o.height, 'crate')
          .setOrigin(0, 1)
          .setTileScale(U / 112)
          .setDepth(6)
        this.crates.push({ id: o.id, x: o.x, y: G, sprite: s, width: o.width })
      } else if (o.type === 'overhead') {
        const s = this.add.image(o.x, BANNER_TOP, 'banner').setOrigin(0, 0).setScale(0.5).setDepth(8)
        this.banners.push({ id: o.id, x: o.x, y: BANNER_TOP, sprite: s, width: o.width })
      } else if (o.type === 'finish') {
        const s = this.add.image(o.x, G + 6, 'finish').setOrigin(0, 1).setScale(0.5).setDepth(6)
        this.finish = { id: o.id, x: o.x, y: G + 6, sprite: s, width: FINISH_WIDTH }
      }
    }

    this.hero = this.add
      .sprite(RUNNER_CONFIG.heroX, G, 'alpaca', ALPACA_FRAMES.run[0])
      .setOrigin(ALPACA_ORIGIN.x, ALPACA_ORIGIN.y)
      .setScale(ALPACA_SCALE)
      .setDepth(10)

    // частицы: переиспользуемые эмиттеры, без аллокаций каждый кадр
    this.dust = this.add.particles(0, 0, 'dust', {
      lifespan: { min: 280, max: 480 },
      speedX: { min: -150, max: -40 },
      speedY: { min: -60, max: -5 },
      scale: { start: 0.55, end: 0 },
      alpha: { start: 0.55, end: 0 },
      tint: 0xf3e6cd,
      emitting: false,
    }).setDepth(9)
    this.sparks = this.add.particles(0, 0, 'spark', {
      lifespan: 420,
      speed: { min: 60, max: 170 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0xffd36b, 0xffffff, 0xe2b25c],
      emitting: false,
    }).setDepth(11)
    this.confetti = this.add.particles(0, 0, 'confetti', {
      lifespan: 1500,
      speed: { min: 140, max: 380 },
      angle: { min: 215, max: 325 },
      gravityY: 520,
      rotate: { min: 0, max: 360 },
      scale: { start: 0.9, end: 0.5 },
      alpha: { start: 1, end: 0.2 },
      tint: [0x002fa7, 0x1a4dd6, 0xf8f1e3, 0xe2b25c, 0xc8a26e],
      emitting: false,
    }).setDepth(12)

    for (let i = 0; i < 5; i++) {
      this.pops.push(
        this.add
          .text(0, 0, '+1', { fontFamily: FONT, fontSize: '26px', fontStyle: '800', color: '#ffffff', stroke: '#002FA7', strokeThickness: 5 })
          .setOrigin(0.5)
          .setDepth(15)
          .setVisible(false),
      )
    }
    this.banner = this.add
      .text(W / 2, H * 0.36, '', { fontFamily: FONT, fontSize: '76px', fontStyle: '800', color: '#ffffff', stroke: '#002FA7', strokeThickness: 12, align: 'center' })
      .setOrigin(0.5)
      .setDepth(20)
      .setVisible(false)
  }

  /** Возвращает мир и героя в исходное состояние (на старте и при рестарте). */
  private resetVisuals() {
    this.visX = 0
    this.finishSlow = 1
    this.heroLift = 0
    this.sqx = this.sqy = 1
    this.dustTimer = 0
    this.tweens.killAll()
    this.cameras.main.resetFX()
    for (const b of this.beans) {
      b.sprite.setVisible(true).setAlpha(1).setScale(0.5)
    }
    for (const p of this.pops) p.setVisible(false)
    this.hero.setAngle(0).setAlpha(1)
    this.hero.anims.stop()
    this.hero.setFrame(ALPACA_FRAMES.run[0])
    this.layout()
  }

  // ───────────────────────── управление из React ─────────────────────────
  /** Начать забег: короткий отсчёт «Готовы? — Бегом!» и поехали. */
  public requestStart() {
    if (this.phase !== 'idle') return
    this.phase = 'countdown'
    this.phaseMs = 0
    this.runId = crypto.randomUUID()
    this.lastHud = ''
    this.setStatus('playing')
    this.inputCtl?.setEnabled(true)
    this.emitHud(true)
  }

  public requestRestart() {
    this.phase = 'idle'
    this.core = this.newCore()
    this.resetVisuals()
    this.banner.setVisible(false)
    this.requestStart()
  }

  public requestResume() {
    if (this.status === 'paused') {
      this.setStatus('playing')
      this.inputCtl?.setEnabled(true)
    }
  }

  public requestPause() {
    this.pauseGame()
  }

  private pauseGame() {
    if (this.status !== 'playing') return
    this.setStatus('paused')
    this.inputCtl?.setEnabled(false)
  }

  private onAction(action: GameAction) {
    if (action === 'pause') {
      if (this.status === 'playing') this.pauseGame()
      else if (this.status === 'paused') this.requestResume()
      return
    }
    if (this.status !== 'playing' || this.phase !== 'running') return
    if (action === 'jump') this.core.jump()
    else this.core.slide()
  }

  // ───────────────────────── кадр ─────────────────────────
  update(time: number, delta: number) {
    const dt = Math.min(delta, RUNNER_CONFIG.maxDeltaMs)
    // анимации, которые живут и на паузе, не двигаем: стоим
    if (this.status === 'paused') {
      this.hero.anims.pause()
      return
    }
    if (this.hero.anims.isPaused) this.hero.anims.resume()

    switch (this.phase) {
      case 'idle':
        this.idlePose()
        break
      case 'countdown':
        this.tickCountdown(dt)
        break
      case 'running':
        this.tickRunning(dt, time)
        break
      case 'dying':
        this.tickDying(dt)
        break
      case 'finishing':
        this.tickFinishing(dt, time)
        break
      default:
        break
    }
    this.relaxSquash(dt)
    this.drawDebug()
  }

  private idlePose() {
    this.hero.anims.stop()
    this.hero.setFrame(ALPACA_FRAMES.run[0])
    this.applyHeroTransform(G)
  }

  private tickCountdown(dt: number) {
    this.phaseMs += dt
    this.idlePose()
    const t = this.phaseMs
    const label = t < COUNTDOWN_MS * 0.55 ? 'Готовы?' : 'Бегом!'
    const local = t < COUNTDOWN_MS * 0.55 ? t / (COUNTDOWN_MS * 0.55) : (t - COUNTDOWN_MS * 0.55) / (COUNTDOWN_MS * 0.45)
    this.banner.setText(label).setVisible(true).setAlpha(1 - Math.max(0, local - 0.7) / 0.3).setScale(0.85 + 0.15 * Math.min(1, local * 3))
    for (const b of this.beans) this.bob(b, t)
    if (t >= COUNTDOWN_MS) {
      this.banner.setVisible(false)
      this.phase = 'running'
      this.phaseMs = 0
      this.hero.play('run')
    }
  }

  private tickRunning(dt: number, time: number) {
    this.core.step(dt)
    this.visX = this.core.worldX
    this.handleEvents(this.core.drainEvents())
    this.layout()
    for (const b of this.beans) this.bob(b, time)

    if (this.phase !== 'running') return // событие hit/finish сменило фазу
    this.syncHero()
    // пыль из-под лап при беге
    this.dustTimer += dt
    if (this.dustTimer > 130 && this.core.state === 'running') {
      this.dustTimer = 0
      this.dust.emitParticleAt(RUNNER_CONFIG.heroX - 18, G - 3, 1)
    }
    this.emitHud(false)
  }

  private tickDying(dt: number) {
    this.phaseMs += dt
    if (this.phaseMs >= DYING_MS) {
      this.phase = 'done'
      this.setStatus('lost')
    }
  }

  private tickFinishing(dt: number, time: number) {
    this.phaseMs += dt
    const p = Math.min(1, this.phaseMs / 900)
    this.finishSlow = 1 - p * p // замедление в ноль
    this.visX += this.core.speed * this.finishSlow * (dt / 1000)
    this.layout()
    for (const b of this.beans) this.bob(b, time)
    this.hero.anims.timeScale = Math.max(0.15, this.finishSlow)
    if (this.finishSlow <= 0.02 && !this.hero.anims.isPaused) {
      this.hero.anims.stop()
      this.hero.setFrame(ALPACA_FRAMES.jumpUp)
    }
    this.applyHeroTransform(G - Math.abs(Math.sin(this.phaseMs / 180)) * (p > 0.9 ? 14 : 0))
    if (this.phaseMs >= FINISHING_MS) {
      this.phase = 'done'
      this.setStatus('won')
    }
  }

  // ───────────────────────── события ядра → эффекты ─────────────────────────
  private handleEvents(events: CoreEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case 'jump':
          this.sqx = 0.82
          this.sqy = 1.22
          this.dust.emitParticleAt(e.x - 8, e.y - 2, 4)
          break
        case 'land': {
          const k = Math.min(1, e.impact / 900)
          this.sqx = 1 + 0.2 * k
          this.sqy = 1 - 0.2 * k
          this.dust.emitParticleAt(e.x - 6, e.y - 2, 3 + Math.round(4 * k))
          if (!this.hero.anims.isPlaying && this.core.state === 'running') this.hero.play('run')
          break
        }
        case 'slideStart':
          this.dust.emitParticleAt(RUNNER_CONFIG.heroX - 10, G - 3, 5)
          break
        case 'bean':
          this.onBean(e.id, e.x, e.y)
          break
        case 'hit':
          this.onHit()
          break
        case 'finish':
          this.onFinish()
          break
        default:
          break
      }
    }
  }

  private onBean(id: string, x: number, y: number) {
    const b = this.beans.find((i) => i.id === id)
    if (b) {
      this.tweens.add({
        targets: b.sprite,
        scale: 1.1,
        alpha: 0,
        duration: 220,
        ease: 'Cubic.easeOut',
        onComplete: () => b.sprite.setVisible(false),
      })
    }
    this.sparks.emitParticleAt(x, y, 7)
    const pop = this.pops.find((p) => !p.visible)
    if (pop) {
      pop.setPosition(x, y - 14).setAlpha(1).setVisible(true)
      this.tweens.add({ targets: pop, y: y - 52, alpha: 0, duration: 520, ease: 'Cubic.easeOut', onComplete: () => pop.setVisible(false) })
    }
  }

  private onHit() {
    this.phase = 'dying'
    this.phaseMs = 0
    this.inputCtl?.setEnabled(false)
    this.hero.anims.stop()
    this.hero.setFrame(ALPACA_FRAMES.hit)
    this.cameras.main.shake(220, 0.014)
    this.cameras.main.flash(120, 255, 255, 255, false)
    this.sparks.emitParticleAt(RUNNER_CONFIG.heroX + 20, this.core.bottom - 40, 10)
    // кувырок: подпрыгивает и падает
    const start = { lift: 0 }
    this.tweens.add({
      targets: start,
      lift: 34,
      duration: 220,
      yoyo: true,
      ease: 'Quad.easeOut',
      onUpdate: () => (this.heroLift = start.lift),
      onComplete: () => (this.heroLift = 0),
    })
    this.tweens.add({ targets: this.hero, angle: -22, duration: 260, ease: 'Back.easeOut' })
    this.finalizeRun(false)
  }

  private onFinish() {
    this.phase = 'finishing'
    this.phaseMs = 0
    this.inputCtl?.setEnabled(false)
    this.confetti.explode(70, W * 0.5, H * 0.2)
    this.confetti.explode(40, W * 0.28, H * 0.25)
    this.cameras.main.flash(180, 255, 244, 214, false)
    this.finalizeRun(true)
  }

  private finalizeRun(completed: boolean) {
    const result: RunnerRunResult = {
      runId: this.runId,
      levelId: RUNNER_CONFIG.levelId,
      beansCollected: this.core.beans,
      durationMs: Math.max(1, Math.round(this.core.playMs)), // только игровое время (без пауз/отсчёта)
      completed,
    }
    this.emitHud(true)
    this.bridge.onRunEnd(result)
  }

  // ───────────────────────── отрисовка ─────────────────────────
  /** Расставляет всё по visX: фон — параллакс, объекты — мировые координаты. */
  private layout() {
    const x = this.visX
    this.clouds.tilePositionX = x * 0.08
    this.far.tilePositionX = x * 0.2
    this.mid.tilePositionX = x * 0.5
    this.near.tilePositionX = x * 0.8
    this.ground.tilePositionX = x
    for (const b of this.beans) b.sprite.x = b.x - x
    for (const c of this.crates) this.place(c, x)
    for (const c of this.banners) this.place(c, x)
    this.place(this.finish, x)
  }

  private place(it: Item, x: number) {
    const sx = it.x - x
    it.sprite.x = sx
    it.sprite.setVisible(sx < W + 40 && sx + it.width > -60)
  }

  private bob(b: Item & { base: number; idx: number }, t: number) {
    if (b.sprite.alpha < 1 || !b.sprite.visible) return
    b.sprite.y = b.base + Math.sin(t / 240 + b.idx * 0.9) * 3
  }

  private syncHero() {
    const c = this.core
    const bottom = c.bottom
    switch (c.state) {
      case 'jumping':
        if (this.hero.anims.isPlaying) this.hero.anims.stop()
        this.hero.setFrame(c.vy < 0 ? ALPACA_FRAMES.jumpUp : ALPACA_FRAMES.jumpDown)
        break
      case 'sliding':
        if (this.hero.anims.currentAnim?.key !== 'slide' || !this.hero.anims.isPlaying) this.hero.play('slide')
        break
      default:
        if (this.hero.anims.currentAnim?.key !== 'run' || !this.hero.anims.isPlaying) this.hero.play('run')
        this.hero.anims.timeScale = c.speed / RUNNER_CONFIG.worldSpeed
    }
    this.applyHeroTransform(bottom)
  }

  private applyHeroTransform(bottom: number) {
    this.hero.setPosition(RUNNER_CONFIG.heroX, bottom - this.heroLift)
    this.hero.setScale(ALPACA_SCALE * this.sqx, ALPACA_SCALE * this.sqy)
  }

  private relaxSquash(dt: number) {
    const k = 1 - Math.exp(-dt / 70)
    this.sqx += (1 - this.sqx) * k
    this.sqy += (1 - this.sqy) * k
  }

  private drawDebug() {
    const g = this.debugG
    if (!g) return
    g.clear()
    const r = this.core.heroRect()
    g.lineStyle(2, 0xff0044, 1).fillStyle(0xff0044, 0.25)
    g.fillRect(r.left, r.top, r.right - r.left, r.bottom - r.top).strokeRect(r.left, r.top, r.right - r.left, r.bottom - r.top)
    g.lineStyle(2, 0xffaa00, 1).fillStyle(0xffaa00, 0.2)
    for (const c of this.crates) {
      const sp = c.sprite as Phaser.GameObjects.TileSprite
      g.fillRect(sp.x, sp.y - sp.height, sp.width, sp.height).strokeRect(sp.x, sp.y - sp.height, sp.width, sp.height)
    }
    g.lineStyle(2, 0x00bbff, 1).fillStyle(0x00bbff, 0.2)
    const gapY = G - RUNNER_CONFIG.bannerGap
    for (const b of this.banners) g.fillRect(b.sprite.x, 0, b.width, gapY).strokeRect(b.sprite.x, 0, b.width, gapY)
  }

  // ───────────────────────── мост к React ─────────────────────────
  private emitHud(force: boolean) {
    const p = this.phase === 'finishing' || this.phase === 'done' ? (this.core.status === 'finished' ? 1 : this.core.progress01) : Math.min(0.99, this.core.progress01)
    const key = `${this.core.beans}|${Math.round(p * 100)}`
    if (!force && key === this.lastHud) return
    this.lastHud = key
    this.bridge.onHud({ beans: this.core.beans, beansTotal: LEVEL_01_BEAN_COUNT, progress01: p, levelName: LEVEL_01_NAME })
  }

  private setStatus(s: GameStatus) {
    this.status = s
    this.bridge.onStatus(s)
  }
}
