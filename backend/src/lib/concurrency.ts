/**
 * Ограниченный параллелизм: обрабатываем до `limit` элементов одновременно.
 * Нужен для опроса точек Эвотора — последовательно слишком медленно, без лимита
 * легко упереться в rate limit облака.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const size = Math.max(1, Math.min(limit, items.length || 1))
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: size }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i] as T, i)
    }
  })
  await Promise.all(workers)
  return out
}
