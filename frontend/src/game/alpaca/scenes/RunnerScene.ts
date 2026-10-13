import Phaser from 'phaser'
import { RUNNER_CONFIG } from '../config'
import {
  LEVEL_01_BEAN_COUNT,
  LEVEL_01_LENGTH,
  LEVEL_01_NAME,
  LEVEL_01_OBJECTS,
} from '../level01'
import type { AlpacaState, GameBridge, GameStatus, RunnerRunResult } from '../types'
import { InputController } from '../systems/InputController'
import { overlap as rectOverlap } from '../systems/CollisionSystem'

type SpriteRec = {
  id: string
  kind: 'bean' | 'crate' | 'overhead' | 'finish'
  sprite: Phaser.GameObjects.Image
  w: number
  h: number
  collected?: boolean
}

export class RunnerScene extends Phaser.Scene {
  private bridge!: GameBridge
  private status: GameStatus = 'loading'
  private alpacaState: AlpacaState = 'running'
  private inputCtl: InputController | null = null

  private worldX = 0
  private distance = 0
  private beans = 0
  private runStartedAt = 0
  private runId = ''
  private ended = false

  private jumpElapsed = 0
  private slideElapsed = 0
  private alpacaY: number = RUNNER_CONFIG.groundY
  private hitboxH = 50
  private hitboxW = 36

  private alpaca!: Phaser.GameObjects.Image
  private objects: SpriteRec[] = []
  private farTiles: Phaser.GameObjects.TileSprite | null = null
  private nearTiles: Phaser.GameObjects.TileSprite | null = null
  private ground!: Phaser.GameObjects.TileSprite

  constructor() {
    super('Runner')
  }

  create() {
    this.bridge = this.game.registry.get('bridge') as GameBridge
    this.setStatus('loading')
    this.buildWorld()
    this.resetRun(false)
    this.inputCtl = new InputController(this.game.canvas, (a) => this.onAction(a))
    this.setStatus('playing')
    this.runStartedAt = performance.now()
    this.runId = crypto.randomUUID()

    this.game.events.on('visibility-pause', () => {
      if (this.status === 'playing') this.pauseGame()
    })
  }

  private buildWorld() {
    const { width, height, groundY } = RUNNER_CONFIG
    this.farTiles = this.add.tileSprite(0, height * 0.35, width * 2, 200, 'bg-far').setOrigin(0, 0.5)
    this.nearTiles = this.add.tileSprite(0, groundY - 20, width * 2, 80, 'bg-near').setOrigin(0, 1)
    this.ground = this.add.tileSprite(0, groundY + 16, width * 2, 64, 'ground').setOrigin(0, 0)

    this.alpaca = this.add.image(160, groundY, 'alpaca-run').setOrigin(0.5, 1)
    this.alpaca.setDepth(10)

    for (const o of LEVEL_01_OBJECTS) {
      if (o.type === 'bean') {
        const s = this.add.image(o.x, o.y, 'bean').setOrigin(0.5, 0.5)
        this.objects.push({ id: o.id, kind: 'bean', sprite: s, w: 18, h: 22 })
      } else if (o.type === 'crate') {
        const s = this.add.image(o.x, groundY, 'crate').setOrigin(0, 1).setDisplaySize(o.width, o.height)
        this.objects.push({ id: o.id, kind: 'crate', sprite: s, w: o.width, h: o.height })
      } else if (o.type === 'overhead') {
        const top = groundY - 110
        const s = this.add.image(o.x, top, 'overhead').setOrigin(0, 0).setDisplaySize(o.width, o.height)
        this.objects.push({ id: o.id, kind: 'overhead', sprite: s, w: o.width, h: o.height })
      } else if (o.type === 'finish') {
        const s = this.add.image(o.x, groundY, 'finish').setOrigin(0, 1)
        this.objects.push({ id: o.id, kind: 'finish', sprite: s, w: 40, h: 160 })
      }
    }
  }

  private resetRun(notifyPlaying: boolean) {
    this.ended = false
    this.worldX = 0
    this.distance = 0
    this.beans = 0
    this.alpacaState = 'running'
    this.jumpElapsed = 0
    this.slideElapsed = 0
    this.hitboxH = 50
    this.hitboxW = 36
    this.alpacaY = RUNNER_CONFIG.groundY
    this.runId = crypto.randomUUID()
    this.runStartedAt = performance.now()

    for (const o of this.objects) {
      o.collected = false
      o.sprite.setVisible(true)
      o.sprite.setActive(true)
      // restore world-relative positions from level data
      const src = LEVEL_01_OBJECTS.find((x) => x.id === o.id)
      if (!src) continue
      if (src.type === 'bean') {
        o.sprite.setPosition(src.x, src.y)
      } else if (src.type === 'crate' || src.type === 'finish') {
        o.sprite.setPosition(src.x, RUNNER_CONFIG.groundY)
      } else if (src.type === 'overhead') {
        o.sprite.setPosition(src.x, RUNNER_CONFIG.groundY - 110)
      }
    }
    this.alpaca.setTexture('alpaca-run')
    this.alpaca.setPosition(160, RUNNER_CONFIG.groundY)
    this.cameras.main.scrollX = 0
    this.emitHud()
    if (notifyPlaying) {
      this.setStatus('playing')
      this.inputCtl?.setEnabled(true)
    }
  }

