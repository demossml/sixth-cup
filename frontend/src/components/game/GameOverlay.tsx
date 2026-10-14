import type { ReactNode } from 'react'
import type { GameStatus, GameHudSnapshot } from '../../game/alpaca/types'

type Props = {
  status: GameStatus
  hud: GameHudSnapshot
  lastBeans: number
  showTip: boolean
  canFullscreen: boolean
  isFullscreen: boolean
  onPlay: () => void
  onTipDone: () => void
  onResume: () => void
  onRestart: () => void
  onMenu: () => void
  onPause: () => void
  onFullscreen: () => void
  saveMsg?: string
  tipText?: string
  starsEarned?: number
}

export function GameOverlay(p: Props) {
  const { status, hud } = p

  if (status === 'error') {
    return (
      <Panel>
        <Title>Не удалось загрузить игру</Title>
        <Text>Проверьте соединение и попробуйте снова.</Text>
        <Primary onClick={p.onPlay}>Повторить</Primary>
        <Ghost onClick={p.onMenu}>В меню</Ghost>
      </Panel>
    )
  }

  if (status === 'ready' && p.showTip) {
    return (
      <Panel>
        <Title>Как играть</Title>
        <ul className="space-y-2 mb-3 [@media(max-height:420px)]:space-y-1">
          <Rule icon={<IconTap />} title="Прыжок" text="тап по экрану или свайп вверх" />
          <Rule icon={<IconSwipe />} title="Скольжение" text="свайп вниз — проскочить под баннером" />
          <Rule icon={<IconCrate />} title="Ящики" text="можно перепрыгнуть или запрыгнуть на них" />
        </ul>
        {p.tipText && <p className="text-sm text-ink-secondary mb-3">{p.tipText}</p>}
        <p className="text-xs text-ink-tertiary mb-3 [@media(max-height:420px)]:hidden">На клавиатуре: Пробел / ↑ — прыжок, ↓ — скольжение, Esc — пауза.</p>
        <Primary onClick={p.onTipDone}>Поехали</Primary>
      </Panel>
    )
  }

  if (status === 'paused') {
    return (
      <Panel>
        <Title>Пауза</Title>
        <Primary onClick={p.onResume}>Продолжить</Primary>
        <Secondary onClick={p.onRestart}>Заново</Secondary>
        {p.canFullscreen && (
          <Secondary onClick={p.onFullscreen}>{p.isFullscreen ? 'Выйти из полного экрана' : 'На весь экран'}</Secondary>
        )}
        <Ghost onClick={p.onMenu}>В меню</Ghost>
      </Panel>
    )
  }

  if (status === 'won') {
    return (
      <Panel>
        <Title>Финиш!</Title>
        <Text>
          Собрано зёрен: <b>{p.lastBeans}</b> из {hud.beansTotal}
        </Text>
        <Text>{'Звёзды за уровень: ' + '★'.repeat(p.starsEarned ?? 0) + '☆'.repeat(3 - (p.starsEarned ?? 0))}</Text>
        {p.saveMsg && <p className="text-xs text-ink-tertiary mb-3">{p.saveMsg}</p>}
        <p className="text-xs text-ink-tertiary mb-3">Звёзды и открытие уровней — игровые достижения. Бонусы, кэшбэк и чашки за этот забег не начисляются.</p>
        <Primary onClick={p.onRestart}>Ещё раз</Primary>
        <Ghost onClick={p.onMenu}>В меню</Ghost>
      </Panel>
    )
  }

  if (status === 'lost') {
    return (
      <Panel>
        <Title>Ой!</Title>
        <Text>
          Собрано зёрен: <b>{p.lastBeans}</b> из {hud.beansTotal}. Попробуем ещё раз?
        </Text>
        {p.saveMsg && <p className="text-xs text-ink-tertiary mb-3">{p.saveMsg}</p>}
        <Primary onClick={p.onRestart}>Заново</Primary>
        <Ghost onClick={p.onMenu}>В меню</Ghost>
      </Panel>
    )
  }

  if (status === 'playing' || status === 'loading' || status === 'ready') {
    return (
      <div
        className="absolute inset-x-0 top-0 flex items-start gap-3 pointer-events-none"
        style={{
          paddingTop: 'max(10px, env(safe-area-inset-top))',
          paddingLeft: 'max(12px, env(safe-area-inset-left))',
          paddingRight: 'max(12px, env(safe-area-inset-right))',
        }}
      >
        <div className="flex items-center gap-2 h-12 px-3.5 rounded-2xl bg-white/92 border border-line shadow-card">
          <BeanIcon />
          <span className="text-[17px] font-bold text-ink tabular-nums leading-none">
            {hud.beans}
            <span className="text-ink-tertiary font-medium text-sm"> / {hud.beansTotal}</span>
          </span>
        </div>

        <div className="flex-1 pt-[18px] min-w-0">
          <div className="h-2.5 rounded-full bg-white/70 border border-white/80 overflow-hidden">
            <div className="h-full bg-brand rounded-full" style={{ width: `${Math.round(hud.progress01 * 100)}%` }} />
          </div>
        </div>

        <div className="flex gap-2 pointer-events-auto">
          {p.canFullscreen && (
            <RoundBtn label={p.isFullscreen ? 'Выйти из полного экрана' : 'На весь экран'} onClick={p.onFullscreen}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                {p.isFullscreen ? (
                  <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                ) : (
                  <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                )}
              </svg>
            </RoundBtn>
          )}
          <RoundBtn label="Пауза" onClick={p.onPause}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4.2" height="14" rx="1.4" />
              <rect x="13.8" y="5" width="4.2" height="14" rx="1.4" />
            </svg>
          </RoundBtn>
        </div>
      </div>
    )
  }

  return null
}

