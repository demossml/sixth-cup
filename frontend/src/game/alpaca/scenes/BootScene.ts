import Phaser from 'phaser'

/** Generate replaceable placeholder textures (no external CDN). */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  preload() {
    // Procedural textures — SVG-like placeholders without network
    this.makeTex('ground', 64, 32, (g) => {
      g.fillStyle(0x5a4632, 1)
      g.fillRect(0, 0, 64, 32)
      g.fillStyle(0x6e563c, 1)
      g.fillRect(0, 0, 64, 8)
    })
    this.makeTex('alpaca-run', 48, 56, (g) => this.drawAlpaca(g, 48, 56, false, false))
    this.makeTex('alpaca-jump', 48, 56, (g) => this.drawAlpaca(g, 48, 56, true, false))
    this.makeTex('alpaca-slide', 56, 36, (g) => this.drawAlpaca(g, 56, 36, false, true))
    this.makeTex('bean', 20, 24, (g) => {
      g.fillStyle(0x4a2c0a, 1)
      g.fillEllipse(10, 12, 16, 20)
      g.lineStyle(2, 0x2a1805, 1)
      g.lineBetween(10, 4, 10, 20)
    })
    this.makeTex('crate', 56, 56, (g) => {
      g.fillStyle(0xc4a574, 1)
      g.fillRoundedRect(0, 0, 56, 56, 4)
      g.lineStyle(2, 0x8b6914, 1)
      g.strokeRoundedRect(2, 2, 52, 52, 4)
      g.lineBetween(8, 8, 48, 48)
      g.lineBetween(48, 8, 8, 48)
    })
    this.makeTex('overhead', 120, 36, (g) => {
      g.fillStyle(0x002fa7, 1)
      g.fillRoundedRect(0, 0, 120, 36, 6)
      g.fillStyle(0xffffff, 1)
      g.fillRect(10, 14, 100, 8)
    })
    this.makeTex('finish', 40, 160, (g) => {
      g.fillStyle(0x002fa7, 1)
      g.fillRect(0, 0, 12, 160)
      g.fillRect(28, 0, 12, 160)
      g.fillStyle(0xffffff, 1)
      g.fillRect(8, 8, 24, 40)
      g.fillStyle(0x002fa7, 1)
    })
    this.makeTex('bg-far', 320, 200, (g) => {
      g.fillStyle(0x9ec9f0, 1)
      g.fillRect(0, 0, 320, 200)
      g.fillStyle(0x7a9bb8, 1)
      g.fillRect(20, 80, 60, 120)
      g.fillRect(100, 60, 80, 140)
      g.fillRect(220, 90, 70, 110)
    })
    this.makeTex('bg-near', 200, 80, (g) => {
      g.fillStyle(0x6b8f71, 1)
      g.fillEllipse(40, 70, 100, 40)
      g.fillEllipse(140, 75, 120, 50)
    })
  }

  create() {
    this.scene.start('Runner')
  }

  private makeTex(key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) {
    const g = this.make.graphics({ x: 0, y: 0 })
    draw(g)
    g.generateTexture(key, w, h)
    g.destroy()
  }

  private drawAlpaca(
    g: Phaser.GameObjects.Graphics,
    w: number,
    h: number,
    jump: boolean,
    slide: boolean,
  ) {
    const bodyY = slide ? h * 0.45 : h * 0.4
    const bodyH = slide ? h * 0.45 : h * 0.5
    g.fillStyle(0xffffff, 1)
    g.fillEllipse(w * 0.5, bodyY, w * 0.7, bodyH)
    g.fillCircle(w * 0.72, h * (slide ? 0.35 : 0.28), w * 0.18)
    g.fillStyle(0x002fa7, 1)
    g.fillCircle(w * 0.78, h * (slide ? 0.32 : 0.25), 3)
    if (!slide) {
      g.fillStyle(0xffffff, 1)
      g.fillTriangle(w * 0.65, h * 0.12, w * 0.72, h * 0.02, w * 0.78, h * 0.14)
      g.fillTriangle(w * 0.78, h * 0.12, w * 0.85, h * 0.02, w * 0.9, h * 0.14)
    }
    if (jump) {
      g.fillStyle(0xffffff, 0.5)
      g.fillEllipse(w * 0.3, h * 0.85, 12, 6)
    }
  }
}
