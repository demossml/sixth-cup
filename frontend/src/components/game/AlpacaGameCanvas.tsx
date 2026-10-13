import { useEffect, useRef } from 'react'
import Phaser from 'phaser'
import { createRunnerConfig } from '../../game/alpaca/createGame'
import type { GameBridge, GameStatus, GameHudSnapshot, RunnerRunResult } from '../../game/alpaca/types'
import type { RunnerScene } from '../../game/alpaca/scenes/RunnerScene'

type Props = {
  onStatus: (s: GameStatus) => void
  onHud: (h: GameHudSnapshot) => void
  onRunEnd: (r: RunnerRunResult) => void
  sceneRef: React.MutableRefObject<RunnerScene | null>
}

export function AlpacaGameCanvas({ onStatus, onHud, onRunEnd, sceneRef }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const cbRef = useRef({ onStatus, onHud, onRunEnd })
  cbRef.current = { onStatus, onHud, onRunEnd }

  useEffect(() => {
    const host = hostRef.current
    if (!host || gameRef.current) return

    const bridge: GameBridge = {
      onStatus: (s) => cbRef.current.onStatus(s),
      onHud: (h) => cbRef.current.onHud(h),
      onRunEnd: (r) => cbRef.current.onRunEnd(r),
    }

    let game: Phaser.Game
    try {
      game = new Phaser.Game(createRunnerConfig(host, bridge))
    } catch (e) {
      cbRef.current.onStatus('error')
      console.error('[runner] Phaser failed', e)
      return
    }
    gameRef.current = game

    const onVis = () => {
      if (document.hidden) game.events.emit('visibility-pause')
    }
    document.addEventListener('visibilitychange', onVis)

    game.events.once('ready', () => {
      const scene = game.scene.getScene('Runner') as RunnerScene | null
      sceneRef.current = scene
    })
    // scene available after Boot → Runner
    const t = window.setInterval(() => {
      const scene = game.scene.getScene('Runner') as RunnerScene | null
      if (scene?.sys?.isActive()) {
        sceneRef.current = scene
        window.clearInterval(t)
      }
    }, 100)

    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
      sceneRef.current = null
      game.destroy(true)
      gameRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={hostRef}
      className="w-full max-w-3xl mx-auto rounded-2xl overflow-hidden border border-line bg-[#87B5E8] touch-none"
      style={{ aspectRatio: '16 / 9' }}
    />
  )
}
