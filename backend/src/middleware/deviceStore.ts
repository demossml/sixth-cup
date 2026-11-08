import { createMiddleware } from 'hono/factory'
import { db } from '../db'
import { bad } from '../lib/errors'
import { hashToken } from './device'
import type { DeviceEnv } from './device'

/** Точка кассы по uuid Эвотора: основная связь — `evotor_stores.local_store_id`. */
/** Единственная точка в системе (одноточечная установка) — принимается, только если она одна. */
function onlyStoreId(): number | null {
  try {
    const rows = db.prepare('SELECT id FROM stores ORDER BY id LIMIT 2').all() as { id: number }[]
    return rows.length === 1 ? Number(rows[0]!.id) : null
  } catch {
    return null
  }
}

export function storeIdFromEvotorUuid(storeUuid: string): number | null {
  try {
    const row = db.prepare('SELECT local_store_id AS id FROM evotor_stores WHERE store_uuid=?')
      .get(storeUuid) as { id: number | null } | undefined
    if (row?.id) return Number(row.id)
  } catch { /* таблицы может не быть в минимальной БД */ }
  try {
    const row = db.prepare('SELECT id FROM stores WHERE evotor_uuid=? OR uuid=? LIMIT 1')
      .get(storeUuid, storeUuid) as { id: number } | undefined
    if (row?.id) return Number(row.id)
  } catch { /* колонок может не быть */ }
  // Связь касса↔точка в админке могла не создаваться: в одноточечной установке берём эту точку.
  return onlyStoreId()
}

/**
 * Авторизация кассы для экрана заказов предзаказа.
 *
 * Касса ходит двумя путями:
 *  1) `X-Device-Token` — токен после enroll (смоук, новые сборки);
 *  2) `X-Evotor-Store-Uuid` + `Authorization`, который подставляет облако Эвотора.
 *     Именно так APK зовёт все остальные `/api/devices/*`; enroll в APK нет вообще,
 *     поэтому требование только `X-Device-Token` давало 401 «перепривяжите кассу».
 */
export const deviceStoreAuth = createMiddleware<DeviceEnv>(async (c, next) => {
  const token = c.req.header('X-Device-Token')
  if (token) {
    const d = db.prepare('SELECT id, store_id, revoked FROM devices WHERE token_hash=?')
      .get(hashToken(token)) as { id: number; store_id: number; revoked: number } | undefined
    if (!d || d.revoked) throw bad('Invalid device', 401)
    c.set('deviceId', d.id)
    c.set('storeId', d.store_id)
    await next()
    return
  }
  const storeUuid = (c.req.header('X-Evotor-Store-Uuid') || c.req.query('storeUuid') || '').trim().slice(0, 80)
  // Касса без кэша точки (первый запуск) допускается только в одноточечной установке.
  const storeId = storeUuid ? storeIdFromEvotorUuid(storeUuid) : onlyStoreId()
  if (!storeId) throw bad(storeUuid ? 'unknown_store' : 'Unauthorized', storeUuid ? 404 : 401)
  c.set('deviceId', 0)
  c.set('storeId', storeId)
  await next()
})
