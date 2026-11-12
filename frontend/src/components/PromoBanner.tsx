/**
 * Баннер акции на главной.
 *
 * На главной нет текста акции — только сам баннер (требование владельца), и он
 * всегда заполняет свою рамку целиком (`object-cover`), без полей и без подложки.
 *
 * Рамка зависит от того, сколько акций показывается:
 * - `hero` — 16:9 во всю ширину экрана: одна акция = один большой баннер;
 * - `tile` — 4:5: так стоят два баннера в паре и все баннеры в рельсе.
 *
 * Куда ведёт тап — решает админка (`tap_action`): экран акции или сразу напиток.
 */
type Props = {
  title: string
  imageUrl: string
  mediaType?: 'image' | 'video'
  /** hero — 16:9 на всю ширину (одна акция); tile — 4:5 (пара и рельс). */
  variant?: 'hero' | 'tile'
  /** Первый баннер грузим сразу, остальные — лениво (рельс не тормозит главную). */
  priority?: boolean
  onClick: () => void
}

const FRAME: Record<'hero' | 'tile', string> = {
  hero: '16 / 9',
  tile: '4 / 5',
}

export default function PromoBanner({
  title,
  imageUrl,
  mediaType,
  variant = 'tile',
  priority = false,
  onClick,
}: Props) {
  const radius = variant === 'hero' ? 'rounded-3xl' : 'rounded-2xl'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={title || 'Акция'}
      className={`group block w-full ${radius} overflow-hidden bg-brand-soft shadow-card active:scale-[0.995] motion-reduce:transition-none`}
    >
      <span className="relative block w-full" style={{ aspectRatio: FRAME[variant] }}>
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
            // Кадр фиксированной пропорции: cover заполняет его полностью и
            // обрезает только лишние края — «полей» внутри баннера не бывает.
            className="absolute inset-0 w-full h-full object-cover"
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
          />
        )}
      </span>
    </button>
  )
}
