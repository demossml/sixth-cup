import { ArrowDown, ArrowUp, Eye, EyeOff, Trash2 } from 'lucide-react'
import { cx } from '../../../ui/kit'
import {
  itemCount, moveItem, removeItem, renameSection, toggleItemHidden,
  type MenuDoc, type MenuSection,
} from '../../../lib/menuLayout'

export type PlacesPaneProps = {
  sections: { section: MenuSection }[]
  doc: MenuDoc
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  /** Переименование, порядок и скрытие позиций пересобирают лист на сервере. */
  applySections: (next: MenuDoc) => Promise<void> | void
  /** Подпись товара для строки списка. */
  catalogName: (productId: number | null) => string
  setLeftTab: (tab: 'catalog') => void
}

/**
 * Левая панель «Места»: секции листа и позиции в них.
 * Правки меняют документ, пересборку блоков делает редактор через `applySections`.
 */
export default function PlacesPane({
  sections,
  doc,
  selectedId,
  setSelectedId,
  applySections,
  catalogName,
  setLeftTab,
}: PlacesPaneProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {sections.length === 0 && (
        <p className="p-2 text-[13px] text-ink-secondary">
          Секций пока нет. Нажмите «Собрать лист из каталога» — категории станут секциями, а позиции можно будет
          двигать списком.
        </p>
      )}
      <ul className="space-y-2">
        {sections.map(({ section }) => (
          <li key={section.id} className="rounded-lg border border-line">
            <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
              <input
                value={section.title}
                onChange={(e) => void applySections(renameSection(doc, section.id, e.target.value))}
                aria-label={`Название секции ${section.title}`}
                className="min-w-0 flex-1 truncate border-0 bg-transparent text-[13px] font-semibold outline-none focus:underline"
              />
              <span className="flex-none text-[11px] text-ink-tertiary">{itemCount(section)}</span>
            </div>
            <ul className="space-y-0.5 p-1">
              {section.items.map((it, idx) => (
                <li
                  key={it.id}
                  className={cx(
                    'flex items-center gap-1 rounded px-1 py-0.5',
                    selectedId === `p-${it.id}` ? 'bg-surface-2' : 'hover:bg-surface-2',
                    it.hidden && 'opacity-50',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(`p-${it.id}`)}
                    className="min-w-0 flex-1 truncate text-left text-[12.5px]"
                  >
                    {it.titleOverride ?? catalogName(it.productId)}
                    {it.sizes.length > 1 && <span className="ml-1 text-ink-tertiary">· {it.sizes.length} объёма</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => void applySections(moveItem(doc, section.id, it.id, -1))}
                    disabled={idx === 0}
                    className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-brand disabled:opacity-30"
                    aria-label="Выше"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void applySections(moveItem(doc, section.id, it.id, 1))}
                    disabled={idx === section.items.length - 1}
                    className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-brand disabled:opacity-30"
                    aria-label="Ниже"
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void applySections(toggleItemHidden(doc, section.id, it.id))}
                    className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-brand"
                    aria-label={it.hidden ? 'Вернуть в меню' : 'Убрать из меню'}
                  >
                    {it.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void applySections(removeItem(doc, section.id, it.id))}
                    className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-bad"
                    aria-label="Удалить позицию"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
              {section.items.length === 0 && <li className="px-1 py-1 text-[12px] text-ink-tertiary">Пусто</li>}
            </ul>
          </li>
        ))}
      </ul>
      {sections.length > 0 && (
        <button
          type="button"
          onClick={() => setLeftTab('catalog')}
          className="mt-2 w-full rounded-lg border border-dashed border-line px-2 py-1.5 text-[12px] font-semibold text-brand hover:border-brand"
        >
          Добавить позицию из каталога
        </button>
      )}
    </div>
  )
}
