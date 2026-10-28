import { z } from 'zod'
import { db } from '../../db'
import { config } from '../../config'

export type VoucherTuple = [number, 'p' | 'f', number, number]

export const todayDay = () => Math.floor(Date.now() / 86_400_000)

export function grantVoucher(userId: number, code: string) {
  const t = db.prepare('SELECT * FROM voucher_templates WHERE code=?').get(code) as
    | { id: number; title: string; kind: string; value: number; valid_days: number; active: number }
    | undefined
  if (!t) throw new Error(`Unknown voucher template ${code}`)
  if (t.active === 0) throw new Error(`Шаблон ${code} выключен и не может выдаваться`)
  db.prepare(`INSERT INTO vouchers(user_id,template_id,title,kind,value,expires_day)
              VALUES(?,?,?,?,?,?)`).run(userId, t.id, t.title, t.kind, t.value, todayDay() + t.valid_days)
}

/**
 * Идемпотентная выдача: один ваучер этого шаблона на гостя (L-09).
 * Проверка и вставка — одним оператором, гонка двух каналов не создаёт дубликат.
 * Возвращает true, если ваучер реально выдан сейчас.
 */
export function grantVoucherOnce(userId: number, code: string): boolean {
  const t = db.prepare('SELECT * FROM voucher_templates WHERE code=?').get(code) as
    | { id: number; title: string; kind: string; value: number; valid_days: number; active: number }
    | undefined
  if (!t) throw new Error(`Unknown voucher template ${code}`)
  if (t.active === 0) throw new Error(`Шаблон ${code} выключен и не может выдаваться`)
  const r = db
    .prepare(
      `INSERT INTO vouchers(user_id,template_id,title,kind,value,expires_day)
       SELECT ?,?,?,?,?,?
       WHERE NOT EXISTS (SELECT 1 FROM vouchers WHERE user_id=? AND template_id=?)`,
    )
    .run(userId, t.id, t.title, t.kind, t.value, todayDay() + t.valid_days, userId, t.id)
  return r.changes === 1
}

/**
 * Ваучеры для карточки гостя (PWA/`/sync`). Выключенный шаблон скрываем и здесь:
 * касса такой ваучер всё равно не погасит (см. `vouchersForResolve`), и гостю
 * незачем видеть то, что на кассе отклонят.
 */
export function activeVouchers(userId: number): VoucherTuple[] {
  const rows = db.prepare(`
    SELECT v.id, v.kind, v.value, v.expires_day FROM vouchers v
    LEFT JOIN voucher_templates t ON t.id = v.template_id
    WHERE v.user_id=? AND v.used_at IS NULL AND v.expires_day>=? AND COALESCE(t.active, 1)=1
    ORDER BY v.expires_day LIMIT ?`)
    .all(userId, todayDay(), config.maxVouchersInCard) as
    { id: number; kind: string; value: number; expires_day: number }[]
  return rows.map((r): VoucherTuple => [r.id, r.kind === 'percent' ? 'p' : 'f', r.value, r.expires_day])
}

/* ───────── D2: шаблоны ваучеров ───────── */

export type TemplateRow = {
  id: number
  code: string
  title: string
  kind: 'percent' | 'fixed'
  value: number
  valid_days: number
  active: number
  image_url: string | null
  redemption_mode: 'once' | 'multi'
  max_per_day: number | null
  max_total: number | null
  stackable_with_free_cup: number
}

export type TemplateInput = {
  code: string
  title: string
  kind: 'percent' | 'fixed'
  value: number
  validDays: number
  active?: boolean
  imageUrl?: string | null
  redemptionMode?: 'once' | 'multi'
  maxPerDay?: number | null
  maxTotal?: number | null
  stackableWithFreeCup?: boolean
}

const templateView = (t: TemplateRow) => ({
  id: t.id,
  code: t.code,
  title: t.title,
  kind: t.kind,
  value: t.value,
  validDays: t.valid_days,
  active: Boolean(t.active),
  imageUrl: t.image_url,
  redemptionMode: t.redemption_mode,
  maxPerDay: t.max_per_day,
  maxTotal: t.max_total,
  stackableWithFreeCup: Boolean(t.stackable_with_free_cup),
})

