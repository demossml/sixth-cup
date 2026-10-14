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
  levelId: string
}

/** Один Phaser-инстанс на монтирование; занимает всего родителя (родитель — почти весь viewport). */
export function AlpacaGameCanvas({ onStatus, onHud, onRunEnd, sceneRef, levelId }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const cbRef = useRef({ onStatus, onHud, onRunEnd })
  cbRef.current = { onStatus, onHud, onRunEnd }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const bridge: GameBridge = {
      onStatus: (s) => cbRef.current.onStatus(s),
      onHud: (h) => cbRef.current.onHud(h),
      onRunEnd: (r) => cbRef.current.onRunEnd(r),
      onScene: (s) => {
        sceneRef.current = s
      },
    }

    let game: Phaser.Game
    try {
      game = new Phaser.Game(createRunnerConfig(host, bridge, levelId))
    } catch (e) {
      cbRef.current.onStatus('error')
      console.error('[runner] Phaser failed', e)
      return
    }

    const onVis = () => {
      if (document.hidden) game.events.emit('visibility-pause')
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      sceneRef.current = null
      game.destroy(true) // снимает canvas, WebGL-контекст и слушатели; повторный вход создаёт новый инстанс
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelId])

  return <div ref={hostRef} className="absolute inset-0 touch-none select-none" style={{ touchAction: 'none' }} />
}
