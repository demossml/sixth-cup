import { useEffect, useRef } from 'react'

type Cat = { id: number; name: string }
type Props = {
  categories: Cat[]
  /** null — ни один чип не активен (идёт поиск по всему меню). */
  active: number | 'all' | null
  onSelect: (id: number | 'all') => void
}

// Steel: капсула с рамкой 2px, тач-таргет ≥ 44 (§11), выбранное состояние — заливка акцентом.
// Толщина рамки одна и у выбранного, и у обычного чипа, поэтому соседи не сдвигаются.
const chip = (on: boolean) =>
  `shrink-0 px-4 min-h-11 rounded-full text-[14px] leading-5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 border-2 ${
    on
      ? 'bg-brand text-white border-brand'
      : 'bg-white text-ink-secondary border-line active:bg-brand-tint'
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
