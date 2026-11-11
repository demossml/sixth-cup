/**
 * Выбор вкладки «Себестоимость» по URL. Чистая функция: экран только читает результат.
 * `focus=missing` приходит из импорта техкарты и внешних ссылок.
 */
export type CostTabKey = 'tech' | 'items' | 'overheads' | 'signals' | 'summary'

export function initialCostTab(focus: string | null): CostTabKey {
  // `missing` — старая ссылка «показать позиции без цены»: теперь это «Ингредиенты».
  if (focus === 'missing' || focus === 'items' || focus === 'fill') return 'items'
  if (focus === 'overheads' || focus === 'expenses') return 'overheads'
  if (focus === 'signals') return 'signals'
  if (focus === 'summary') return 'summary'
  // `recipes` из старых ссылок ведёт туда же, где теперь живут карты.
  // По умолчанию — «Техкарты»: раздел про карты и себестоимость, а не про справочник.
  return 'tech'
}

/** Нужно ли один раз переключить на «Дозаполнить», когда пришёл справочник с незаполненными ценами. */
export function shouldAutoFocusMissing(
  opts: { focusMissing: boolean; userPicked: boolean; alreadyDone: boolean; hasData: boolean; missingCount: number },
): boolean {
  if (opts.focusMissing || opts.userPicked || opts.alreadyDone || !opts.hasData) return false
  return opts.missingCount > 0
}
