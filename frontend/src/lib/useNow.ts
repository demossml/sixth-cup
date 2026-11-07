import { useEffect, useState } from 'react'

/**
 * Тикающее «сейчас» для обратных отсчётов.
 *
 * Без него подписи вида «00:29:59» или «23 ч 59 мин» замирают до следующего рендера:
 * состояние приходит по опросу раз в 20 с, а минуты должны идти сами.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
