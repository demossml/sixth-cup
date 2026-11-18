import { timingSafeEqual } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import { config } from '../config'
import { bad } from '../lib/errors'

let warnedMissing = false

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** Strip optional Bearer prefix and compare to EVOTOR_PROXY_TOKEN. */
export function checkEvotorProxyAuth(header: string | undefined): boolean {
  if (!config.evotorProxyToken) return !config.evotorProxyEnforce
  if (!header) return false
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim()
  return tokensEqual(raw, config.evotorProxyToken)
}

/**
 * P0-01: проверка credential кассы в закрытом режиме.
 *
 * В отличие от `checkEvotorProxyAuth` (он нужен только для диагностики `/ping`
 * и намеренно «мягкий»), здесь пустой `EVOTOR_PROXY_TOKEN` означает «контур не
 * настроен» → `false`. Раньше отсутствие переменной превращало защиту в no-op.
 */
export function proxyCredentialValid(header: string | undefined): boolean {
  if (!config.evotorProxyToken) return false
  if (!header) return false
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim()
  return tokensEqual(raw, config.evotorProxyToken)
}

export const evotorProxy = createMiddleware(async (c, next) => {
  if (!config.evotorProxyToken) {
    if (!warnedMissing) {
      warnedMissing = true
      console.warn('[evotor] EVOTOR_PROXY_TOKEN not set — proxy auth disabled (set EVOTOR_PROXY_ENFORCE=1 to require it)')
    }
    return next()
  }
  const auth = c.req.header('Authorization')
  if (!checkEvotorProxyAuth(auth)) {
    if (config.evotorProxyEnforce || c.req.path.includes('/devices/ping')) {
      // always enforce on ping when token is configured so diagnostics work
    }
    if (config.evotorProxyEnforce) {
      throw bad('proxy_forbidden', 403)
    }
    // soft mode: allow direct enroll during transition, still log
    console.warn('[evotor] Authorization missing or mismatch (soft mode)')
  }
  await next()
})

/**
 * Строгий контур кассовых операций (P0-01).
 *
 * Раньше без `EVOTOR_PROXY_TOKEN` middleware молча пропускал запрос (`next()`),
 * т.е. «закрытый» контур открывался сам собой при неполной конфигурации.
 * Теперь без токена отдаём 503, а в production приложение вообще не стартует
 * (проверка в `config.ts`).
 */
export const evotorProxyStrict = createMiddleware(async (c, next) => {
  if (!config.evotorProxyToken) {
    if (!warnedMissing) {
      warnedMissing = true
      console.error('[evotor] EVOTOR_PROXY_TOKEN not set — cash-register API is closed (503)')
    }
    throw bad('proxy_not_configured', 503)
  }
  if (!proxyCredentialValid(c.req.header('Authorization'))) {
    throw bad('proxy_forbidden', 403)
  }
  await next()
})
