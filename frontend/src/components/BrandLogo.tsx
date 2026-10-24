/**
 * Логотип 6.7 Coffee как на стильборде: line-art альпака + wordmark.
 * Без mix-blend-mode:lighten (на тёмном фоне mark часто пропадал).
 */
type Props = {
  tone?: 'onDark' | 'onLight'
  size?: 'sm' | 'md' | 'lg'
  showWordmark?: boolean
  className?: string
}

const SIZES = {
  sm: { mark: 28, text: 'text-[15px] leading-5', gap: 'gap-2' },
  md: { mark: 32, text: 'text-[16px] leading-5', gap: 'gap-2' },
  lg: { mark: 40, text: 'text-[18px] leading-5', gap: 'gap-2.5' },
} as const

export function AlpacaMark({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className="shrink-0"
    >
      {/* stylized alpaca head — matches board mark silhouette */}
      <path
        d="M11 27v-1.2c0-1.4.5-2.5 1.4-3.4-.9-.4-1.6-1.1-2-2-.6-1.3-.4-2.7.5-3.8.4-.5.9-1 1.5-1.2-.3-1-.1-2.1.5-3 .7-1.1 1.8-1.7 3.1-1.8.3-1.2 1.1-2.2 2.2-2.7 1.2-.5 2.6-.3 3.6.6.4.4.7.8.9 1.3.9.1 1.7.5 2.3 1.2.7.9.9 2.1.5 3.2.7.4 1.2 1.1 1.5 1.9.4 1.2.1 2.5-.7 3.5-.4.5-1 .9-1.6 1.1.6.9.9 1.9.9 3V27H11z"
        stroke={color}
        strokeWidth="1.55"
        strokeLinejoin="round"
      />
      <path d="M13.5 9.5L12 6.8M20.2 9.7l1.6-2.8" stroke={color} strokeWidth="1.55" strokeLinecap="round" />
      <circle cx="14.3" cy="15.4" r="1" fill={color} />
      <circle cx="19.1" cy="15.4" r="1" fill={color} />
      <path d="M15.4 18.4h2.4" stroke={color} strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  )
}

export default function BrandLogo({
  tone = 'onDark',
  size = 'sm',
  showWordmark = true,
  className = '',
}: Props) {
  const s = SIZES[size]
  const color = tone === 'onDark' ? '#FFFFFF' : '#0B4A8D'
  return (
    <div className={`inline-flex items-center ${s.gap} min-w-0 ${className}`} role="img" aria-label="6.7 Coffee">
      <AlpacaMark size={s.mark} color={color} />
      {showWordmark ? (
        <span className={`font-display font-semibold ${s.text} truncate`} style={{ color }}>
          6.7 Coffee
        </span>
      ) : null}
    </div>
  )
}

/** Brand panel (styleboard right: large mark + Coffee). */
export function BrandPanelMark({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center text-white ${className}`}>
      <AlpacaMark size={52} color="#FFFFFF" />
      <span className="font-display font-semibold text-[14px] tracking-wide mt-1 text-white/90">Coffee</span>
    </div>
  )
}
