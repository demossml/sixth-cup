import { useLocation, useNavigate } from 'react-router-dom'
import Qr from '../components/Qr'
import { useApp } from '../lib/app'
import { formatCardCode } from '../lib/card'
import { syncStatus } from '../lib/syncStatus'
import { useWakeLock } from '../lib/wakeLock'
import { WifiOff, X } from '../lib/icons'

/** Полноэкранное увеличение QR (с главной код уже виден без этого экрана). Баннеры и меню скрыты. */
export default function CardQrPage() {
  const { me, best, lastSync, syncing } = useApp()
  const nav = useNavigate()
  const loc = useLocation()
  const proof = best?.token
  const cardCode = me?.cardCode ?? ''
  const online = typeof navigator === 'undefined' ? true : navigator.onLine
  const status = syncStatus({ online, syncing, lastSync })

  useWakeLock(true)

  return (
    <main
      className="fixed inset-0 z-[60] bg-white text-ink flex flex-col items-center justify-center px-5"
      style={{
        paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
      }}
    >
      <button
        type="button"
        onClick={() => (loc.key === 'default' ? nav('/', { replace: true }) : nav(-1))}
        className="absolute right-3 flex items-center justify-center w-11 h-11 rounded-full text-ink active:bg-line/60"
        style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
        aria-label="Закрыть"
      >
        <X size={24} strokeWidth={1.75} />
      </button>
      {proof ? (
        <div className="w-full" style={{ maxWidth: 'min(92vw, 62vh, 440px)' }}>
          <Qr value={proof} size={440} alt="QR карты для кассы" />
        </div>
      ) : (
        <p className="text-sm text-ink-secondary">Код недоступен — вернитесь на главную и обновите карту.</p>
      )}
      <p className="mt-4 font-display font-semibold text-4xl tracking-[0.12em] num">{formatCardCode(cardCode)}</p>
      <p className="text-[13px] leading-[18px] text-ink-secondary mt-2 text-center max-w-xs">Покажите код бариста. Не читается — назовите номер</p>
      {status.kind !== 'fresh' && status.detail && (
        <p className="mt-3 text-xs text-ink-secondary inline-flex items-center gap-1">
          {status.kind === 'offline' && <WifiOff size={14} strokeWidth={1.75} />} {status.detail}
        </p>
      )}
    </main>
  )
}
