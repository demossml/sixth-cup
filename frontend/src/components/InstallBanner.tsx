import { useLocation } from 'react-router-dom'
import { useInstall } from '../lib/installStore'

/**
 * Установка PWA без блокировки ценности.
 *  - variant="inline": карточка в потоке страницы (на главной — ниже QR, QR не перекрывает);
 *  - variant="fixed": плавающая плашка над меню на остальных экранах.
 * Не показывается в standalone, на fullscreen QR и 14 дней после «Позже».
 */
export default function InstallBanner({ variant = 'fixed' }: { variant?: 'inline' | 'fixed' }) {
  const location = useLocation()
  const { visible, canPrompt, ios, install, later } = useInstall()
  if (!visible) return null
  if (location.pathname === '/card-qr') return null
  if (variant === 'fixed' && location.pathname === '/') return null

  const body = (
    <div className="bg-white border border-line text-ink rounded-2xl p-3 flex gap-3 items-start shadow-card">
      <img src="/logo-mark.png" alt="" className="w-12 h-12 rounded-xl shrink-0 object-cover" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold leading-snug">Добавьте 6.7 Coffee на экран</p>
        <p className="text-ink-secondary text-[13px] leading-[18px] mt-1">
          {canPrompt
            ? 'Карта будет под рукой, как обычное приложение.'
            : ios
              ? <>В Safari нажмите <b>Поделиться</b>, затем <b>«На экран „Домой“»</b>.</>
              : 'Карта будет под рукой, как обычное приложение.'}
        </p>
        <div className="flex gap-2 mt-2">
          {canPrompt && (
            <button type="button" onClick={() => void install()} className="min-h-11 px-4 text-sm font-semibold bg-brand text-white rounded-xl">
              Установить
            </button>
          )}
          <button type="button" onClick={later} className="min-h-11 px-3 text-sm font-semibold text-brand">
            {canPrompt ? 'Позже' : 'Понятно'}
          </button>
        </div>
      </div>
    </div>
  )

  if (variant === 'inline') return <div className="mb-2.5">{body}</div>
  return (
    <div className="fixed left-0 right-0 z-30 px-3" style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px) + 0.5rem)' }}>
      <div className="max-w-[480px] mx-auto">{body}</div>
    </div>
  )
}
