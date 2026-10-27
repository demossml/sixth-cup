import { randomUUID } from 'node:crypto'
import { db } from '../../db'

/**
 * Публичный номер заказа (Queue Number) — короткий номер для гостя и бариста.
 *
 * Правила (зафиксированы, см. docs/QUEUE-NUMBER.md):
 * - выдаётся ТОЛЬКО сервером: локальные счётчики терминалов запрещены, иначе две кассы
 *   одной точки выдают одинаковые номера;
 * - scope — точка (`store_uuid`) + календарный день (`period_key = YYYY-MM-DD`);
 * - формат — 1…3 цифры (максимум `MAX_NUMBER = 999`), при переполнении идём по кругу,
 *   пропуская активные номера;
 * - номер никогда не берётся из фискальных полей Эвотора и не печатается вместо них.
 */
export const MAX_NUMBER = 999

export type QueueNumberStatus = 'ISSUED' | 'BOUND' | 'CANCELLED'

export type QueueNumber = {
  orderId: string
  number: number
  storeUuid: string
  periodKey: string
  status: QueueNumberStatus
  expiresAt: number | null
  createdAt: number
}

type Row = {
  order_id: string
  store_uuid: string
  period_key: string
  number: number
  status: string
  created_at: number
  expires_at: number | null
}

/** Период нумерации: календарный день точки. Одна точка = один период. */
export function periodKeyOf(now = Date.now()): string {
  const d = new Date(now)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Номера, которые ещё «живые» в этом периоде: их нельзя выдавать повторно. */
function activeNumbers(storeUuid: string, periodKey: string): Set<number> {
  const rows = db
    .prepare(`SELECT number FROM queue_numbers WHERE store_uuid=? AND period_key=? AND status IN ('ISSUED','BOUND')`)
    .all(storeUuid, periodKey) as { number: number }[]
  return new Set(rows.map((r) => Number(r.number)))
}

function toQueueNumber(row: Row): QueueNumber {
  return {
    orderId: row.order_id,
    number: Number(row.number),
    storeUuid: row.store_uuid,
    periodKey: row.period_key,
    status: row.status as QueueNumberStatus,
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    createdAt: Number(row.created_at),
  }
}

export function findQueueNumber(orderId: string): QueueNumber | null {
  const row = db.prepare('SELECT * FROM queue_numbers WHERE order_id=?').get(orderId) as Row | undefined
  return row ? toQueueNumber(row) : null
}

/**
 * Выдать номер (или вернуть уже выданный для этого `orderId`).
 * Идемпотентность по `orderId`: повторный запрос с тем же id не тратит новый номер.
 */
export const issueQueueNumber = db.transaction(
  (input: { storeUuid: string; orderId?: string; now?: number; ttlMs?: number }): QueueNumber => {
    const now = input.now ?? Date.now()
    const storeUuid = String(input.storeUuid || '').slice(0, 64)
    if (!storeUuid) throw new Error('store_uuid is required')
    const orderId = (input.orderId && String(input.orderId).slice(0, 64)) || randomUUID()

    const existing = findQueueNumber(orderId)
    if (existing) return existing

    const periodKey = periodKeyOf(now)
    const active = activeNumbers(storeUuid, periodKey)

    const counter = db
      .prepare(
        `INSERT INTO queue_counters(store_uuid, period_key, last_number) VALUES(?,?,1)
         ON CONFLICT(store_uuid, period_key) DO UPDATE SET last_number = last_number + 1
         RETURNING last_number`,
      )
      .get(storeUuid, periodKey) as { last_number: number }

    // Переполнение: счётчик может уйти за 999 — тогда идём по кругу, пропуская активные.
    let number = Math.max(1, Number(counter.last_number))
    for (let i = 0; i < MAX_NUMBER + 1; i++) {
      if (number > MAX_NUMBER) number = 1
      if (!active.has(number)) break
      number += 1
    }
    // Все номера заняты (крайний случай): отдаём счётчик по модулю, чтобы не заблокировать продажу.
    if (active.has(number)) number = (Number(counter.last_number) % MAX_NUMBER) + 1

    const expiresAt = input.ttlMs ? now + input.ttlMs : null
    db.prepare(
      `INSERT INTO queue_numbers(order_id, store_uuid, period_key, number, status, created_at, expires_at)
       VALUES(?,?,?,?, 'ISSUED', ?, ?)`,
    ).run(orderId, storeUuid, periodKey, number, now, expiresAt)

    return {
      orderId,
      number,
      storeUuid,
      periodKey,
      status: 'ISSUED',
      expiresAt,
      createdAt: now,
    }
  },
)

/** Привязать документ Эвотора (uuid + номер ФД, если есть). Сам номер не меняется. */
export function bindQueueNumber(
  orderId: string,
  doc: { evotorDocumentUuid?: string | null; fiscalDocumentNumber?: string | null },
  now = Date.now(),
): boolean {
  const r = db
    .prepare(
      `UPDATE queue_numbers SET status='BOUND', evotor_document_uuid=COALESCE(?, evotor_document_uuid),
         fiscal_document_number=COALESCE(?, fiscal_document_number), bound_at=?
       WHERE order_id=? AND status IN ('ISSUED','BOUND')`,
    )
    .run(doc.evotorDocumentUuid ?? null, doc.fiscalDocumentNumber ?? null, now, orderId)
  return r.changes > 0
}

/** Отмена (чек не закрылся): номер освобождается. */
export function cancelQueueNumber(orderId: string, now = Date.now()): boolean {
  const r = db
    .prepare(`UPDATE queue_numbers SET status='CANCELLED', cancelled_at=? WHERE order_id=? AND status='ISSUED'`)
    .run(now, orderId)
  return r.changes > 0
}

/** Номера точки за период — для поддержки и админки. */
export function listQueueNumbers(storeUuid: string, periodKey = periodKeyOf()): QueueNumber[] {
  const rows = db
    .prepare(`SELECT * FROM queue_numbers WHERE store_uuid=? AND period_key=? ORDER BY number`)
    .all(storeUuid, periodKey) as Row[]
  return rows.map(toQueueNumber)
}

/** Формат для печати: без ведущих нулей, 1…3 цифры. */
export function formatQueueNumber(n: number): string {
  return String(Math.max(0, Math.trunc(n)))
}