// ───────────── UI-кирпичики ─────────────
function Panel({ children }: { children: ReactNode }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-brand-deep/45 z-10 overflow-y-auto"
      style={{
        padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
      }}
    >
      <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-lift border border-line [@media(max-height:420px)]:p-3.5 [@media(max-height:420px)]:max-w-md">{children}</div>
    </div>
  )
}

const Title = ({ children }: { children: ReactNode }) => (
  <h2 className="font-display text-2xl font-bold text-brand mb-2 leading-tight">{children}</h2>
)
const Text = ({ children }: { children: ReactNode }) => <p className="text-[15px] text-ink-secondary mb-3">{children}</p>

function Primary({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full h-12 rounded-2xl bg-brand text-white font-semibold text-base mb-2 active:bg-brand-deep">
      {children}
    </button>
  )
}
function Secondary({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full h-12 rounded-2xl bg-brand-tint text-brand font-semibold text-base mb-2 active:opacity-80">
      {children}
    </button>
  )
}
function Ghost({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full h-11 text-[15px] text-brand font-medium">
      {children}
    </button>
  )
}
function RoundBtn({ children, onClick, label }: { children: ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="w-12 h-12 rounded-2xl bg-white/92 border border-line shadow-card text-brand flex items-center justify-center active:bg-brand-tint"
    >
      {children}
    </button>
  )
}

function Rule({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className="w-11 h-11 shrink-0 rounded-xl bg-brand-tint text-brand flex items-center justify-center">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-ink leading-tight">{title}</span>
        <span className="block text-sm text-ink-secondary leading-snug">{text}</span>
      </span>
    </li>
  )
}

function BeanIcon() {
  return (
    <svg width="22" height="26" viewBox="0 0 24 28" aria-hidden>
      <g transform="rotate(-24 12 14)">
        <ellipse cx="12" cy="14" rx="8" ry="11" fill="#7A4A22" stroke="#4A3828" strokeWidth="1.8" />
        <path d="M12 3C6.5 9 17.5 17 12 25" fill="none" stroke="#2E1A0B" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  )
}
const svgProps = { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
function IconTap() {
  return (
    <svg {...svgProps}>
      <path d="M12 4v10M8 8l4-4 4 4" />
      <path d="M6 20h12" />
    </svg>
  )
}
function IconSwipe() {
  return (
    <svg {...svgProps}>
      <path d="M12 20V10M8 16l4 4 4-4" />
      <path d="M6 4h12" />
    </svg>
  )
}
function IconCrate() {
  return (
    <svg {...svgProps}>
      <rect x="4" y="9" width="16" height="11" rx="2" />
      <path d="M4 14.5h16M12 9v11M9 5l3-2 3 2" />
    </svg>
  )
}
