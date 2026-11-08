import { useEffect, useMemo, useRef, useState } from 'react'
import { canEmbedMap, mapEmbedUrl, type EmbedTarget } from '../../lib/mapEmbed'
import StoreMap from './StoreMap'

type Store = EmbedTarget & { id: number; name: string; address: string; photoUrl?: string | null }

type Props = {
  stores: Store[]
  selectedId: number | null
  onSelect: (id: number) => void
  zoom?: number
}

/** Сколько ждём карту, прежде чем показать схему: медленная сеть не должна оставлять пустое место. */
const LOAD_TIMEOUT_MS = 6500

const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine)

/**
 * Настоящая карта Яндекса в iframe без ключей API и лицензий.
 * Если карта не загрузилась, нет сети или у точек нет координат — показываем прежнюю схему,
 * поэтому экран выбора кофейни работает всегда.
 */
export default function StoreMapEmbed({ stores, selectedId, onSelect, zoom = 16 }: Props) {
  const [mode, setMode] = useState<'map' | 'schema'>('map')
  // Карта не перехватывает жесты страницы, пока гость не тронул её осознанно:
  // иначе свайп по карте двигает карту вместо прокрутки экрана.
  const [interactive, setInteractive] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const loadedRef = useRef(false)

  const selected = useMemo(() => stores.find((s) => s.id === selectedId) ?? null, [stores, selectedId])
  const url = useMemo(
    () => (canEmbedMap(stores) ? mapEmbedUrl(stores, selected, zoom) : null),
    [stores, selected, zoom],
  )

  useEffect(() => {
    // Смена точки тянет новый iframe: сбрасываем ожидание загрузки.
    setInteractive(false)
    loadedRef.current = false
    setLoading(true)
    setFailed(false)
  }, [url])

  useEffect(() => {
    if (!url || mode !== 'map' || !online()) return
    const t = setTimeout(() => {
      if (!loadedRef.current) setFailed(true)
    }, LOAD_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [url, mode])

  const schema = <StoreMap stores={stores} selectedId={selectedId} onSelect={onSelect} />

  if (!url || !online()) return schema
  if (mode === 'schema' || failed) {
    return (
      <div>
        {schema}
        {failed && (
          <button
            type="button"
            onClick={() => { setFailed(false); setMode('map'); setLoading(true) }}
            className="mt-1.5 min-h-9 text-[12px] leading-4 font-semibold text-brand"
          >
            Карта не загрузилась — попробовать снова
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="relative rounded-2xl overflow-hidden border border-line bg-pale">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-pale" aria-hidden="true">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        </div>
      )}
      <iframe
        key={url}
        src={url}
        title={selected ? `Карта: ${selected.name}` : 'Карта кофеен'}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
        onLoad={() => { loadedRef.current = true; setLoading(false) }}
        onError={() => { setFailed(true); setLoading(false) }}
        className={`block h-[210px] w-full border-0 ${interactive ? '' : 'pointer-events-none'}`}
      />
      {!interactive && !loading && (
        <button
          type="button"
          onClick={() => setInteractive(true)}
          className="absolute inset-0 z-10 flex items-end justify-center bg-transparent pb-8 text-[11px] leading-4 font-semibold text-ink"
          aria-label="Включить управление картой"
        >
          <span className="rounded-full bg-white/90 px-2.5 py-1 shadow-card">Нажмите, чтобы двигать карту</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => setMode('schema')}
        className="absolute right-2 bottom-2 z-20 min-h-8 rounded-full bg-white/95 px-2.5 text-[11px] leading-8 font-semibold text-ink shadow-card"
      >
        Схема
      </button>
    </div>
  )
}
