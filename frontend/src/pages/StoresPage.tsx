import { Link } from 'react-router-dom'
import { mediaUrl } from '../lib/media'
import { useApp } from '../lib/app'
import { defaultMapProvider, readMapProvider, routeUrl } from '../lib/mapLinks'
import { storeHours } from '../lib/menuModel'
import { ArrowLeft, Store } from '../lib/icons'

/**
 * Кофейни: из directory (кэшируется, работает офлайн).
 * Аудит PWA 15.11.2026: карточка была без часов работы и без кнопки маршрута —
 * гость не понимал, открыто ли сейчас и как добраться (на /pick-store это было).
 */
export default function StoresPage() {
  const { dir } = useApp()
  const stores = dir?.stores ?? []
  const provider =
    readMapProvider() ?? defaultMapProvider(typeof navigator === 'undefined' ? '' : navigator.userAgent)
  return (
    <div className="pb-6">
      <header className="px-4 pb-3" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <Link to="/more" className="inline-flex items-center gap-1 min-h-11 text-brand text-sm no-underline"><ArrowLeft size={18} /> Ещё</Link>
        <h1 className="text-[22px] leading-7 font-semibold text-ink">Кофейни</h1>
      </header>
      <div className="p-4 space-y-2">
        {stores.length === 0 && (
          <div className="card text-center py-8">
            <b>Список кофеен появится после первого обновления</b>
            <p className="text-ink-secondary text-sm mt-2">Откройте «Карту» при подключении к сети.</p>
          </div>
        )}
        {stores.map((s) => {
          const hours = storeHours(s)
          return (
            <article key={s.id} className="card !mb-0 flex items-start gap-3">
              {s.photoUrl ? (
                <img
                  src={mediaUrl(s.photoUrl) ?? ''}
                  alt={s.name}
                  loading="lazy"
                  decoding="async"
                  className="w-16 h-16 rounded-xl object-cover bg-pale shrink-0"
                />
              ) : (
                <span className="w-16 h-16 rounded-xl bg-brand-soft text-brand flex items-center justify-center shrink-0"><Store size={21} /></span>
              )}
              <span className="min-w-0 flex-1">
                <b className="block text-ink text-base">{s.name}</b>
                {s.address && <span className="block text-ink-secondary text-sm mt-0.5">{s.address}</span>}
                {hours.label && (
                  <span className={`block text-[13px] mt-0.5 num ${hours.open ? 'text-ok' : 'text-ink-tertiary'}`}>
                    {hours.open ? `Открыто · ${hours.label}` : `Закрыто · ${hours.label}`}
                  </span>
                )}
                {s.entranceHint && <span className="block text-ink-tertiary text-[13px] mt-0.5">{s.entranceHint}</span>}
                <a
                  href={routeUrl(provider, s)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 mt-1 min-h-9 text-[13px] font-semibold text-brand no-underline"
                >
                  Маршрут
                </a>
              </span>
            </article>
          )
        })}
      </div>
    </div>
  )
}
