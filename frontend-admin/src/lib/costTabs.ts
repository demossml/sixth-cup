/**
 * Выбор вкладки «Себестоимость» по URL. Чистая функция: экран только читает результат.
 * `focus=missing` приходит из импорта техкарты и внешних ссылок.
 */
export type CostTabKey = 'fill' | 'recipes' | 'summary'

export function initialCostTab(focus: string | null): CostTabKey {
  return focus === 'missing' ? 'fill' : 'recipes'
}

/** Нужно ли один раз переключить на «Дозаполнить», когда пришёл справочник с незаполненными ценами. */
export function shouldAutoFocusMissing(
  opts: { focusMissing: boolean; userPicked: boolean; alreadyDone: boolean; hasData: boolean; missingCount: number },
): boolean {
  if (opts.focusMissing || opts.userPicked || opts.alreadyDone || !opts.hasData) return false
  return opts.missingCount > 0
}
