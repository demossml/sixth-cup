import { Link } from 'react-router-dom'
import { HelpCircle } from 'lucide-react'
import { cx } from '../ui/kit'

export function HelpLink({
  article,
  label = 'Справка',
  className,
}: {
  article: string
  label?: string
  className?: string
}) {
  return (
    <Link
      to={`/help?a=${encodeURIComponent(article)}`}
      className={cx('help-link', className)}
      title={label}
    >
      <HelpCircle size={14} aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  )
}
