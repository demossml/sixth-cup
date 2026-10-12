import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { gameApi } from '../lib/gameApi'
import { flushGameClaims, savePendingClaim } from '../lib/gameQueue'

type Phase = 'idle' | 'playing' | 'won' | 'lost' | 'syncing' | 'done'

const STAGE_SIZE = [4, 6, 8] // pairs per stage → 8, 12, 16 tiles
const STAGE_MOVES = [12, 14, 16]

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Simple symbols (no emoji dependency on OS fonts issues — use letters). */
const SYMBOLS = ['A', 'L', 'P', 'C', 'F', 'E', '6', '7', 'S', 'T', 'U', 'P']

function buildTiles(pairs: number) {
  const pick = SYMBOLS.slice(0, pairs)
  return shuffle([...pick, ...pick].map((s, i) => ({ id: i, symbol: s, open: false, done: false })))
}

function nonce() {
  const a = new Uint8Array(12)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

export default function GamePage() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [stage, setStage] = useState(0) // 0..2
  const [tiles, setTiles] = useState(() => buildTiles(STAGE_SIZE[0]))
  const [movesLeft, setMovesLeft] = useState(STAGE_MOVES[0])
  const [first, setFirst] = useState<number | null>(null)
  const [lock, setLock] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [rewardMsg, setRewardMsg] = useState('')
  const [rewardsLeft, setRewardsLeft] = useState<number | null>(null)
  const startedAt = useRef(0)
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true

  const loadStatus = useCallback(async () => {
    try {
      const s = await gameApi.status()
      setRewardsLeft(s.rewardsLeftToday)
    } catch {
      /* offline ok */
    }
  }, [])

  useEffect(() => {
    void loadStatus()
    void flushGameClaims(async (_path, body) => {
      const r = await gameApi.claim(body as Parameters<typeof gameApi.claim>[0])
      return r
    }).then((r) => {
      if (r.flushed) setRewardMsg(r.lastMessage || 'Награды с игры зачислены')
      void loadStatus()
    })
  }, [loadStatus])

  const startGame = async () => {
    setRewardMsg('')
    setStatusMsg('')
    setStage(0)
    setTiles(buildTiles(STAGE_SIZE[0]))
    setMovesLeft(STAGE_MOVES[0])
    setFirst(null)
    setLock(false)
    startedAt.current = Date.now()

    if (navigator.onLine) {
      try {
        const r = await gameApi.start()
        setSessionId(r.sessionId)
        setRewardsLeft(r.rewardsLeftToday)
        setPhase('playing')
        return
      } catch (e) {
        setStatusMsg(e instanceof Error ? e.message : 'Не удалось начать игру')
        return
      }
    }
    // Offline: need an existing session from earlier start
    const cached = localStorage.getItem('sc_game_session')
    if (cached) {
      try {
        const j = JSON.parse(cached) as { sessionId: string; expiresAt: number }
        if (j.expiresAt > Date.now()) {
          setSessionId(j.sessionId)
          setPhase('playing')
          setStatusMsg('Офлайн-режим: награда после появления сети')
          return
        }
      } catch { /* */ }
    }
    setStatusMsg('Нужен интернет, чтобы начать раунд (получить сессию). Потом можно играть офлайн.')
  }

  // persist session for offline continue
  useEffect(() => {
    if (!sessionId) return
    localStorage.setItem(
      'sc_game_session',
      JSON.stringify({ sessionId, expiresAt: Date.now() + 86_400_000 }),
    )
  }, [sessionId])

  const finish = async (won: boolean, stageReached: number) => {
    setPhase(won ? 'won' : 'lost')
    if (!sessionId) return
    const payload = {
      sessionId,
      stageReached,
      won,
      clientNonce: nonce(),
      durationMs: Date.now() - startedAt.current,
    }
    if (!navigator.onLine) {
      savePendingClaim({ ...payload, savedAt: Date.now() })
      setRewardMsg('Результат сохранён. Бонус начислим, когда появится интернет.')
      setPhase('done')
      return
    }
    setPhase('syncing')
    try {
      const r = await gameApi.claim(payload)
      setRewardMsg(r.message)
      setRewardsLeft(r.rewardsLeftToday)
      removeSession()
    } catch {
      savePendingClaim({ ...payload, savedAt: Date.now() })
      setRewardMsg('Сеть сбойнула — результат в очереди, начислим позже.')
    }
    setPhase('done')
  }

  function removeSession() {
    localStorage.removeItem('sc_game_session')
  }

  const onTile = (idx: number) => {
    if (phase !== 'playing' || lock) return
    const t = tiles[idx]
    if (!t || t.open || t.done) return

    const next = tiles.map((x, i) => (i === idx ? { ...x, open: true } : x))
    setTiles(next)

    if (first === null) {
      setFirst(idx)
      return
    }

    const a = next[first]
    const b = next[idx]
    setLock(true)
    if (a.symbol === b.symbol) {
      const cleared = next.map((x, i) =>
        i === first || i === idx ? { ...x, done: true, open: true } : x,
      )
      setTimeout(() => {
        setTiles(cleared)
        setFirst(null)
        setLock(false)
        if (cleared.every((x) => x.done)) {
          const nextStage = stage + 1
          if (nextStage >= 3) {
            void finish(true, 3)
          } else {
            setStage(nextStage)
            setTiles(buildTiles(STAGE_SIZE[nextStage]))
            setMovesLeft(STAGE_MOVES[nextStage])
          }
        }
      }, 280)
    } else {
      const left = movesLeft - 1
      setTimeout(() => {
        setTiles((cur) =>
          cur.map((x, i) =>
            i === first || i === idx ? { ...x, open: false } : x,
          ),
        )
        setFirst(null)
        setLock(false)
        setMovesLeft(left)
        if (left <= 0) void finish(false, stage)
      }, 450)
    }
  }

  const gridCols = useMemo(() => {
    const n = tiles.length
    if (n <= 8) return 4
    if (n <= 12) return 4
    return 4
  }, [tiles.length])

  return (
    <div className="pb-8 px-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
      <div className="flex items-center justify-between mb-3">
        <Link to="/more" className="text-brand text-sm font-medium no-underline">
          Назад
        </Link>
        <span className="text-xs text-ink-secondary">
          {online ? 'Онлайн' : 'Офлайн'}
          {rewardsLeft != null ? ` · наград сегодня: ${rewardsLeft}` : ''}
        </span>
      </div>

      <h1 className="text-[22px] font-semibold text-ink mb-1">Собери альпаку</h1>
      <p className="text-sm text-ink-secondary mb-4">
        Найди пары. 3 этапа — бонус только после отправки на сервер (1 раз в день).
      </p>

      {phase === 'idle' || phase === 'done' ? (
        <div className="space-y-3">
          <div className="bg-white border border-line rounded-2xl p-4 shadow-card">
            <div className="flex justify-center mb-3">
              <AlpacaMark />
            </div>
            <p className="text-sm text-ink-secondary text-center mb-4">
              Этап 1 — разминка · Этап 2 — 0,30 ₽ · Этап 3 — 0,50 ₽ кэшбэка
            </p>
            <button
              type="button"
              onClick={() => void startGame()}
              className="w-full h-12 rounded-xl bg-brand text-white font-semibold text-[15px] active:opacity-90"
            >
              Играть
            </button>
          </div>
          {statusMsg && <p className="text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-2">{statusMsg}</p>}
          {rewardMsg && <p className="text-sm text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2">{rewardMsg}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="font-semibold text-ink">Этап {stage + 1} / 3</span>
            <span className="text-ink-secondary">Ходов: {movesLeft}</span>
          </div>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
          >
            {tiles.map((t, i) => (
              <button
                key={t.id}
                type="button"
                disabled={phase !== 'playing' || t.done || t.open}
                onClick={() => onTile(i)}
                className={[
                  'aspect-square rounded-xl border text-lg font-bold transition-colors',
                  t.done
                    ? 'bg-brand-tint border-brand text-brand'
                    : t.open
                      ? 'bg-white border-brand text-ink'
                      : 'bg-brand text-white border-brand',
                ].join(' ')}
              >
                {t.open || t.done ? t.symbol : ''}
              </button>
            ))}
          </div>
          {phase === 'syncing' && <p className="text-sm text-ink-secondary">Отправляем результат…</p>}
          {(phase === 'won' || phase === 'lost') && (
            <p className="text-sm text-ink-secondary">
              {phase === 'won' ? 'Победа! Синхронизация…' : 'Ходы закончились.'}
            </p>
          )}
          {rewardMsg && <p className="text-sm text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2">{rewardMsg}</p>}
        </div>
      )}
    </div>
  )
}

function AlpacaMark() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden>
      <rect width="72" height="72" rx="16" fill="#002FA7" />
      <ellipse cx="36" cy="42" rx="18" ry="16" fill="#fff" />
      <circle cx="28" cy="28" r="8" fill="#fff" />
      <circle cx="44" cy="28" r="8" fill="#fff" />
      <circle cx="28" cy="28" r="2.5" fill="#002FA7" />
      <circle cx="44" cy="28" r="2.5" fill="#002FA7" />
      <path d="M32 48c2 3 6 3 8 0" stroke="#002FA7" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}
