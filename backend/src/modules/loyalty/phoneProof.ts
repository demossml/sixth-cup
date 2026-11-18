/**
 * P0-02: «device proof» для списания по телефону.
 *
 * Телефон сам по себе — знание, а не credential: номер могли узнать/подсмотреть.
 * Поэтому списание по телефону разрешаем только если **эта же касса** только что
 * нашла этого клиента (`POST /api/devices/customers/lookup|register`). Тогда у нас есть
 * подтверждённое намерение кассира и привязка к устройству/точке.
 *
 * Хранение — в уже существующей таблице `rate_limits` (key/window_start), без миграции:
 * ключ `phone-proof:<device>:<phone>`, `window_start` = время подтверждения.
 * Мусорные ключи подчищаются лениво при каждой записи.
 */
import { db } from '../../db'

/** Сколько живёт подтверждение телефона кассой. */
export const PHONE_PROOF_TTL_MS = 10 * 60_000

/** Ключ устройства для proof: терминал, иначе точка, иначе общий — как в других лимитах. */
export function deviceKeyOf(deviceUuid?: string | null, storeUuid?: string | null): string {
  const raw = (deviceUuid || storeUuid || 'any').trim()
  return raw.slice(0, 64) || 'any'
}

function proofKey(deviceKey: string, phone: string): string {
  return `phone-proof:${deviceKey}:${phone}`
}

/** Касса подтвердила номер: поиск/регистрация клиента завершились успешно. */
export function recordPhoneProof(deviceKey: string, phone: string, now = Date.now()): void {
  if (!phone) return
  try {
    db.prepare('INSERT OR REPLACE INTO rate_limits(key,count,window_start) VALUES(?,?,?)')
      .run(proofKey(deviceKey, phone), 1, now)
    // Ленивая уборка просроченных подтверждений, чтобы таблица не росла бесконечно.
    db.prepare("DELETE FROM rate_limits WHERE key LIKE 'phone-proof:%' AND window_start < ?").run(now - PHONE_PROOF_TTL_MS)
  } catch {
    // Подтверждение — вспомогательный механизм: его отсутствие не должно ронять lookup.
  }
}

/** Было ли подтверждение номера с этого устройства за последние `ttlMs`. */
export function hasPhoneProof(deviceKey: string, phone: string, now = Date.now(), ttlMs = PHONE_PROOF_TTL_MS): boolean {
  if (!phone) return false
  try {
    const row = db.prepare('SELECT window_start FROM rate_limits WHERE key=?')
      .get(proofKey(deviceKey, phone)) as { window_start: number } | undefined
    return Boolean(row && now - row.window_start <= ttlMs && now >= row.window_start)
  } catch {
    return false
  }
}
