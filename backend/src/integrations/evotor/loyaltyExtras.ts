/**
 * Evotor Cloud nests app-specific receipt extras under extras[appId], not always at extras.sc.
 * APK writes: extras["151071e8-…"].sc = { v, c, free, cb, ts, op? }
 * Flat extras.sc is still accepted for tests / older builds.
 */
import { evotorConfig } from '../../config'

export function extractScRaw(extras: unknown): unknown {
  if (!extras || typeof extras !== 'object' || Array.isArray(extras)) return null
  const e = extras as Record<string, unknown>
  if (e.sc != null) return e.sc

  const appId = evotorConfig.appId?.trim()
  if (appId) {
    const nested = e[appId]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const sc = (nested as Record<string, unknown>).sc
      if (sc != null) return sc
    }
  }

  for (const v of Object.values(e)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sc = (v as Record<string, unknown>).sc
      if (sc != null) return sc
    }
  }
  return null
}

export function hasLoyaltySc(extras: unknown): boolean {
  return extractScRaw(extras) != null
}
