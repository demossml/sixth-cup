/**
 * Single-flight по ключу (точка Эвотор). Две одновременные операции над одной точкой
 * (wipe-catalog, sync, push) гоняются за одни и те же товары в облаке и дают 400 от Эвотор,
 * поэтому второй вызов получает 409, а не встаёт в очередь.
 *
 * Хранится в памяти процесса: если backend перезапустится посреди операции, блокировка просто исчезнет.
 */
const active = new Map<string, { op: string; since: number }>()

/**
 * Один ключ на точку: wipe, sync, push и purge не должны идти одновременно —
 * иначе удаление и выгрузка гоняются за одни и те же товары в облаке.
 */
export function lockKey(storeUuid: string): string {
  return `store:${storeUuid}`
}

/** Занять блокировку. false — ключ уже занят другой операцией. */
export function tryLock(key: string, op: string, now = Date.now()): boolean {
  if (active.has(key)) return false
  active.set(key, { op, since: now })
  return true;
}

export function unlock(key: string): void {
  active.delete(key)
}

/** Что сейчас выполняется по ключу (для текста ошибки). */
export function lockedBy(key: string): { op: string; since: number } | null {
  return active.get(key) ?? null;
}

/** Только для тестов: сбросить все блокировки. */
export function resetLocks(): void {
  active.clear()
}
