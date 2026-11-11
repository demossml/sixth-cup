/**
 * Выбор вкладки «Себестоимость» по URL. Чистая функция: экран только читает результат.
 * `focus=missing` приходит из импорта техкарты и внешних ссылок.
 */
export type CostTabKey = 'tech' | 'fill' | 'recipes' | 'summary' | 'signals'

export function initialCostTab(focus: string | null): CostTabKey {
  if (focus === 'missing') return 'fill'
  if (focus === 'signals') return 'signals'
  if (focus === 'recipes') return 'recipes'
  if (focus === 'summary') return 'summary'
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