/** Медиа шаблона: локальный /uploads/… или абсолютный https-URL (как у товаров). */
const imageUrlRule = z
  .string()
  .max(500, 'Адрес медиа слишком длинный')
  .refine((v) => v.startsWith('/uploads/') || /^https?:\/\//i.test(v), {
    message: 'Адрес медиа: /uploads/… или https://…',
  })

/**
 * Одна схема на сервис и на админ-API: правила не расходятся между слоями.
 * Сообщения — для человека, они уходят в 400 как есть.
 */
export const templatePatchZ = z.object({
  title: z.string().trim().min(1, 'Название обязательно').max(120, 'Название слишком длинное').optional(),
  kind: z.enum(['percent', 'fixed'], { message: 'Тип ваучера: percent или fixed' }).optional(),
  value: z.number().positive('Значение должно быть больше нуля').optional(),
  validDays: z.number().int('Срок действия — целое число дней').min(1, 'Срок действия — минимум 1 день')
    .max(3650, 'Срок действия — не больше 10 лет').optional(),
  active: z.boolean().optional(),
  imageUrl: imageUrlRule.nullable().optional(),
  redemptionMode: z.enum(['once', 'multi'], { message: 'Режим гашения: once или multi' }).optional(),
  maxPerDay: z.number().int('Лимит в сутки — целое число').min(1, 'Лимит в сутки — минимум 1').nullable().optional(),
  maxTotal: z.number().int('Общий лимит — целое число').min(1, 'Общий лимит — минимум 1').nullable().optional(),
  stackableWithFreeCup: z.boolean().optional(),
})

export const templateCreateZ = templatePatchZ.extend({
  code: z.string().trim().min(1, 'Код шаблона обязателен').max(64, 'Код шаблона слишком длинный'),
  title: z.string().trim().min(1, 'Название обязательно').max(120, 'Название слишком длинное'),
  kind: z.enum(['percent', 'fixed'], { message: 'Тип ваучера: percent или fixed' }),
  value: z.number().positive('Значение должно быть больше нуля'),
  validDays: z.number().int('Срок действия — целое число дней').min(1, 'Срок действия — минимум 1 день')
    .max(3650, 'Срок действия — не больше 10 лет'),
})

/** Валидация с понятным текстом ошибки: первое нарушение, без стопки технических деталей. */
export function validateTemplate(input: Partial<TemplateInput>, schema: z.ZodTypeAny = templatePatchZ): void {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Некорректные настройки шаблона')
  // Процент > 100 ловится только вместе с типом, поэтому проверка после схемы.
  const kind = input.kind
  if (kind === 'percent' && input.value !== undefined && input.value > 100) {
    throw new Error('Процент не может быть больше 100')
  }
}

export function listTemplates(opts: { includeInactive?: boolean } = {}) {
  const rows = db
    .prepare(
      `SELECT * FROM voucher_templates ${opts.includeInactive ? '' : 'WHERE active=1'} ORDER BY id`,
    )
    .all() as TemplateRow[]
  return rows.map(templateView)
}

export function getTemplate(codeOrId: string | number) {
  const row =
    typeof codeOrId === 'number'
      ? (db.prepare('SELECT * FROM voucher_templates WHERE id=?').get(codeOrId) as TemplateRow | undefined)
      : (db.prepare('SELECT * FROM voucher_templates WHERE code=?').get(codeOrId) as TemplateRow | undefined)
  return row ? templateView(row) : null
}

