import Phaser from 'phaser'
import alpacaUrl from '../assets/alpaca.png'
import crateUrl from '../assets/crate.png'
import bannerUrl from '../assets/banner.png'
import beanUrl from '../assets/bean.png'
import finishUrl from '../assets/finish.png'
import groundUrl from '../assets/ground.png'
import cloudsUrl from '../assets/bg-clouds.png'
import farUrl from '../assets/bg-far.png'
import midUrl from '../assets/bg-mid.png'
import nearUrl from '../assets/bg-near.png'
import { ALPACA_FRAME_SIZE, ALPACA_FRAMES } from '../entities/Alpaca'
import { RUNNER_CONFIG } from '../config'

/** Грузит ассеты (PNG из assets/, локально, без CDN), создаёт анимации и мелкие процедурные текстуры. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  preload() {
    this.load.spritesheet('alpaca', alpacaUrl, { frameWidth: ALPACA_FRAME_SIZE, frameHeight: ALPACA_FRAME_SIZE })
    this.load.image('crate', crateUrl)
    this.load.image('banner', bannerUrl)
    this.load.image('bean', beanUrl)
    this.load.image('finish', finishUrl)
    this.load.image('ground', groundUrl)
    this.load.image('bg-clouds', cloudsUrl)
    this.load.image('bg-far', farUrl)
    this.load.image('bg-mid', midUrl)
    this.load.image('bg-near', nearUrl)
  }

  create() {
    this.makeSky()
    this.makeParticles()
    const a = this.anims
    if (!a.exists('run')) {
      a.create({
        key: 'run',
        frames: a.generateFrameNumbers('alpaca', { frames: [...ALPACA_FRAMES.run] }),
        frameRate: 12,
        repeat: -1,
      })
      a.create({
        key: 'slide',
        frames: a.generateFrameNumbers('alpaca', { frames: [...ALPACA_FRAMES.slide] }),
        frameRate: 10,
        repeat: -1,
      })
    }
    this.scene.start('Runner')
  }

  private makeSky() {
    const { height } = RUNNER_CONFIG
    const sky = this.textures.createCanvas('sky', 4, height)
    if (sky) {
      const ctx = sky.getContext()
      const g = ctx.createLinearGradient(0, 0, 0, height)
      g.addColorStop(0, '#5E9CEA')
      g.addColorStop(0.45, '#A9D0F5')
      g.addColorStop(0.8, '#FBE6C6')
      g.addColorStop(1, '#FDEFD8')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 4, height)
      sky.refresh()
    }
    const sun = this.textures.createCanvas('sun', 320, 320)
    if (sun) {
      const ctx = sun.getContext()
      const g = ctx.createRadialGradient(160, 160, 8, 160, 160, 160)
      g.addColorStop(0, 'rgba(255,248,214,1)')
      g.addColorStop(0.25, 'rgba(255,240,190,0.85)')
      g.addColorStop(1, 'rgba(255,240,190,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 320, 320)
      sun.refresh()
    }
  }

  private makeParticles() {
    const dust = this.textures.createCanvas('dust', 32, 32)
    if (dust) {
      const ctx = dust.getContext()
      const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 16)
      g.addColorStop(0, 'rgba(255,255,255,0.95)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 32, 32)
      dust.refresh()
    }
    const spark = this.textures.createCanvas('spark', 24, 24)
    if (spark) {
      const ctx = spark.getContext()
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.moveTo(12, 0)
      ctx.lineTo(15, 9)
      ctx.lineTo(24, 12)
      ctx.lineTo(15, 15)
      ctx.lineTo(12, 24)
      ctx.lineTo(9, 15)
      ctx.lineTo(0, 12)
      ctx.lineTo(9, 9)
      ctx.closePath()
      ctx.fill()
      spark.refresh()
    }
    const conf = this.textures.createCanvas('confetti', 10, 16)
    if (conf) {
      const ctx = conf.getContext()
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, 10, 16)
      conf.refresh()
    }
  }
}
