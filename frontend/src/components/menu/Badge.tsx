import { BADGE_LABEL, type BadgeKind } from '../../lib/menuModel'

const STYLE: Record<BadgeKind, string> = {
  new: 'bg-brand text-white',
  hit: 'bg-ink text-white',
  seasonal: 'bg-white text-ink border border-line',
}

/** Один бейдж продаж. Цвет не единственный носитель смысла — всегда есть текст. */
export default function Badge({ kind, className = '' }: { kind: BadgeKind; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] leading-4 font-semibold shadow-card ${STYLE[kind]} ${className}`}
    >
      {BADGE_LABEL[kind]}
    </span>
  )
}
