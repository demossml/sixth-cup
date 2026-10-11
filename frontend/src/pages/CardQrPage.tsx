import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Qr from '../components/Qr'
import { useApp } from '../lib/app'
import { ArrowLeft, WifiOff } from '../lib/icons'

/** Полноэкранное увеличение QR (с главной код уже виден без этого экрана). */
export default function CardQrPage() {
  const { me, best, lastSync } = useApp()
  const nav = useNavigate()
  const proof = best?.token
  const cardCode = me?.cardCode ?? ''

  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    let active = true
    const wake = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    void wake.wakeLock?.request('screen').then((l) => {
      if (active) lock = l
      else void l.release()
    }).catch(() => {})
    return () => {
      active = false
      if (lock) void lock.release().catch(() => {})
    }
  }, [])

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
        onClick={() => nav(-1)}
        className="absolute left-3 flex items-center gap-2 p-3 text-brand min-h-12"
        style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <ArrowLeft size={20} /> Назад
      </button>
      <p className="text-sm font-medium text-ink-secondary mb-3">QR карты для кассы</p>
      {proof ? (
        <Qr value={proof} size={400} alt="QR карты для кассы" />
      ) : (
        <p className="text-sm text-ink-secondary">Код недоступен — обновите карту на главной.</p>
      )}
      <p className="mt-4 text-4xl font-bold tracking-widest tabular-nums">{cardCode || '—'}</p>
      <p className="text-xs text-ink-tertiary mt-2 text-center max-w-xs">
        Если не сканируется — назовите номер карты бариста
      </p>
      {typeof navigator !== 'undefined' && !navigator.onLine && (
        <p className="mt-3 text-xs text-ink-secondary inline-flex items-center gap-1">
          <WifiOff size={14} /> Офлайн
          {lastSync
            ? ` · данные на ${new Date(lastSync).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
            : ''}
        </p>
      )}
    </main>
  )
}
