/**
 * Стабильная связка «товар backend ↔ товар Эвотор».
 *
 * `article_number` уезжает в Evotor Cloud при выгрузке и доступен на терминале в
 * `ProductTable.ROW_CODE` ("CODE"). В отличие от UUID (зависит от точки) и названия
 * (переименования, коллизии), артикул создаётся один раз из `products.id`.
 *
 * Формат намеренно простой и неизменный: `sc-<id>` для товара, `sc-g-<id>` для папки.
 */
export const PRODUCT_ARTICLE_PREFIX = 'sc-'
export const GROUP_ARTICLE_PREFIX = 'sc-g-'

export function productArticleNumber(id: number): string {
  return `${PRODUCT_ARTICLE_PREFIX}${id}`
}

export function groupArticleNumber(id: number): string {
  return `${GROUP_ARTICLE_PREFIX}${id}`
}

/** `sc-42` → 42 (папки `sc-g-…` не считаются товаром). */
export function parseProductArticleNumber(value: unknown): number | null {
  const m = /^sc-(\d+)$/.exec(String(value ?? '').trim())
  if (!m) return null
  const id = Number(m[1])
  return Number.isInteger(id) && id > 0 ? id : null
}

export function parseGroupArticleNumber(value: unknown): number | null {
  const m = /^sc-g-(\d+)$/.exec(String(value ?? '').trim())
  if (!m) return null
  const id = Number(m[1])
  return Number.isInteger(id) && id > 0 ? id : null
}
