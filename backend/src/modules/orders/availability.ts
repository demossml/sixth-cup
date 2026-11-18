/**
 * H-01 — серверная доступность точки и товара.
 *
 * До этой проверки `quote` и `create` смотрели только на `products.available`:
 * товар, выключенный в конкретной точке (`product_store_links.enabled = 0`),
 * или точка закрытой организации принимались как обычные. Клиент мог этого не
 * показывать (кэш меню, старая версия PWA), поэтому проверка должна быть здесь.
 *
 * Правила намеренно «мягкие», чтобы не сломать рабочий поток:
 *  • организация без записи в `organizations`/с `active = 1` — продаём;
 *  • точка без привязок к Эвотору — продаём (нечего сверять);
 *  • товар блокируется только если он **явно выключен** в этой точке
 *    (`product_store_links.enabled = 0`); отсутствие строки привязки — не запрет:
 *    иначе любой товар, заведённый без синхронизации, пропал бы из предзаказа;
 *  • нет таблицы/колонки в старой базе — не блокируем (проверка информативная, не критическая).
 */

/** Достаточно структуры prepare() — тестовые обёртки не обязаны быть полным Database. */
type Db = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown
    all: (...args: unknown[]) => unknown[]
  }
}

export type AvailabilityCode = 'store_unavailable' | 'product_unavailable'

export class AvailabilityError extends Error {
  code: AvailabilityCode
  constructor(code: AvailabilityCode, message: string) {
    super(message)
    this.code = code
  }
}

/** `store_uuid` этой точки по данным синхронизации Эвотора. */
export function storeUuidsOf(db: Db, storeId: number): string[] {
  try {
    return (db.prepare('SELECT store_uuid AS uuid FROM evotor_stores WHERE local_store_id = ?')
      .all(storeId) as { uuid: unknown }[])
      .map((r) => String(r.uuid))
      .filter(Boolean)
  } catch {
    return []
  }
}

/** Точка существует и её организация не выключена. */
export function assertStoreSellable(db: Db, storeId: number): void {
  let row: { id: number; orgActive: number | null } | undefined
  try {
    row = db.prepare(
      `SELECT s.id AS id, o.active AS orgActive
         FROM stores s LEFT JOIN organizations o ON o.id = s.organization_id
        WHERE s.id = ?`,
    ).get(storeId) as { id: number; orgActive: number | null } | undefined
  } catch {
    // Нет `organizations`/`stores.organization_id` (старая или урезанная база) — не блокируем.
    return
  }
  if (!row) throw new AvailabilityError('store_unavailable', 'Точка не найдена')
  if (row.orgActive != null && Number(row.orgActive) === 0) {
    throw new AvailabilityError('store_unavailable', 'Точка закрыта: организация отключена')
  }
}

/** Товар продаётся в точке: блокируем только явно выключенные привязки. */
export function assertProductSellableAtStores(db: Db, productId: number | string, storeUuids: string[]): void {
  if (!storeUuids.length) return
  try {
    const placeholders = storeUuids.map(() => '?').join(',')
    const disabled = db.prepare(
      `SELECT COUNT(*) AS n FROM product_store_links
        WHERE product_id = ? AND store_uuid IN (${placeholders}) AND enabled = 0`,
    ).get(Number(productId) || -1, ...storeUuids) as { n: number } | undefined
    if (disabled?.n) throw new AvailabilityError('product_unavailable', 'Товар недоступен в этой точке')
  } catch (e) {
    if (e instanceof AvailabilityError) throw e
    // Нет таблицы привязок — проверять нечего.
    return
  }
}

export function assertProductSellableAtStore(db: Db, productId: number | string, storeId: number): void {
  assertProductSellableAtStores(db, productId, storeUuidsOf(db, storeId))
}
