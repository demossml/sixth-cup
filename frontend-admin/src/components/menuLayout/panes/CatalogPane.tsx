import { ImagePlus, Plus, Search } from 'lucide-react'
import { cx, Spinner } from '../../../ui/kit'
import type { BlockType, CatalogProduct } from '../../../lib/menuLayout'

export type CatalogPaneProps = {
  search: string
  setSearch: (value: string) => void
  showAllProducts: boolean
  setShowAllProducts: (value: boolean) => void
  catFilter: number | 'all'
  setCatFilter: (value: number | 'all') => void
  categories: { id: number; name: string }[]
  /** Товары с учётом поиска и фильтров — фильтрация живёт в редакторе. */
  filtered: CatalogProduct[]
  catalogLoading: boolean
  seedFromCatalog: () => Promise<void> | void
  /** Что делать с товаром: на холст или в «Места» — решает редактор. */
  onPickProduct: (product: CatalogProduct) => void
  addBlock: (type: BlockType, extra?: { categoryId?: number; titleOverride?: string }) => void
}

/**
 * Левая панель «Каталог»: поиск, фильтры, список товаров и быстрые добавления.
 * Вынесена из редактора, чтобы страница не разрасталась монолитом.
 */
export default function CatalogPane({
  search,
  setSearch,
  showAllProducts,
  setShowAllProducts,
  catFilter,
  setCatFilter,
  categories,
  filtered,
  catalogLoading,
  seedFromCatalog,
  onPickProduct,
  addBlock,
}: CatalogPaneProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-3 py-2.5">
        <label className="flex min-h-9 items-center gap-2 rounded-lg border border-line bg-white px-2">
          <Search size={15} className="text-ink-tertiary" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Найти товар"
            className="w-full bg-transparent text-[13px] outline-none"
          />
        </label>
        <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => setShowAllProducts(false)}
            aria-pressed={!showAllProducts}
            className={cx(
              'rounded-full border px-2.5 py-1',
              !showAllProducts ? 'border-brand bg-brand text-white' : 'border-line text-ink-secondary',
            )}
          >
            Доступные
          </button>
          <button
            type="button"
            onClick={() => setShowAllProducts(true)}
            aria-pressed={showAllProducts}
            className={cx(
              'rounded-full border px-2.5 py-1',
              showAllProducts ? 'border-brand bg-brand text-white' : 'border-line text-ink-secondary',
            )}
          >
            Весь каталог
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setCatFilter('all')}
            className={cx('rounded-full border px-2.5 py-1 text-[11px] font-semibold', catFilter === 'all' ? 'border-brand bg-brand text-white' : 'border-line text-ink-secondary')}
          >
            Все
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCatFilter(c.id)}
              className={cx('rounded-full border px-2.5 py-1 text-[11px] font-semibold', catFilter === c.id ? 'border-brand bg-brand text-white' : 'border-line text-ink-secondary')}
            >
              {c.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void seedFromCatalog()}
          className="mt-2 w-full rounded-lg border border-dashed border-line px-2 py-1.5 text-[12px] font-semibold text-brand hover:border-brand"
        >
          Собрать лист из каталога
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {catalogLoading && <Spinner label="Загрузка каталога…" />}
        {filtered.length === 0 && <p className="px-2 py-3 text-[13px] text-ink-secondary">Ничего не найдено.</p>}
        <ul className="space-y-1">
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPickProduct(p)}
                className="flex w-full items-center gap-2 rounded-lg border border-transparent px-1.5 py-1.5 text-left hover:border-line hover:bg-surface-2"
              >
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="h-9 w-9 flex-none rounded-md bg-surface-2 object-cover" />
                ) : (
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-md bg-surface-2 text-ink-tertiary">
                    <ImagePlus size={14} aria-hidden />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{p.name}</span>
                  <span className="block truncate text-[11px] text-ink-tertiary">
                    {p.price} ₽{p.variantLabel ? ` · ${p.variantLabel}` : ''}
                    {!p.available ? ' · не в продаже' : ''}
                  </span>
                </span>
                <Plus size={15} className="flex-none text-brand" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 rounded-lg border border-dashed border-line p-2">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Добавить на холст</p>
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['text', 'Текст'],
                ['image', 'Фото'],
                ['logo', 'Лого'],
                ['divider', 'Линия'],
              ] as [BlockType, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => addBlock(t)}
                className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-secondary hover:border-brand hover:text-brand"
              >
                + {label}
              </button>
            ))}
          </div>
          {categories.length > 0 && (
            <>
              <p className="mt-2 mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Заголовок категории</p>
              <div className="flex flex-wrap gap-1">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => addBlock('category', { categoryId: c.id, titleOverride: c.name })}
                    className="rounded-full border border-line px-2 py-1 text-[11px] text-ink-secondary hover:border-brand hover:text-brand"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
