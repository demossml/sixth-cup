import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlpacaGameCanvas } from '../components/game/AlpacaGameCanvas'
import { GameOverlay } from '../components/game/GameOverlay'
import { RUNNER_LEVELS, DEFAULT_LEVEL } from '../game/alpaca/levels'
import type { GameHudSnapshot, GameStatus, RunnerRunResult } from '../game/alpaca/types'
import type { RunnerScene } from '../game/alpaca/scenes/RunnerScene'
import { enqueueRunner, flushRunnerQueue } from '../lib/runnerQueue'
import { runnerApi, type RunnerLevelMeta } from '../lib/runnerApi'

const TIP_PREFIX = 'sc_runner_tip_'
const emptyHud: GameHudSnapshot = { beans: 0, beansTotal: DEFAULT_LEVEL.beansTotal, progress01: 0, levelName: DEFAULT_LEVEL.name }
function tipSeen(levelId: string): boolean {
  try { return localStorage.getItem(`${TIP_PREFIX}${levelId}`) === '1' } catch { return false }
}

/** Прогресс раннера отделён от лояльности чека: только звёзды, рекорды и разблокировка. */
export default function GamePage() {
  const nav = useNavigate()
  const [started, setStarted] = useState(false)
  const [selectedLevelId, setSelectedLevelId] = useState(DEFAULT_LEVEL.id)
  const [status, setStatus] = useState<GameStatus>('intro')
  const [hud, setHud] = useState<GameHudSnapshot>(emptyHud)
  const [lastBeans, setLastBeans] = useState(0)
  const [lastStars, setLastStars] = useState(0)
  const [saveMsg, setSaveMsg] = useState('')
  const [showTip, setShowTip] = useState(false)
  const [isFs, setIsFs] = useState(false)
  const [portrait, setPortrait] = useState(false)
  const [portraitDismissed, setPortraitDismissed] = useState(false)
  const [meta, setMeta] = useState<RunnerLevelMeta[]>([])
  const [streakDays, setStreakDays] = useState(0)
  const [recentRuns, setRecentRuns] = useState<{ levelId: string; levelName: string; beansCollected: number; durationMs: number; completed: boolean; createdAt: string }[]>([])
  const [metaLoaded, setMetaLoaded] = useState(false)
  const sceneRef = useRef<RunnerScene | null>(null)
  const hudRef = useRef(emptyHud)
  const selectedLevel = RUNNER_LEVELS.find(l => l.id === selectedLevelId) ?? DEFAULT_LEVEL
  const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled

  const refreshMeta = useCallback(async () => {
    try {
      const response = await runnerApi.meta()
      setMeta(response.levels)
      setStreakDays(response.streakDays ?? 0)
      setRecentRuns(response.recentRuns ?? [])
    } catch { /* без сети остаётся доступен первый уровень; результаты забега ставятся в очередь */ }
    finally { setMetaLoaded(true) }
  }, [])
  useEffect(() => { void refreshMeta() }, [refreshMeta])

  const onHud = useCallback((h: GameHudSnapshot) => {
    hudRef.current = h
    setHud(h)
  }, [])

  const saveRun = useCallback(async (r: RunnerRunResult) => {
    setSaveMsg('')
    try {
      const response = await runnerApi.submitRun(r)
      setLastStars(response.starsEarned ?? (r.completed ? (r.beansCollected >= hudRef.current.beansTotal ? 3 : r.beansCollected >= Math.ceil(hudRef.current.beansTotal * 0.7) ? 2 : 1) : 0))
      setSaveMsg('Результат сохранён')
      await flushRunnerQueue(async (body) => { await runnerApi.submitRun(body) })
      await refreshMeta()
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (/Сначала пройдите|runId уже|слишком быстро|Максимум зёрен|Неизвестный уровень/i.test(msg)) {
        setSaveMsg(msg || 'Результат отклонён сервером')
        return
      }
      enqueueRunner(r)
      setSaveMsg('Нет сети — результат сохранится позже. Реальные бонусы не начисляются.')
    }
  }, [refreshMeta])

  const onRunEnd = useCallback((r: RunnerRunResult) => {
    setLastBeans(r.beansCollected)
    setLastStars(r.completed ? (r.beansCollected >= hudRef.current.beansTotal ? 3 : r.beansCollected >= Math.ceil(hudRef.current.beansTotal * 0.7) ? 2 : 1) : 0)
    void saveRun(r)
  }, [saveRun])

  useEffect(() => {
    if (status !== 'ready') return
    if (tipSeen(selectedLevelId)) sceneRef.current?.requestStart()
    else setShowTip(true)
  }, [status, selectedLevelId])

  const tipDone = () => {
    try { localStorage.setItem(`${TIP_PREFIX}${selectedLevelId}`, '1') } catch { /* local storage может быть запрещён */ }
    setShowTip(false)
    sceneRef.current?.requestStart()
  }

  useEffect(() => {
    if (!started) return
    const b = document.body
    const prev = { overflow: b.style.overflow, overscroll: b.style.overscrollBehavior }
    b.style.overflow = 'hidden'; b.style.overscrollBehavior = 'none'
    return () => { b.style.overflow = prev.overflow; b.style.overscrollBehavior = prev.overscroll }
  }, [started])

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    const mq = window.matchMedia('(orientation: portrait)')
    const onMq = () => setPortrait(mq.matches)
    onMq(); mq.addEventListener('change', onMq)
    return () => {
      document.removeEventListener('fullscreenchange', onFs); mq.removeEventListener('change', onMq)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return }
      await document.documentElement.requestFullscreen()
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
      await o.lock?.('landscape').catch(() => {})
    } catch { /* браузер отказал — остаётся почти полноэкранный режим */ }
  }
  const leave = () => nav('/more')
  const startLevel = (id: string) => {
    setSelectedLevelId(id)
    setHud({ beans: 0, beansTotal: (RUNNER_LEVELS.find(l => l.id === id) ?? DEFAULT_LEVEL).beansTotal, progress01: 0, levelName: (RUNNER_LEVELS.find(l => l.id === id) ?? DEFAULT_LEVEL).name })
    setLastBeans(0); setLastStars(0); setSaveMsg(''); setShowTip(false); setStatus('loading'); setStarted(true)
  }

  if (!started) {
    return (
      <div className="pb-8 px-4" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center justify-between mb-3">
          <Link to="/more" className="text-brand text-sm font-medium no-underline">Назад</Link>
          <span className="text-xs text-ink-secondary">Игровые достижения · без кэшбэка</span>
        </div>
        <div className="rounded-3xl bg-brand text-white p-5 shadow-lift mb-4">
          <h1 className="font-display text-2xl font-bold mb-1">Приключения ламы</h1>
          <p className="text-brand-sub text-[15px]">Четыре уровня, серый Инспектор скуки и кофейные зёрна. Пройди уровень, собери звёзды и открой следующий.</p>
          <div className="mt-4 text-sm text-brand-sub">Тап / свайп вверх — прыжок · свайп вниз — скольжение. На террасе синие зёрна дают один дополнительный прыжок.</div>
        </div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-bold text-ink">Выбери уровень</h2>
          <button type="button" className="text-sm text-brand font-medium" onClick={() => void refreshMeta()}>Обновить</button>
        </div>
        {streakDays > 0 && <div className="rounded-xl bg-white border border-line px-4 py-3 mb-3 text-sm text-ink-secondary">Серия: <b className="text-brand">{streakDays} {streakDays === 1 ? 'день' : streakDays < 5 ? 'дня' : 'дней'}</b>. Пропуск дня не обнуляет награды — это просто статистика. </div>}
        <div className="space-y-3">
          {RUNNER_LEVELS.map((level, index) => {
            const server = meta.find(m => m.levelId === level.id)
            const unlocked = index === 0 || server?.unlocked === true
            const stars = server?.stars ?? 0
            return <div key={level.id} className={`rounded-2xl border p-4 ${unlocked ? 'bg-white border-line shadow-card' : 'bg-surface-muted border-line opacity-75'}`}>
              <div className="flex items-start gap-3">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 ${unlocked ? 'bg-brand-tint text-brand' : 'bg-surface text-ink-tertiary'}`}>{unlocked ? String(index + 1).padStart(2, '0') : '🔒'}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink">{level.name}</div>
                  <div className="text-sm text-ink-secondary">{level.subtitle}</div>
                  <div className="mt-1 text-sm text-amber-600" aria-label={`${stars} из 3 звёзд`}>{'★'.repeat(stars)}{'☆'.repeat(3-stars)} <span className="text-xs text-ink-tertiary">· {server?.bestBeans ?? 0}/{level.beansTotal} зёрен · {server?.bestDurationMs ? `${(server.bestDurationMs/1000).toFixed(1)} с` : 'нет рекорда'}</span></div>
                </div>
              </div>
              {unlocked ? <button type="button" className="mt-3 w-full h-11 rounded-xl bg-brand text-white font-semibold" onClick={() => startLevel(level.id)}>Играть</button> : <div className="mt-3 text-sm text-ink-tertiary">Пройди предыдущий уровень, чтобы открыть</div>}
            </div>
          })}
        </div>
        <div className="rounded-2xl bg-white border border-line p-4 mt-4">
          <div className="font-semibold text-ink mb-1">Следующая цель</div>
          <div className="text-sm text-ink-secondary">{(() => { const next = RUNNER_LEVELS.find((l, i) => i > 0 && !(meta.find(m => m.levelId === l.id)?.unlocked)); if (next) return `Пройди предыдущий уровень и открой «${next.name}».`; const low = RUNNER_LEVELS.map(l => ({ l, stars: meta.find(m => m.levelId === l.id)?.stars ?? 0 })).find(x => x.stars < 3); return low ? `Собери 3★ на уровне «${low.l.name}».` : 'Все уровни открыты — попробуй улучшить рекорд времени!' })()}</div>
          {recentRuns.length > 0 && <><div className="font-semibold text-ink mt-4 mb-2">Последние забеги</div><div className="space-y-2">{recentRuns.slice(0, 4).map((run, i) => <div key={`${run.levelId}-${run.createdAt}-${i}`} className="flex justify-between gap-3 text-sm"><span className="text-ink-secondary">{run.levelName} · {run.completed ? 'финиш' : 'не завершён'}</span><span className="text-ink font-medium whitespace-nowrap">{run.beansCollected} зёрен · {(run.durationMs / 1000).toFixed(1)} с</span></div>)}</div></>}
        </div>
        <div className="text-xs text-ink-tertiary mt-4">{metaLoaded ? 'Прогресс синхронизируется с сервером.' : 'Загружаем прогресс…'} Зёрна и звёзды — игровые показатели, они не связаны с бесплатным напитком за стаканы, покупками или кэшбэком.</div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden" style={{ background: '#A9D0F5', height: '100dvh' }}>
      <AlpacaGameCanvas levelId={selectedLevelId} sceneRef={sceneRef} onStatus={setStatus} onHud={onHud} onRunEnd={onRunEnd} />
      <GameOverlay status={status} hud={hud} lastBeans={lastBeans} starsEarned={lastStars} saveMsg={saveMsg} showTip={showTip} tipText={selectedLevel.tip}
        canFullscreen={canFullscreen} isFullscreen={isFs}
        onPlay={() => { setStarted(false); setTimeout(() => { setStatus('loading'); setStarted(true) }, 0) }}
        onTipDone={tipDone} onResume={() => sceneRef.current?.requestResume()} onRestart={() => sceneRef.current?.requestRestart()}
        onMenu={leave} onPause={() => sceneRef.current?.requestPause()} onFullscreen={() => void toggleFullscreen()} />
      {portrait && !portraitDismissed && (status === 'playing' || status === 'ready') && !showTip && (
        <button type="button" onClick={() => setPortraitDismissed(true)} className="absolute left-1/2 -translate-x-1/2 bottom-6 z-20 px-4 h-11 rounded-2xl bg-brand text-white text-sm font-medium shadow-lift" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>Переверните телефон — так удобнее</button>
      )}
    </div>
  )
}
