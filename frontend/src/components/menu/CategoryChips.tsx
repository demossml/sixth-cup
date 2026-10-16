import { useEffect, useRef } from 'react'

type Cat = { id: number; name: string }
type Props = {
  categories: Cat[]
  /** null — ни один чип не активен (идёт поиск по всему меню). */
  active: number | 'all' | null
  onSelect: (id: number | 'all') => void
}

const chip = (on: boolean) =>
  `shrink-0 px-4 min-h-10 rounded-full text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${
    on ? 'bg-brand text-white' : 'bg-white text-ink-secondary border border-line active:bg-brand-tint'
  }`

/** Горизонтальные чипы. Активный всегда подкручивается в видимую область. */
export default function CategoryChips({ categories, active, onSelect }: Props) {
  const rail = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = rail.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [active])

  return (
    <div ref={rail} role="group" aria-label="Категории меню" className="flex gap-2 overflow-x-auto scrollbar-none -mx-4 px-4">
      <button type="button" onClick={() => onSelect('all')} aria-pressed={active === 'all'} className={chip(active === 'all')}>
        Все
      </button>
      {categories.map((c) => (
        <button key={c.id} type="button" onClick={() => onSelect(c.id)} aria-pressed={active === c.id} className={chip(active === c.id)}>
          {c.name}
        </button>
      ))}
    </div>
  )
}
