import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlpacaGameCanvas } from '../components/game/AlpacaGameCanvas'
import { GameOverlay } from '../components/game/GameOverlay'
import type { GameHudSnapshot, GameStatus, RunnerRunResult } from '../game/alpaca/types'
import type { RunnerScene } from '../game/alpaca/scenes/RunnerScene'
import { enqueueRunner, flushRunnerQueue } from '../lib/runnerQueue'
import { runnerApi } from '../lib/runnerApi'

const emptyHud: GameHudSnapshot = { beans: 0, progress01: 0, levelName: 'Утренний кофейный город' }

/**
 * Phaser 2D runner — no loyalty rewards in this release.
 * Old card mini-game claim endpoints are not called.
 */
export default function GamePage() {
  const nav = useNavigate()
  const [started, setStarted] = useState(false)
  const [status, setStatus] = useState<GameStatus>('intro')
  const [hud, setHud] = useState<GameHudSnapshot>(emptyHud)
  const [lastBeans, setLastBeans] = useState(0)
  const [saveMsg, setSaveMsg] = useState('')
  const sceneRef = useRef<RunnerScene | null>(null)

  const saveRun = useCallback(async (r: RunnerRunResult) => {
    setSaveMsg('')
    try {
      await runnerApi.submitRun(r)
      setSaveMsg('Результат сохранён')
      await flushRunnerQueue(async (body) => {
        await runnerApi.submitRun(body)
      })
    } catch {
      enqueueRunner(r)
      setSaveMsg('Нет сети — результат в очереди (только статистика, без бонусов)')
    }
  }, [])

  const onRunEnd = useCallback(
    (r: RunnerRunResult) => {
      setLastBeans(r.beansCollected)
      void saveRun(r)
    },
    [saveRun],
  )

  return (
    <div className="pb-8" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
      <div className="px-4 flex items-center justify-between mb-2">
        <Link to="/more" className="text-brand text-sm font-medium no-underline">
          Назад
        </Link>
        <span className="text-xs text-ink-secondary">Без начисления бонусов</span>
      </div>

      <div className="px-4 relative">
        {!started ? (
          <div className="relative rounded-2xl border border-line bg-white min-h-[240px] flex items-center">
            <GameOverlay
              status="intro"
              hud={emptyHud}
              lastBeans={0}
              onPlay={() => {
                setStarted(true)
                setStatus('loading')
              }}
              onResume={() => {}}
              onRestart={() => {}}
              onMenu={() => nav('/more')}
              onPause={() => {}}
            />
          </div>
        ) : (
          <div className="relative">
            <AlpacaGameCanvas
              sceneRef={sceneRef}
              onStatus={setStatus}
              onHud={setHud}
              onRunEnd={onRunEnd}
            />
            <GameOverlay
              status={status}
              hud={hud}
              lastBeans={lastBeans}
              saveMsg={saveMsg}
              onPlay={() => sceneRef.current?.requestRestart()}
              onResume={() => sceneRef.current?.requestResume()}
              onRestart={() => sceneRef.current?.requestRestart()}
              onMenu={() => nav('/more')}
              onPause={() => sceneRef.current?.requestPause()}
            />
          </div>
        )}
      </div>
    </div>
  )
}
