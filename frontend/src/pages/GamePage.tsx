import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlpacaGameCanvas } from '../components/game/AlpacaGameCanvas'
import { GameOverlay } from '../components/game/GameOverlay'
import { LEVEL_01_BEAN_COUNT, LEVEL_01_NAME } from '../game/alpaca/level01'
import type { GameHudSnapshot, GameStatus, RunnerRunResult } from '../game/alpaca/types'
import type { RunnerScene } from '../game/alpaca/scenes/RunnerScene'
import { enqueueRunner, flushRunnerQueue } from '../lib/runnerQueue'
import { runnerApi } from '../lib/runnerApi'

const TIP_KEY = 'sc_runner_tip_v1'
const emptyHud: GameHudSnapshot = { beans: 0, beansTotal: LEVEL_01_BEAN_COUNT, progress01: 0, levelName: LEVEL_01_NAME }

function tipSeen(): boolean {
  try {
    return localStorage.getItem(TIP_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Phaser 2D runner — только статистика, бонусы/кэшбэк не начисляются.
 * В режиме игры контейнер fixed на весь viewport (поверх нижней навигации).
 */
export default function GamePage() {
  const nav = useNavigate()
  const [started, setStarted] = useState(false)
  const [status, setStatus] = useState<GameStatus>('intro')
  const [hud, setHud] = useState<GameHudSnapshot>(emptyHud)
  const [lastBeans, setLastBeans] = useState(0)
  const [saveMsg, setSaveMsg] = useState('')
  const [showTip, setShowTip] = useState(false)
  const [isFs, setIsFs] = useState(false)
  const [portrait, setPortrait] = useState(false)
  const [portraitDismissed, setPortraitDismissed] = useState(false)
  const sceneRef = useRef<RunnerScene | null>(null)
  const hudRef = useRef(emptyHud)

  const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled

  // HUD: React обновляется только при смене зёрен / процента (сцена уже троттлит)
  const onHud = useCallback((h: GameHudSnapshot) => {
    hudRef.current = h
    setHud(h)
  }, [])

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
      setSaveMsg('Нет сети — результат сохранится позже (только статистика, без бонусов)')
    }
  }, [])

  const onRunEnd = useCallback(
    (r: RunnerRunResult) => {
      setLastBeans(r.beansCollected)
      void saveRun(r)
    },
    [saveRun],
  )

  // Сцена готова → показать подсказку первого забега или сразу стартовать
  useEffect(() => {
    if (status !== 'ready') return
    if (tipSeen()) {
      sceneRef.current?.requestStart()
    } else {
      setShowTip(true)
    }
  }, [status])

  const tipDone = () => {
    try {
      localStorage.setItem(TIP_KEY, '1')
    } catch {
      /* ок */
    }
    setShowTip(false)
    sceneRef.current?.requestStart()
  }

  // Во время игры страница не скроллится
  useEffect(() => {
    if (!started) return
    const b = document.body
    const prev = { overflow: b.style.overflow, overscroll: b.style.overscrollBehavior }
    b.style.overflow = 'hidden'
    b.style.overscrollBehavior = 'none'
    return () => {
      b.style.overflow = prev.overflow
      b.style.overscrollBehavior = prev.overscroll
    }
  }, [started])

  // Полный экран и ориентация
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    const mq = window.matchMedia('(orientation: portrait)')
    const onMq = () => setPortrait(mq.matches)
    onMq()
    mq.addEventListener('change', onMq)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      mq.removeEventListener('change', onMq)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        return
      }
      await document.documentElement.requestFullscreen()
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
      await o.lock?.('landscape').catch(() => {})
    } catch {
      /* браузер отказал — игра остаётся в «почти полном» режиме */
    }
  }

  const leave = () => nav('/more')

  if (!started) {
    return (
      <div className="pb-8 px-4" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center justify-between mb-3">
          <Link to="/more" className="text-brand text-sm font-medium no-underline">
            Назад
          </Link>
          <span className="text-xs text-ink-secondary">Без начисления бонусов</span>
        </div>
        <div className="rounded-3xl bg-brand text-white p-5 shadow-lift">
          <h1 className="font-display text-2xl font-bold mb-1">Приключения ламы</h1>
          <p className="text-brand-sub text-[15px] mb-4">
            Лама бежит по утреннему кофейному городу. Собирай зёрна, перепрыгивай ящики (или запрыгивай на них) и
            проскальзывай под баннерами 6.7.
          </p>
          <ul className="text-sm text-brand-sub space-y-1 mb-5 [@media(max-height:420px)]:hidden">
            <li>Тап или свайп вверх — прыжок</li>
            <li>Свайп вниз — скольжение</li>
            <li>Лучше играть, повернув телефон горизонтально</li>
          </ul>
          <button
            type="button"
            className="w-full h-12 rounded-2xl bg-white text-brand font-semibold text-base active:bg-brand-tint"
            onClick={() => {
              setStatus('loading')
              setStarted(true)
            }}
          >
            Играть
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden" style={{ background: '#A9D0F5', height: '100dvh' }}>
      <AlpacaGameCanvas sceneRef={sceneRef} onStatus={setStatus} onHud={onHud} onRunEnd={onRunEnd} />
      <GameOverlay
        status={status}
        hud={hud}
        lastBeans={lastBeans}
        saveMsg={saveMsg}
        showTip={showTip}
        canFullscreen={canFullscreen}
        isFullscreen={isFs}
        onPlay={() => {
          setStarted(false)
          setTimeout(() => {
            setStatus('loading')
            setStarted(true)
          }, 0)
        }}
        onTipDone={tipDone}
        onResume={() => sceneRef.current?.requestResume()}
        onRestart={() => sceneRef.current?.requestRestart()}
        onMenu={leave}
        onPause={() => sceneRef.current?.requestPause()}
        onFullscreen={() => void toggleFullscreen()}
      />
      {portrait && !portraitDismissed && (status === 'playing' || status === 'ready') && !showTip && (
        <button
          type="button"
          onClick={() => setPortraitDismissed(true)}
          className="absolute left-1/2 -translate-x-1/2 bottom-6 z-20 px-4 h-11 rounded-2xl bg-brand text-white text-sm font-medium shadow-lift"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          Переверните телефон — так удобнее
        </button>
      )}
    </div>
  )
}