  /** Called from React overlay */
  public requestRestart() {
    this.resetRun(true)
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

  private onAction(action: 'jump' | 'slide' | 'pause') {
    if (action === 'pause') {
      if (this.status === 'playing') this.pauseGame()
      else if (this.status === 'paused') this.requestResume()
      return
    }
    if (this.status !== 'playing') return
    if (this.alpacaState !== 'running') return
    if (action === 'jump') {
      this.alpacaState = 'jumping'
      this.jumpElapsed = 0
      this.alpaca.setTexture('alpaca-jump')
    } else if (action === 'slide') {
      this.alpacaState = 'sliding'
      this.slideElapsed = 0
      this.hitboxH = 28
      this.hitboxW = 48
      this.alpaca.setTexture('alpaca-slide')
    }
  }

  update(_t: number, delta: number) {
    if (this.status !== 'playing' || this.ended) return
    const d = Math.min(delta, RUNNER_CONFIG.maxDeltaMs)
    const dist = RUNNER_CONFIG.worldSpeed * (d / 1000)
    this.distance += dist
    this.worldX += dist

    // Move world objects left (camera fixed, world scrolls)
    for (const o of this.objects) {
      o.sprite.x -= dist
    }
    this.farTiles && (this.farTiles.tilePositionX += dist * 0.3)
    this.nearTiles && (this.nearTiles.tilePositionX += dist * 0.6)
    this.ground.tilePositionX += dist

    // Jump arc
    if (this.alpacaState === 'jumping') {
      this.jumpElapsed += d
      const progress = Math.min(1, this.jumpElapsed / RUNNER_CONFIG.jumpDurationMs)
      const jumpOffset = RUNNER_CONFIG.jumpHeight * 4 * progress * (1 - progress)
      this.alpacaY = RUNNER_CONFIG.groundY - jumpOffset
      this.alpaca.y = this.alpacaY
      if (progress >= 1) {
        this.alpacaState = 'running'
        this.alpacaY = RUNNER_CONFIG.groundY
        this.alpaca.y = this.alpacaY
        this.alpaca.setTexture('alpaca-run')
      }
    } else if (this.alpacaState === 'sliding') {
      this.slideElapsed += d
      this.alpaca.y = RUNNER_CONFIG.groundY
      if (this.slideElapsed >= RUNNER_CONFIG.slideDurationMs) {
        this.alpacaState = 'running'
        this.hitboxH = 50
        this.hitboxW = 36
        this.alpaca.setTexture('alpaca-run')
      }
    } else {
      this.alpaca.y = RUNNER_CONFIG.groundY
    }

    this.checkBeans()
    if (!this.ended) this.checkObstacles()
    if (!this.ended) this.checkFinish()
    this.emitHud()
  }

  private alpacaRect() {
    const bottom = this.alpaca.y
    const top = bottom - this.hitboxH
    const left = this.alpaca.x - this.hitboxW / 2
    return { left, right: left + this.hitboxW, top, bottom }
  }

  private checkBeans() {
    const a = this.alpacaRect()
    for (const o of this.objects) {
      if (o.kind !== 'bean' || o.collected || !o.sprite.visible) continue
      const b = this.bounds(o)
      if (this.overlap(a, b)) {
        o.collected = true
        o.sprite.setVisible(false)
        this.beans += 1
      }
    }
  }

  private checkObstacles() {
    const a = this.alpacaRect()
    for (const o of this.objects) {
      if (o.kind === 'crate') {
        const b = this.bounds(o)
        if (this.overlap(a, b)) {
          this.finishRun(false)
          return
        }
      } else if (o.kind === 'overhead') {
        if (this.alpacaState === 'sliding') continue
        const b = this.bounds(o)
        // Only head-height collision when not sliding
        if (this.overlap(a, b)) {
          this.finishRun(false)
          return
        }
      }
    }
  }

  private checkFinish() {
    const fin = this.objects.find((o) => o.kind === 'finish')
    if (!fin) return
    const a = this.alpacaRect()
    const b = this.bounds(fin)
    if (a.right >= b.left) {
      this.finishRun(true)
    }
  }

  private bounds(o: SpriteRec) {
    const s = o.sprite
    const left = s.x - (s.originX * o.w)
    const top = s.y - (s.originY * o.h)
    return { left, right: left + o.w, top, bottom: top + o.h }
  }

  private overlap = rectOverlap

  private finishRun(completed: boolean) {
    if (this.ended) return
    this.ended = true
    this.alpacaState = completed ? 'finished' : 'hit'
    this.inputCtl?.setEnabled(false)
    const durationMs = Math.max(1, Math.round(performance.now() - this.runStartedAt))
    const result: RunnerRunResult = {
      runId: this.runId,
      levelId: RUNNER_CONFIG.levelId,
      beansCollected: this.beans,
      durationMs,
      completed,
    }
    this.setStatus(completed ? 'won' : 'lost')
    this.bridge.onRunEnd(result)
  }

  private emitHud() {
    const progress01 = Math.min(0.99, this.distance / LEVEL_01_LENGTH)
    const p = this.ended && this.status === 'won' ? 1 : progress01
    this.bridge.onHud({
      beans: this.beans,
      progress01: p,
      levelName: LEVEL_01_NAME,
    })
  }

  private setStatus(s: GameStatus) {
    this.status = s
    this.bridge.onStatus(s)
  }

  shutdown() {
    this.inputCtl?.destroy()
    this.inputCtl = null
  }
}
