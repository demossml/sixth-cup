import { useEffect, useRef, useState } from 'react'
import { AppIcon } from '../../lib/icons'
import { mediaUrl } from '../../lib/media'

type Props = {
  name: string
  icon: string
  imageUrl?: string | null
  /** Видео товара: в сетке показываем постер, на карточке — само видео. */
  mediaType?: 'image' | 'video' | null
  videoUrl?: string | null
  posterUrl?: string | null
  /** square — 1:1, poster — 4:5 (витрина и карточка товара, как в макете), wide — 4:3. */
  ratio?: 'square' | 'poster' | 'wide'
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
export default function ProductPhoto({
  name, icon, imageUrl, mediaType, videoUrl, posterUrl, ratio = 'square', eager = false, drift,
}: Props) {
  const [failed, setFailed] = useState(false)
  const [playVideo, setPlayVideo] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const src = mediaUrl(imageUrl)
  const video = mediaType === 'video' ? mediaUrl(videoUrl) : null
  const poster = mediaUrl(posterUrl ?? imageUrl)

  // Видео играет только когда карточка в кадре и пользователь не просил меньше движения.
  useEffect(() => {
    if (!video || ratio === 'square') return
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    setPlayVideo(true)
  }, [video, ratio])

  useEffect(() => {
    const el = videoRef.current
    if (!el || !playVideo) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) void el.play().catch(() => {})
          else el.pause()
        }
      },
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [playVideo])

  const box = ratio === 'wide' ? 'aspect-[4/3]' : ratio === 'poster' ? 'aspect-[4/5]' : 'aspect-square'
  const big = ratio !== 'square'

  if (video && ratio !== 'square') {
    return (
      <div className={`${box} w-full overflow-hidden bg-pale relative`}>
        <video
          ref={videoRef}
          src={video}
          poster={poster ?? undefined}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={name}
          className="w-full h-full object-cover"
        />
      </div>
    )
  }
  if (video && ratio === 'square' && poster) {
    return <img src={poster} alt={name} loading={eager ? 'eager' : 'lazy'} decoding="async" className={`${box} w-full object-cover bg-pale`} />
  }
  if (src && !failed && drift !== undefined) {
    const [dx, dy] = DIRS[Math.abs(Math.trunc(drift)) % DIRS.length]
    return (
      <div className={`${box} w-full overflow-hidden bg-pale`}>
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
        className={`${box} w-full object-cover bg-pale`}
      />
    )
  }
  return (
    <div
      role="img"
      aria-label={`Фото «${name}» пока нет`}
      className={`${box} w-full bg-[linear-gradient(145deg,#EAF2FB,#D7E6F8)] flex items-center justify-center relative overflow-hidden`}
    >
      {ratio === 'square' && <div className="absolute inset-3 rounded-xl border border-white/55" />}
      <div className="relative flex flex-col items-center gap-1 text-brand/70">
        <AppIcon name={icon} size={big ? 42 : 28} />
        <span className="font-display text-[11px] tracking-[0.18em] font-semibold">6.7</span>
      </div>
    </div>
  )
}
