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

export const evotorProxyStrict = createMiddleware(async (c, next) => {
  if (!config.evotorProxyToken) {
    if (!warnedMissing) {
      warnedMissing = true
      console.warn('[evotor] EVOTOR_PROXY_TOKEN not set')
    }
    return next()
  }
  const auth = c.req.header('Authorization')
  if (!checkEvotorProxyAuth(auth)) {
    throw bad('proxy_forbidden', 403)
  }
  await next()
})