export function createTemplate(input: TemplateInput) {
  validateTemplate(input, templateCreateZ)
  const code = input.code.trim().toUpperCase()
  if (getTemplate(code)) throw new Error(`Шаблон с кодом ${code} уже существует`)
  const info = db
    .prepare(
      `INSERT INTO voucher_templates(code, title, kind, value, valid_days, active, image_url,
                                    redemption_mode, max_per_day, max_total, stackable_with_free_cup)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      code,
      input.title.trim(),
      input.kind,
      input.value,
      input.validDays,
      input.active === false ? 0 : 1,
      input.imageUrl ?? null,
      input.redemptionMode ?? 'once',
      input.maxPerDay ?? null,
      input.maxTotal ?? null,
      input.stackableWithFreeCup === false ? 0 : 1,
    )
  return getTemplate(Number(info.lastInsertRowid))
}

export function updateTemplate(idOrCode: number | string, patch: Partial<TemplateInput>) {
  const cur =
    typeof idOrCode === 'number'
      ? (db.prepare('SELECT * FROM voucher_templates WHERE id=?').get(idOrCode) as TemplateRow | undefined)
      : (db.prepare('SELECT * FROM voucher_templates WHERE code=?').get(idOrCode.trim().toUpperCase()) as TemplateRow | undefined)
  if (!cur) throw new Error('Шаблон не найден')
  validateTemplate({ ...patch, kind: patch.kind ?? cur.kind })
  const next = {
    title: patch.title?.trim() || cur.title,
    kind: patch.kind ?? cur.kind,
    value: patch.value ?? cur.value,
    validDays: patch.validDays ?? cur.valid_days,
    active: patch.active === undefined ? cur.active : patch.active ? 1 : 0,
    imageUrl: patch.imageUrl === undefined ? cur.image_url : patch.imageUrl,
    redemptionMode: patch.redemptionMode ?? cur.redemption_mode,
    maxPerDay: patch.maxPerDay === undefined ? cur.max_per_day : patch.maxPerDay,
    maxTotal: patch.maxTotal === undefined ? cur.max_total : patch.maxTotal,
    stackable: patch.stackableWithFreeCup === undefined
      ? cur.stackable_with_free_cup
      : patch.stackableWithFreeCup
        ? 1
        : 0,
  }
  db.prepare(
    `UPDATE voucher_templates SET title=?, kind=?, value=?, valid_days=?, active=?, image_url=?,
            redemption_mode=?, max_per_day=?, max_total=?, stackable_with_free_cup=? WHERE id=?`,
  ).run(
    next.title,
    next.kind,
    next.value,
    next.validDays,
    next.active,
    next.imageUrl,
    next.redemptionMode,
    next.maxPerDay,
    next.maxTotal,
    next.stackable,
    cur.id,
  )
  return getTemplate(cur.id)
}

export type ResolveVoucher = {
  id: number
  title: string
  kind: 'percent' | 'fixed'
  value: number
  redemptionMode: 'once' | 'multi'
  stackableWithFreeCup: boolean
  expiresDay: number
  imageUrl: string | null
}

/**
 * D5: ваучеры, которые касса может предложить гостю на QR-скане.
 * Резерва ваучера на этапе resolve нет (V1): гашение — по `sc.voucherId` в handleSell.
 * Выключенные шаблоны не показываем; для multi учитываем общий лимит гашений.
 */
export function vouchersForResolve(userId: number): ResolveVoucher[] {
  const rows = db
    .prepare(
      `SELECT v.id, v.title, v.kind, v.value, v.expires_day, v.redemptions_count,
              COALESCE(t.active, 1) AS active,
              COALESCE(t.redemption_mode, 'once') AS redemption_mode,
              COALESCE(t.max_total, NULL) AS max_total,
              COALESCE(t.stackable_with_free_cup, 1) AS stackable,
              t.image_url
         FROM vouchers v LEFT JOIN voucher_templates t ON t.id = v.template_id
        WHERE v.user_id=? AND v.used_at IS NULL AND v.expires_day>=?
        ORDER BY v.expires_day, v.id
        LIMIT ?`,
    )
    .all(userId, todayDay(), config.maxVouchersInCard) as {
    id: number
    title: string
    kind: 'percent' | 'fixed'
    value: number
    expires_day: number
    redemptions_count: number
    active: number
    redemption_mode: 'once' | 'multi'
    max_total: number | null
    stackable: number
    image_url: string | null
  }[]
  return rows
    .filter((r) => r.active === 1)
    .filter((r) => r.redemption_mode !== 'multi' || r.max_total == null || r.redemptions_count < r.max_total)
    .map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      value: r.value,
      redemptionMode: r.redemption_mode,
      stackableWithFreeCup: r.stackable === 1,
      expiresDay: r.expires_day,
      imageUrl: r.image_url,
    }))
}

/* ───────── E2: гашение ваучера в потоке Эвотора ───────── */

export type RedeemFailure =
  | 'voucher_not_found'
  | 'voucher_foreign'
  | 'voucher_expired'
  | 'voucher_used'
  | 'voucher_limit'
  | 'voucher_not_stacked_with_free'

export type RedeemResult =
  | { ok: true; voucherId: number; kind: 'percent' | 'fixed'; value: number; duplicate: boolean }
  | { ok: false; reason: RedeemFailure }

/**
 * Гасит ваучер по `sc.voucherId`. Вызывается внутри транзакции продажи:
 * либо гашение и начисления применяются вместе, либо не применяется ничего.
 * Повторная обработка того же документа идемпотентна (журнал `voucher_redemptions`).
 */
export function redeemVoucher(input: {
  voucherId: number
  userId: number
  docId: string
  storeUuid?: string | null
  appliedFree: number
  now?: number
}): RedeemResult {
  const now = input.now ?? Date.now()
  const day = Math.floor(now / 86_400_000)
  const row = db
    .prepare(
      `SELECT v.id, v.user_id, v.kind, v.value, v.expires_day, v.used_at, v.redemptions_count,
              COALESCE(t.redemption_mode, 'once') AS redemption_mode,
              t.max_per_day, t.max_total,
              COALESCE(t.stackable_with_free_cup, 1) AS stackable,
              COALESCE(t.active, 1) AS active
         FROM vouchers v LEFT JOIN voucher_templates t ON t.id = v.template_id
        WHERE v.id=?`,
    )
    .get(input.voucherId) as {
    id: number
    user_id: number
    kind: 'percent' | 'fixed'
    value: number
    expires_day: number
    used_at: number | null
    redemptions_count: number
    redemption_mode: 'once' | 'multi'
    max_per_day: number | null
    max_total: number | null
    stackable: number
    active: number
  } | undefined
  if (!row) return { ok: false, reason: 'voucher_not_found' }
  if (row.user_id !== input.userId) return { ok: false, reason: 'voucher_foreign' }
  if (row.active !== 1) return { ok: false, reason: 'voucher_not_found' }
  if (row.expires_day < day) return { ok: false, reason: 'voucher_expired' }
  if (row.stackable === 0 && input.appliedFree > 0) return { ok: false, reason: 'voucher_not_stacked_with_free' }

  // Журнал гашений: уникальность (voucher_id, receipt_id) делает повторный poll безопасным.
  const logged = db
    .prepare('INSERT OR IGNORE INTO voucher_redemptions(voucher_id, receipt_id, store_uuid, day, created_at) VALUES(?,?,?,?,?)')
    .run(row.id, input.docId, input.storeUuid ?? null, day, now)
  if (logged.changes === 0) {
    return { ok: true, voucherId: row.id, kind: row.kind, value: row.value, duplicate: true }
  }

  if (row.redemption_mode === 'once') {
    const used = db
      .prepare('UPDATE vouchers SET used_at=?, receipt_id=? WHERE id=? AND used_at IS NULL')
      .run(now, input.docId, row.id)
    if (used.changes !== 1) {
      db.prepare('DELETE FROM voucher_redemptions WHERE voucher_id=? AND receipt_id=?').run(row.id, input.docId)
      return { ok: false, reason: 'voucher_used' }
    }
  } else {
    if (row.max_total != null && row.redemptions_count >= row.max_total) {
      db.prepare('DELETE FROM voucher_redemptions WHERE voucher_id=? AND receipt_id=?').run(row.id, input.docId)
      return { ok: false, reason: 'voucher_limit' }
    }
    if (row.max_per_day != null) {
      const usedToday = (db.prepare('SELECT COUNT(*) AS n FROM voucher_redemptions WHERE voucher_id=? AND day=?').get(row.id, day) as { n: number }).n
      if (usedToday > row.max_per_day) {
        db.prepare('DELETE FROM voucher_redemptions WHERE voucher_id=? AND receipt_id=?').run(row.id, input.docId)
        return { ok: false, reason: 'voucher_limit' }
      }
    }
    db.prepare('UPDATE vouchers SET redemptions_count=redemptions_count+1 WHERE id=?').run(row.id)
  }
  return { ok: true, voucherId: row.id, kind: row.kind, value: row.value, duplicate: false }
}
