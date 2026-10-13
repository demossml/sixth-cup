import type { GameAction } from '../types'
import { RUNNER_CONFIG } from '../config'

type Handler = (action: GameAction) => void

/**
 * Unified keyboard + touch → jump | slide | pause.
 */
export class InputController {
  private onAction: Handler
  private enabled = true
  private ptrStart: { x: number; y: number; t: number } | null = null
  private keyHandler: ((e: KeyboardEvent) => void) | null = null
  private boundDown: ((e: PointerEvent) => void) | null = null
  private boundUp: ((e: PointerEvent) => void) | null = null
  private boundCancel: (() => void) | null = null
  private target: HTMLElement | Window

  constructor(target: HTMLElement | Window, onAction: Handler) {
    this.target = target
    this.onAction = onAction
    this.attach()
  }

  setEnabled(v: boolean) {
    this.enabled = v
  }

  private emit(a: GameAction) {
    if (!this.enabled) return
    this.onAction(a)
  }

  private attach() {
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault()
        this.emit('jump')
      } else if (e.code === 'ArrowDown') {
        e.preventDefault()
        this.emit('slide')
      } else if (e.code === 'Escape') {
        e.preventDefault()
        this.emit('pause')
      }
    }
    window.addEventListener('keydown', this.keyHandler)

    this.boundDown = (e: PointerEvent) => {
      this.ptrStart = { x: e.clientX, y: e.clientY, t: Date.now() }
    }
    this.boundUp = (e: PointerEvent) => {
      if (!this.ptrStart) return
      const dx = e.clientX - this.ptrStart.x
      const dy = e.clientY - this.ptrStart.y
      const dt = Date.now() - this.ptrStart.t
      this.ptrStart = null
      if (dy > RUNNER_CONFIG.swipeThresholdPx && Math.abs(dy) > Math.abs(dx)) {
        this.emit('slide')
        return
      }
      if (Math.hypot(dx, dy) < RUNNER_CONFIG.swipeThresholdPx && dt < 400) {
        this.emit('jump')
      }
    }
    this.boundCancel = () => {
      this.ptrStart = null
    }
    const el = this.target === window ? window : (this.target as HTMLElement)
    el.addEventListener('pointerdown', this.boundDown as EventListener)
    el.addEventListener('pointerup', this.boundUp as EventListener)
    el.addEventListener('pointercancel', this.boundCancel as EventListener)
    window.addEventListener('blur', this.boundCancel)
  }

  destroy() {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler)
    const el = this.target === window ? window : (this.target as HTMLElement)
    if (this.boundDown) el.removeEventListener('pointerdown', this.boundDown as EventListener)
    if (this.boundUp) el.removeEventListener('pointerup', this.boundUp as EventListener)
    if (this.boundCancel) {
      el.removeEventListener('pointercancel', this.boundCancel as EventListener)
      window.removeEventListener('blur', this.boundCancel)
    }
    this.keyHandler = null
    this.boundDown = null
    this.boundUp = null
    this.boundCancel = null
  }
}
