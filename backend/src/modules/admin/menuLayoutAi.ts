/**
 * AI-помощник макета (аудит, этап 5): сначала предложение, потом применение.
 *
 * Модель никогда не пишет документ напрямую. Она возвращает **операции** над секциями,
 * сервер их валидирует и применяет. Без ключа AI работает разбор по правилам — так функцию
 * можно тестировать и показывать без внешних вызовов.
 */
import { db } from '../../db'
import { loadCatalogProducts, type MenuDoc, type MenuSection, type MenuItem } from './menuLayoutDoc'

export type MenuOp =
  | { kind: 'add-section'; title: string; categoryId: number | null; productIds: number[] }
  | { kind: 'add-items'; sectionId: string; productIds: number[] }
  | { kind: 'hide-item'; sectionId: string; itemId: string }
  | { kind: 'remove-item'; sectionId: string; itemId: string }
  | { kind: 'rename-section'; sectionId: string; title: string }
  | { kind: 'reorder-items'; sectionId: string; itemIds: string[] }

export type MenuPlan = { summary: string; ops: MenuOp[] }

const STOP = new Set(['меню', 'лист', 'сделай', 'добавь', 'убери', 'пожалуйста', 'все', 'всё', 'и', 'на'])

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))

/**
 * Разбор без модели: «добавь напитки», «убери корицу», «переименуй добавки в топпинги».
 * Понимает намерение по ключевым словам и ищет совпадения в каталоге и секциях.
 */
export function proposeByRules(prompt: string, doc: MenuDoc): MenuPlan {
  const text = prompt.toLowerCase()
  const sections = doc.pages.flatMap((p) => p.sections ?? [])
  const tokens = words(prompt)

  // В JS \b и \w работают только с ASCII — для кириллицы используем явные классы.
  const rename = /переимен[а-яё]*\s+(.+?)\s+в\s+(.+)$/i.exec(prompt)
  if (rename) {
    const [, from, to] = rename
    const target = sections.find((s) => s.title.toLowerCase().includes(from!.trim().toLowerCase()))
    if (target) {
      return {
        summary: `Переименовать «${target.title}» в «${to!.trim()}»`,
        ops: [{ kind: 'rename-section', sectionId: target.id, title: to!.trim() }],
      }
    }
  }

  if (/(убери|убрать|скрой|скрыть)/.test(text)) {
    const catalog = loadCatalogProducts(
      sections.flatMap((s) => s.items.map((it) => it.productId)).filter((n): n is number => n != null),
    )
    for (const section of sections) {
      for (const item of section.items) {
        const name = (item.titleOverride ?? catalog.get(item.productId ?? -1)?.name ?? '').toLowerCase()
        // Русские окончания: сравниваем по корню («корицу» ↔ «корица»).
        const stem = (w: string) => w.slice(0, Math.min(5, w.length))
        if (name && tokens.some((t) => name.includes(t) || stem(name).startsWith(stem(t)))) {
          return {
            summary: `Убрать «${item.titleOverride}» из «${section.title}»`,
            ops: [{ kind: 'hide-item', sectionId: section.id, itemId: item.id }],
          }
        }
      }
    }
  }

  // «добавь напитки» / «добавь кофе» — ищем категорию каталога по слову.
  const cats = db.prepare('SELECT id, name FROM categories WHERE available=1 ORDER BY sort_order, id').all() as {
    id: number
    name: string
  }[]
  const cat = cats.find((c) => tokens.some((t) => c.name.toLowerCase().includes(t)))
  if (cat) {
    const products = db
      .prepare('SELECT id FROM products WHERE available=1 AND category_id=? ORDER BY sort_order, id LIMIT 40')
      .all(cat.id) as { id: number }[]
    const present = new Set(
      sections.flatMap((s) => s.items.map((i) => i.productId)).filter((n): n is number => n != null),
    )
    const fresh = products.map((p) => Number(p.id)).filter((id) => !present.has(id))
    if (fresh.length === 0) {
      return { summary: `В категории «${cat.name}» уже всё на листе`, ops: [] }
    }
    const existing = sections.find((s) => s.categoryId === cat.id)
    return {
      summary: existing
        ? `Добавить в «${existing.title}» позиций: ${fresh.length}`
        : `Создать секцию «${cat.name}» и добавить позиций: ${fresh.length}`,
      ops: existing
        ? [{ kind: 'add-items', sectionId: existing.id, productIds: fresh }]
        : [{ kind: 'add-section', title: cat.name, categoryId: cat.id, productIds: fresh }],
    }
  }

  return { summary: 'Не понял запрос — уточните категорию или позицию', ops: [] }
}

/** Применить операции к документу. Чистая функция: ничего не пишет в БД. */
export function applyOps(doc: MenuDoc, ops: MenuOp[]): { doc: MenuDoc; changed: number } {
  let changed = 0
  let pages = doc.pages.map((p) => ({ ...p, sections: p.sections ? [...p.sections] : p.sections }))
  const itemsFor = (productIds: number[]): MenuItem[] => {
    const catalog = loadCatalogProducts(productIds)
    return productIds.map((id) => {
      const product = catalog.get(id)
      const sizes = product?.sizes ?? []
      return {
        id: `it-${id}-${Math.random().toString(36).slice(2, 7)}`,
        productId: id,
        groupId: null,
        titleOverride: null,
        description: null,
        badge: null,
        showPhoto: !!product?.imageUrl,
        photoUrlOverride: null,
        hidden: false,
        sizes: sizes.map((sz) => ({
          label: sz.label,
          source: 'catalog' as const,
          productId: sz.productId,
          volumeItemId: sz.volumeItemId,
          priceRubOverride: null,
        })),
      }
    })
  }

  for (const op of ops) {
    const firstPage = pages[0]
    if (!firstPage) break
    const sections: MenuSection[] = firstPage.sections ? [...firstPage.sections] : []
    if (op.kind === 'add-section') {
      sections.push({
        id: `sec-${op.categoryId ?? 'ai'}-${Math.random().toString(36).slice(2, 6)}`,
        title: op.title,
        categoryId: op.categoryId,
        style: { showPhotos: true },
        items: itemsFor(op.productIds),
      })
      changed += 1
      pages[0] = { ...firstPage, sections }
      continue
    }
    const idx = sections.findIndex((s) => s.id === op.sectionId)
    if (idx < 0) continue
    const section = sections[idx]!
    if (op.kind === 'add-items') {
      sections[idx] = { ...section, items: [...section.items, ...itemsFor(op.productIds)] }
      changed += op.productIds.length
    } else if (op.kind === 'hide-item') {
      sections[idx] = { ...section, items: section.items.map((it) => (it.id === op.itemId ? { ...it, hidden: true } : it)) }
      changed += 1
    } else if (op.kind === 'remove-item') {
      sections[idx] = { ...section, items: section.items.filter((it) => it.id !== op.itemId) }
      changed += 1
    } else if (op.kind === 'rename-section') {
      sections[idx] = { ...section, title: op.title }
      changed += 1
    } else if (op.kind === 'reorder-items') {
      const order = new Map(op.itemIds.map((id, i) => [id, i]))
      sections[idx] = {
        ...section,
        items: [...section.items].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99)),
      }
      changed += 1
    }
    pages[0] = { ...firstPage, sections }
  }

  return { doc: { ...doc, pages }, changed }
}
