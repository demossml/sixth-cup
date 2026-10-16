import { useState } from 'react'
import { AppIcon } from '../../lib/icons'
import { mediaUrl } from '../../lib/media'

type Props = {
  name: string
  icon: string
  imageUrl?: string | null
  /** square — сетка (1:1), wide — sheet (4:3). Соотношение задано всегда → сетка не прыгает. */
  ratio?: 'square' | 'wide'
  /** Первые экранные карточки грузим сразу, остальные lazy. */
  eager?: boolean
  /** Медленный незаметный дрейф фото (только для большого фото в sheet). Число — seed направления. */
  drift?: number
}

// Четыре направления; seed (id товара) выбирает одно, чтобы соседние фото не двигались синхронно.
const DIRS = [
  ['1.5%', '-1%'],
  ['-1.5%', '-1%'],
  ['1.2%', '1.2%'],
  ['-1.2%', '1%'],
] as const

/** Фото через mediaUrl или единый тёплый placeholder 6.7 (нет фото / не загрузилось). */
export default function ProductPhoto({ name, icon, imageUrl, ratio = 'square', eager = false, drift }: Props) {
  const [failed, setFailed] = useState(false)
  const src = mediaUrl(imageUrl)
  const box = ratio === 'wide' ? 'aspect-[4/3]' : 'aspect-square'
  const big = ratio === 'wide'

  if (src && !failed && drift !== undefined) {
    const [dx, dy] = DIRS[Math.abs(Math.trunc(drift)) % DIRS.length]
    return (
      <div className={`${box} w-full overflow-hidden bg-[#EDE7DC]`}>
        <img
          src={src}
          alt={name}
          width={big ? 800 : 400}
          height={big ? 600 : 400}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
          className="photo-drift w-full h-full object-cover"
          style={{ '--dx': dx, '--dy': dy } as React.CSSProperties}
        />
      </div>
    )
  }
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        width={big ? 800 : 400}
        height={big ? 600 : 400}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setFailed(true)}
        className={`${box} w-full object-cover bg-[#EDE7DC]`}
      />
    )
  }
  return (
    <div
      role="img"
      aria-label={`Фото «${name}» пока нет`}
      className={`${box} w-full bg-[linear-gradient(145deg,#EEE7DA,#DCD0BC)] flex items-center justify-center relative overflow-hidden`}
    >
      <div className="absolute inset-3 rounded-xl border border-white/55" />
      <div className="relative flex flex-col items-center gap-1 text-brand/70">
        <AppIcon name={icon} size={big ? 42 : 28} />
        <span className="font-display text-[11px] tracking-[0.18em] font-semibold">6.7</span>
      </div>
    </div>
  )
}
