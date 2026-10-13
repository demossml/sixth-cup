import type { GameStatus, GameHudSnapshot } from '../../game/alpaca/types'

type Props = {
  status: GameStatus
  hud: GameHudSnapshot
  lastBeans: number
  onPlay: () => void
  onResume: () => void
  onRestart: () => void
  onMenu: () => void
  onPause: () => void
  saveMsg?: string
}

export function GameOverlay({
  status,
  hud,
  lastBeans,
  onPlay,
  onResume,
  onRestart,
  onMenu,
  onPause,
  saveMsg,
}: Props) {
  if (status === 'intro') {
    return (
      <Panel>
        <h2 className="text-lg font-semibold text-ink mb-1">Приключения ламы</h2>
        <p className="text-sm text-ink-secondary mb-3">
          Помоги ламе пробежать через кофейный город! Собирай зёрна, перепрыгивай коробки и
          проскальзывай под навесами.
        </p>
        <p className="text-xs text-ink-tertiary mb-4">
          Тап / Space — прыжок · Свайп вниз / ↓ — скольжение · Esc — пауза
        </p>
        <Btn onClick={onPlay}>Играть</Btn>
      </Panel>
    )
  }

  if (status === 'error') {
    return (
      <Panel>
        <h2 className="text-lg font-semibold text-ink mb-2">Не удалось загрузить игру</h2>
        <p className="text-sm text-ink-secondary mb-4">Проверьте соединение и попробуйте снова.</p>
        <Btn onClick={onPlay}>Повторить</Btn>
        <Ghost onClick={onMenu}>В меню</Ghost>
      </Panel>
    )
  }

  if (status === 'paused') {
    return (
      <Panel>
        <h2 className="text-lg font-semibold text-ink mb-3">Пауза</h2>
        <Btn onClick={onResume}>Продолжить</Btn>
        <Ghost onClick={onMenu}>В меню</Ghost>
      </Panel>
    )
  }

  if (status === 'won') {
    return (
      <Panel>
        <h2 className="text-lg font-semibold text-ink mb-1">Уровень пройден!</h2>
        <p className="text-sm text-ink-secondary mb-3">Зёрен: {lastBeans}</p>
        {saveMsg && <p className="text-xs text-ink-tertiary mb-2">{saveMsg}</p>}
        <Btn onClick={onRestart}>Сыграть ещё раз</Btn>
        <Ghost onClick={onMenu}>В меню</Ghost>
      </Panel>
    )
  }

  if (status === 'lost') {
    return (
      <Panel>
        <h2 className="text-lg font-semibold text-ink mb-1">Попробуем ещё раз?</h2>
        <p className="text-sm text-ink-secondary mb-3">Зёрен: {lastBeans}</p>
        {saveMsg && <p className="text-xs text-ink-tertiary mb-2">{saveMsg}</p>}
        <Btn onClick={onRestart}>Повторить</Btn>
        <Ghost onClick={onMenu}>В меню</Ghost>
      </Panel>
    )
  }

  // playing / loading HUD
  if (status === 'playing' || status === 'loading') {
    return (
      <div className="absolute inset-x-0 top-0 p-2 flex items-start justify-between pointer-events-none">
        <div className="bg-white/90 rounded-xl px-3 py-1.5 text-xs shadow-card pointer-events-none">
          <div className="font-semibold text-ink">{hud.levelName}</div>
          <div className="text-ink-secondary">Зёрна: {hud.beans}</div>
          <div className="mt-1 h-1.5 w-28 bg-line rounded-full overflow-hidden">
            <div className="h-full bg-brand rounded-full" style={{ width: `${Math.round(hud.progress01 * 100)}%` }} />
          </div>
        </div>
        <button
          type="button"
          className="pointer-events-auto h-9 px-3 rounded-xl bg-white/90 text-sm font-medium text-ink border border-line"
          onClick={onPause}
        >
          Пауза
        </button>
      </div>
    )
  }

  return null
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/35 p-4 z-10">
      <div className="w-full max-w-sm bg-white rounded-2xl p-4 shadow-card border border-line">{children}</div>
    </div>
  )
}

function Btn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full h-11 rounded-xl bg-brand text-white font-semibold text-[15px] mb-2 active:opacity-90"
    >
      {children}
    </button>
  )
}

function Ghost({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full h-10 text-sm text-brand font-medium">
      {children}
    </button>
  )
}
