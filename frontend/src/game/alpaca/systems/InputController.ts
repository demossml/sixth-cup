import type { GameAction } from '../types'
import { RUNNER_CONFIG } from '../config'

type Handler = (action: GameAction) => void

/**
 * Клавиатура + касания → jump | slide | pause.
 *  • тап / Space / ↑ / W — прыжок; свайп вверх — прыжок
 *  • свайп вниз / ↓ / S — скольжение (срабатывает сразу при движении пальца, без отрыва)
 *  • Esc / P — пауза
 */
export class InputController {
  private enabled = true
  private ptr: { id: number; x: number; y: number; t: number; fired: boolean } | null = null
  private readonly target: HTMLElement
  private readonly onAction: Handler

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.repeat) return
    const k = e.code
    if (k === 'Space' || k === 'ArrowUp' || k === 'KeyW') {
      if (this.isFormTarget(e)) return
      e.preventDefault()
      this.emit('jump')
    } else if (k === 'ArrowDown' || k === 'KeyS') {
      e.preventDefault()
      this.emit('slide')
    } else if (k === 'Escape' || k === 'KeyP') {
      e.preventDefault()
      this.onAction('pause')
    }
  }

  private readonly onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    this.ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), fired: false }
    try {
      this.target.setPointerCapture(e.pointerId)
    } catch {
      /* не критично */
    }
  }

  private readonly onMove = (e: PointerEvent) => {
    const p = this.ptr
    if (!p || p.fired || e.pointerId !== p.id) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    const th = RUNNER_CONFIG.swipeThresholdPx
    if (Math.abs(dy) >= th && Math.abs(dy) > Math.abs(dx)) {
      p.fired = true
      this.emit(dy > 0 ? 'slide' : 'jump')
    }
  }

  private readonly onUp = (e: PointerEvent) => {
    const p = this.ptr
    if (!p || e.pointerId !== p.id) return
    this.ptr = null
    if (p.fired) return
    const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y)
    if (moved < RUNNER_CONFIG.swipeThresholdPx && performance.now() - p.t < 450) this.emit('jump')
  }

  private readonly onCancel = () => {
    this.ptr = null
  }

  private readonly onCtx = (e: Event) => e.preventDefault()
  private readonly onTouchMove = (e: TouchEvent) => e.preventDefault()

  constructor(target: HTMLElement, onAction: Handler) {
    this.target = target
    this.onAction = onAction
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('blur', this.onCancel)
    target.addEventListener('pointerdown', this.onDown)
    target.addEventListener('pointermove', this.onMove)
    target.addEventListener('pointerup', this.onUp)
    target.addEventListener('pointercancel', this.onCancel)
    target.addEventListener('contextmenu', this.onCtx)
    // игра не должна скроллить страницу
    target.addEventListener('touchmove', this.onTouchMove, { passive: false })
  }

  setEnabled(v: boolean) {
    this.enabled = v
    if (!v) this.ptr = null
  }

  private isFormTarget(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON')
  }

  private emit(a: GameAction) {
    if (this.enabled) this.onAction(a)
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('blur', this.onCancel)
    const t = this.target
    t.removeEventListener('pointerdown', this.onDown)
    t.removeEventListener('pointermove', this.onMove)
    t.removeEventListener('pointerup', this.onUp)
    t.removeEventListener('pointercancel', this.onCancel)
    t.removeEventListener('contextmenu', this.onCtx)
    t.removeEventListener('touchmove', this.onTouchMove)
  }
}
