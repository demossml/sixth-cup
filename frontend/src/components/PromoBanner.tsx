import { useState } from 'react'

/**
 * Баннер акции на главной.
 *
 * По требованию владельца на главной нет текста акции: виден только баннер, и он
 * должен занимать всю свою площадь. Поэтому пропорции баннера берутся **из самого
 * файла** (а не из фиксированных 4:5): загрузили 4:5 — баннер ровно 4:5, 2:3 —
 * ровно 2:3. Ни полей по бокам, ни обрезки.
 *
 * Пропорция ограничена разумными рамками (0.6…1.6), чтобы случайный узкий или
 * панорамный файл не сломал высоту экрана.
 *
 * Куда ведёт тап — решает админка (`tap_action`): экран акции или сразу напиток.
 */
type Props = {
  title: string
  imageUrl: string
  mediaType?: 'image' | 'video'
  /** cover — принудительно кадр 4:5 (видео и «плавающие» фото). */
  fit?: 'contain' | 'cover'
  onClick: () => void
}

const MIN_RATIO = 0.6
const MAX_RATIO = 1.6
const clamp = (r: number) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, r))

export default function PromoBanner({ title, imageUrl, mediaType, fit = 'contain', onClick }: Props) {
  // Пока файл не загрузился — 4:5, самый частый формат у владельца.
  const [ratio, setRatio] = useState(0.8)
  const fixed = mediaType === 'video' || fit === 'cover'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={title || 'Акция'}
      className="group block w-full rounded-2xl overflow-hidden bg-brand-soft shadow-card active:scale-[0.995] motion-reduce:transition-none"
    >
      <span
        className="relative block w-full"
        style={{ aspectRatio: fixed ? '4 / 5' : String(clamp(ratio)) }}
      >
        {mediaType === 'video' ? (
          <video
            src={imageUrl}
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay muted loop playsInline preload="metadata"
            aria-hidden="true"
          />
        ) : (
          <img
            src={imageUrl}
            alt=""
            // Баннер и картинка имеют одну пропорцию → cover даёт полное
            // заполнение площади без полей и без обрезки.
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            onLoad={(e) => {
              const img = e.currentTarget
              if (img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight)
            }}
          />
        )}
      </span>
    </button>
  )
}
