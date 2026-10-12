import { useLocation, useNavigate } from 'react-router-dom'
import Qr from '../components/Qr'
import { useApp } from '../lib/app'
import { formatCardCode } from '../lib/card'
import { syncStatus } from '../lib/syncStatus'
import { useWakeLock } from '../lib/wakeLock'
import { ArrowLeft, WifiOff } from '../lib/icons'

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
        className="absolute left-3 flex items-center gap-2 px-3 text-brand min-h-12 font-medium"
        style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <ArrowLeft size={20} /> Назад
      </button>
      <p className="text-sm font-medium text-ink-secondary mb-3">QR карты для кассы</p>
      {proof ? (
        <div className="w-full" style={{ maxWidth: 'min(92vw, 62vh, 440px)' }}>
          <Qr value={proof} size={440} alt="QR карты для кассы" />
        </div>
      ) : (
        <p className="text-sm text-ink-secondary">Код недоступен — вернитесь на главную и обновите карту.</p>
      )}
      <p className="mt-4 text-4xl font-bold tracking-[0.18em] tabular-nums">{formatCardCode(cardCode)}</p>
      <p className="text-sm text-ink-secondary mt-2 text-center max-w-xs">Если не сканируется — назовите номер карты бариста</p>
      {status.kind !== 'fresh' && status.detail && (
        <p className="mt-3 text-xs text-ink-secondary inline-flex items-center gap-1">
          {status.kind === 'offline' && <WifiOff size={14} />} {status.detail}
        </p>
      )}
    </main>
  )
}
