import { memo } from 'react'
import { schematicPoints, type MapTarget } from '../../lib/mapLinks'
import { mediaUrl } from '../../lib/media'

type Store = MapTarget & { id: number; name: string; address: string; photoUrl?: string | null }

type Props = {
  stores: Store[]
  selectedId: number | null
  onSelect: (id: number) => void
}

/**
 * Схематичная карта города: без внешних тайлов и ключей API — сетка улиц и точки кофеен,
 * выбранная подсвечена. Координаты нормализуются в квадрат (см. `schematicPoints`).
 */
function StoreMap({ stores, selectedId, onSelect }: Props) {
  const pts = schematicPoints(stores)
  const rough = stores.length < 2

  return (
    <div className="relative rounded-2xl overflow-hidden border border-line bg-pale">
      <svg viewBox="0 0 100 100" role="img" aria-label="Схема расположения кофеен" className="block w-full">
        <rect width="100" height="100" fill="#EAF1FA" />
        {[16, 34, 52, 70, 88].map((v) => (
          <line key={`v${v}`} x1={v} y1="0" x2={v} y2="100" stroke="#D4E2F2" strokeWidth="0.8" />
        ))}
        {[16, 34, 52, 70, 88].map((v) => (
          <line key={`h${v}`} x1="0" y1={v} x2="100" y2={v} stroke="#D4E2F2" strokeWidth="0.8" />
        ))}
        <line x1="0" y1="52" x2="100" y2="52" stroke="#BBD2EA" strokeWidth="2.4" />
        <line x1="52" y1="0" x2="52" y2="100" stroke="#BBD2EA" strokeWidth="2.4" />
        <rect x="56" y="56" width="28" height="28" rx="3" fill="#DCEDDD" />
        {pts.map(({ store, x, y }) => {
          const active = store.id === selectedId
          return (
            <g
              key={store.id}
              role="button"
              tabIndex={0}
              aria-label={store.name}
              aria-pressed={active}
              onClick={() => onSelect(store.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(store.id)
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              <circle
                cx={x * 100}
                cy={y * 100}
                r={active ? 6.5 : 5}
                fill={active ? '#0B4A8D' : '#FFFFFF'}
                stroke="#0B4A8D"
                strokeWidth="1.6"
              />
              <circle cx={x * 100} cy={y * 100} r={active ? 2.2 : 1.6} fill={active ? '#FFFFFF' : '#0B4A8D'} />
            </g>
          )
        })}
      </svg>
      {(() => {
        const chosen = stores.find((s) => s.id === selectedId)
        if (!chosen?.photoUrl) return null
        return (
          <span className="absolute left-2 top-2 flex items-center gap-1.5 rounded-xl bg-white/95 px-1.5 py-1 shadow-card">
            <img src={mediaUrl(chosen.photoUrl) ?? ''} alt="" className="w-7 h-7 rounded-lg object-cover bg-pale" />
            <span className="max-w-[140px] truncate text-[11px] leading-4 font-semibold text-ink">{chosen.name}</span>
          </span>
        )
      })()}
      {rough ? (
        <span className="absolute right-2 bottom-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] leading-4 text-ink-secondary">
          Схема · точное место в карте
        </span>
      ) : null}
    </div>
  )
}

export default memo(StoreMap)
