/** Наш логотип: public/logo-mark.png + «6.7 Coffee». Без mix-blend. */
type Props = {
  tone?: 'onDark' | 'onLight'
  size?: 'sm' | 'md'
  className?: string
}

export default function AppLogo({ tone = 'onDark', size = 'sm', className = '' }: Props) {
  const mark = size === 'md' ? 'w-9 h-9' : 'w-8 h-8'
  const text = size === 'md' ? 'text-[16px]' : 'text-[15px]'
  const color = tone === 'onDark' ? 'text-white' : 'text-brand'
  return (
    <div className={`inline-flex items-center gap-2 min-w-0 ${className}`}>
      <img
        src="/logo-mark.png"
        alt=""
        width={size === 'md' ? 36 : 32}
        height={size === 'md' ? 36 : 32}
        className={`${mark} rounded-xl object-contain shrink-0 ${tone === 'onDark' ? 'bg-brand' : 'bg-brand-tint'}`}
      />
      <span className={`font-display font-semibold ${text} leading-5 truncate ${color}`}>6.7 Coffee</span>
    </div>
  )
}
