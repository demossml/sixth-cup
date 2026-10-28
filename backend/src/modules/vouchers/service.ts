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

export function activeVouchers(userId: number): VoucherTuple[] {
  const rows = db.prepare(`
    SELECT id, kind, value, expires_day FROM vouchers
    WHERE user_id=? AND used_at IS NULL AND expires_day>=?
    ORDER BY expires_day LIMIT ?`)
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

/** Простая и явная валидация: вызывается и из сервиса, и из админ-роутов. */
export function validateTemplate(input: Partial<TemplateInput>): void {
  if (input.kind !== undefined && input.kind !== 'percent' && input.kind !== 'fixed') {
    throw new Error('Тип ваучера: percent или fixed')
  }
  if (input.value !== undefined) {
    if (!(input.value > 0)) throw new Error('Значение должно быть больше нуля')
    if (input.kind === 'percent' && input.value > 100) throw new Error('Процент не может быть больше 100')
  }
  if (input.validDays !== undefined && !(input.validDays >= 1)) {
    throw new Error('Срок действия — минимум 1 день')
  }
  if (input.redemptionMode !== undefined && input.redemptionMode !== 'once' && input.redemptionMode !== 'multi') {
    throw new Error('Режим гашения: once или multi')
  }
  if (input.maxPerDay != null && input.maxPerDay < 1) throw new Error('Лимит в сутки — минимум 1')
  if (input.maxTotal != null && input.maxTotal < 1) throw new Error('Общий лимит — минимум 1')
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
  validateTemplate(input)
  const code = input.code.trim().toUpperCase()
  if (!code) throw new Error('Код шаблона обязателен')
  if (!input.title.trim()) throw new Error('Название обязательно')
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

export function updateTemplate(id: number, patch: Partial<TemplateInput>) {
  const cur = db.prepare('SELECT * FROM voucher_templates WHERE id=?').get(id) as TemplateRow | undefined
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
    id,
  )
  return getTemplate(id)
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
