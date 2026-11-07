import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, MapPin, Navigation } from 'lucide-react'
import { useApp } from '../lib/app'
import { hoursLabel, storeHours, type MenuDirectory } from '../lib/menuModel'
import {
  MAP_PROVIDERS,
  defaultMapProvider,
  placeUrl,
  readMapProvider,
  routeUrl,
  saveMapProvider,
  type MapProvider,
} from '../lib/mapLinks'
import StoreMap from '../components/map/StoreMap'

type GeoState = 'idle' | 'asking' | 'denied' | 'ready'

const distanceM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la = (a.lat * Math.PI) / 180
  const lb = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Выбор кофейни: список точек с адресом и часами, «Открыто/Закрыто».
 * В закрытую точку заказ отправить нельзя. Геолокация — по желанию: сортирует по расстоянию.
 */
export default function StorePickerPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const fromCart = params.get('from') === 'cart'
  const { dir: rawDir } = useApp()
  const dir = rawDir as MenuDirectory | null
  const [selected, setSelected] = useState<number | null>(() => {
    try { return Number(localStorage.getItem('sc_store_id')) || null } catch { return null }
  })
  const [provider, setProvider] = useState<MapProvider>(
    () => readMapProvider() ?? defaultMapProvider(typeof navigator === 'undefined' ? '' : navigator.userAgent),
  )
  const [geo, setGeo] = useState<GeoState>('idle')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)

  const stores = useMemo(() => {
    const list = [...(dir?.stores ?? [])]
    if (!coords) return list
    return list.sort((a, b) => {
      const da = a.lat != null && a.lng != null ? distanceM(coords, { lat: a.lat, lng: a.lng }) : Number.POSITIVE_INFINITY
      const db = b.lat != null && b.lng != null ? distanceM(coords, { lat: b.lat, lng: b.lng }) : Number.POSITIVE_INFINITY
      return da - db
    })
  }, [dir, coords])

  useEffect(() => {
    if (selected != null || !stores.length) return
    // Одна точка — выбираем сразу, гостю нечего решать.
    if (stores.length === 1) setSelected(stores[0].id)
  }, [selected, stores])

  const locate = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeo('denied')
      return
    }
    setGeo('asking')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGeo('ready')
      },
      () => setGeo('denied'),
      { timeout: 8000, maximumAge: 60_000 },
    )
  }

  const confirm = () => {
    if (selected == null) return
    try { localStorage.setItem('sc_store_id', String(selected)) } catch { /* private mode */ }
    nav(fromCart ? '/cart' : '/menu')
  }

  const pad = { paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }

  return (
    <main className="pb-40">
      <div className="px-4" style={pad}>
        <button
          type="button"
          onClick={() => nav(-1)}
          aria-label="Назад"
          className="w-11 h-11 rounded-full bg-white border border-line flex items-center justify-center text-ink"
        >
          <ArrowLeft size={18} strokeWidth={1.75} />
        </button>
        <h1 className="mt-3 font-display text-[26px] leading-8 font-semibold text-ink">Выберите кофейню</h1>
        <p className="mt-1 text-[14px] leading-5 text-ink-secondary">Сначала выберите кофейню, где заберёте заказ</p>

        <button
          type="button"
          onClick={locate}
          className="mt-3 w-full flex items-center justify-center gap-2 min-h-11 rounded-xl border border-line bg-white text-[14px] font-semibold text-brand"
        >
          <Navigation size={16} strokeWidth={1.75} />
          {geo === 'asking' ? 'Определяем…' : geo === 'ready' ? 'Найдены ближайшие' : 'Найти ближайшие'}
        </button>
        {geo === 'denied' && (
          <p className="mt-2 text-[12px] leading-4 text-ink-secondary">Геолокация недоступна — ниже все кофейни.</p>
        )}

        {stores.length > 0 && (
          <div className="mt-3">
            <StoreMap stores={stores} selectedId={selected} onSelect={setSelected} />
            <div className="mt-2 flex items-center gap-1.5" role="group" aria-label="Открыть в карте">
              {MAP_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setProvider(p.id)
                    saveMapProvider(p.id)
                  }}
                  aria-pressed={provider === p.id}
                  className={`min-h-9 px-3 rounded-full border text-[13px] leading-5 transition-colors ${
                    provider === p.id ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink-secondary'
                  }`}
                >
                  {p.short}
                </button>
              ))}
            </div>
          </div>
        )}

        <ul className="mt-3 space-y-2">
          {stores.map((s) => {
            const hours = storeHours(s)
            const active = selected === s.id
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelected(s.id)}
                  disabled={!hours.open}
                  aria-pressed={active}
                  className={`w-full text-left rounded-2xl border px-3.5 py-3 flex items-start gap-3 transition-colors ${
                    active ? 'border-brand bg-brand-tint/40' : 'border-line bg-white'
                  } disabled:opacity-50`}
                >
                  <MapPin size={18} strokeWidth={1.75} className="text-brand shrink-0 mt-0.5" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] leading-5 font-semibold text-ink truncate">{s.name}</span>
                    <span className="block text-[13px] leading-[18px] text-ink-secondary truncate">{s.address}</span>
                    <span className={`mt-0.5 block text-[12px] leading-4 ${hours.open ? 'text-ok' : 'text-bad'}`}>
                      {hoursLabel(hours)}
                    </span>
                  </span>
                  {active && <span className="text-brand text-[18px] leading-5 shrink-0">✓</span>}
                </button>
              </li>
            )
          })}
        </ul>
        {(() => {
          const chosen = stores.find((s) => s.id === selected) ?? null
          if (!chosen) return null
          return (
            <div className="mt-3 flex items-center gap-2">
              <a
                href={routeUrl(provider, chosen)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-h-11 rounded-xl border border-line bg-white flex items-center justify-center text-[14px] font-semibold text-brand"
              >
                Маршрут · {MAP_PROVIDERS.find((p) => p.id === provider)?.short}
              </a>
              <a
                href={placeUrl(provider, chosen)}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-11 px-3 rounded-xl border border-line bg-white flex items-center justify-center text-[14px] text-ink-secondary"
              >
                На карте
              </a>
            </div>
          )
        })()}
        {!stores.length && (
          <div className="mt-4 rounded-2xl border border-line bg-white px-4 py-6 text-center">
            <p className="text-[15px] leading-5 font-semibold text-ink">Кофейни не найдены</p>
            <p className="mt-1 text-[13px] leading-[18px] text-ink-secondary">Обновите каталог, когда появится сеть.</p>
          </div>
        )}
      </div>

      <div className="fixed left-0 right-0 max-w-[480px] mx-auto px-4 z-40" style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}>
        <button type="button" onClick={confirm} disabled={selected == null} className="btn min-h-14 w-full disabled:opacity-50">
          Забрать здесь
        </button>
      </div>
    </main>
  )
}
