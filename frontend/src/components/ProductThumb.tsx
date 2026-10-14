import { mediaUrl } from '../lib/media'

type Props = {
  imageUrl?: string | null
  /** Tailwind size classes, default square 72px-ish for list rows */
  className?: string
  /** Accessible name; decorative by default */
  alt?: string
}

/**
 * Unified product / promo thumbnail: real photo or neutral brand placeholder.
 * No emoji. Used in menu list/grid and sheets.
 */
export default function ProductThumb({ imageUrl, className = 'w-[72px] h-[72px] rounded-xl', alt = '' }: Props) {
  const src = mediaUrl(imageUrl)
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={`object-cover shrink-0 bg-[#EDE7DC] ${className}`}
      />
    )
  }
  return (
    <div
      className={`shrink-0 flex items-center justify-center bg-[#EDE7DC] text-brand/35 text-[11px] font-semibold tracking-wide ${className}`}
      aria-hidden={alt ? undefined : true}
    >
      6.7
    </div>
  )
}
