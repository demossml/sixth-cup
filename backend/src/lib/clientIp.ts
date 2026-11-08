/**
 * IP клиента для лимитов и аудита (P1-2).
 *
 * `X-Forwarded-For` подделывается кем угодно, поэтому доверяем ему только когда перед сервисом
 * стоит наш прокси и это явно включено (`TRUST_PROXY_HEADERS=1`). Иначе возвращаем `null`,
 * и вызывающий код либо не лимитирует по IP, либо пишет `unknown` — но не создаёт «общий» счётчик,
 * под который подпадают все клиенты сразу.
 */
import { config } from '../config'

type HasHeaders = { req: { header: (name: string) => string | undefined } }

export function clientIp(c: HasHeaders): string | null {
  if (config.trustProxyHeaders !== true) return null
  const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  if (xff) return xff.slice(0, 64)
  const real = c.req.header('x-real-ip')?.trim()
  return real ? real.slice(0, 64) : null
}

/** Ключ для таблицы `rate_limits`: по IP, если он известен; иначе `null` — лимит не по IP. */
export function clientIpKey(c: HasHeaders, scope: string): string | null {
  const ip = clientIp(c)
  return ip ? `${scope}:${ip}` : null
}
