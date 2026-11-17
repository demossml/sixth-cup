/**
 * Почта конструктора «Меню и Ценники»: с какого ящика уходят макеты в типографию.
 *
 * Настройки вводятся в конструкторе (раздел «Почта» → «Настройки») и лежат в app_settings;
 * пароль — зашифрованным, как токены Эвотора (TOKEN_ENCRYPTION_KEY / JWT_SECRET), наружу не отдаётся.
 * Если в конструкторе ничего не сохранено, работают прежние переменные окружения SMTP_*.
 */
import type Database from 'better-sqlite3'
import nodemailer from 'nodemailer'
import { z } from 'zod'
import { db as defaultDb } from '../../db'
import { bad } from '../../lib/errors'
import { decryptToken, encryptToken } from '../../integrations/evotor/tokenStore'

const KEY = 'poster_mail'

export interface MailConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string
  fromName: string
}

type Stored = { host: string; port: number; user: string; passEnc: string; from?: string; fromName?: string; updatedAt?: number }

export type MailSource = 'settings' | 'env' | null

export interface MailPublic {
  configured: boolean
  source: MailSource
  host: string
  port: number
  user: string
  from: string | null // адрес отправителя для показа (как раньше отдавал GET /poster/send)
  fromName: string
  hasPassword: boolean
  updatedAt: number | null
}

const secureFor = (port: number) => port === 465

function readStored(conn: Database.Database): Stored | null {
  const row = conn.prepare('SELECT value FROM app_settings WHERE key=?').get(KEY) as { value: string } | undefined
  if (!row?.value) return null
  try {
    return JSON.parse(row.value) as Stored
  } catch {
    return null
  }
}

function writeStored(conn: Database.Database, value: Stored | null) {
  if (!value) {
    conn.prepare('DELETE FROM app_settings WHERE key=?').run(KEY)
    return
  }
  conn
    .prepare(
      `INSERT INTO app_settings(key, value, updated_at) VALUES(?,?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    )
    .run(KEY, JSON.stringify(value), Date.now())
}

function fromEnv(): MailConfig | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null
  const port = Number(SMTP_PORT || 465)
  return { host: SMTP_HOST, port, secure: secureFor(port), user: SMTP_USER, pass: SMTP_PASS, from: MAIL_FROM || SMTP_USER, fromName: '' }
}

/** Действующие настройки: сохранённые в конструкторе, иначе из окружения. */
export function resolveMail(conn: Database.Database = defaultDb): { config: MailConfig | null; source: MailSource; stored: Stored | null } {
  const stored = readStored(conn)
  if (stored) {
    let pass = ''
    try {
      pass = decryptToken(stored.passEnc)
    } catch {
      /* ключ шифрования сменили — пароль надо ввести заново */
    }
    const config = pass
      ? { host: stored.host, port: stored.port, secure: secureFor(stored.port), user: stored.user, pass, from: stored.from || stored.user, fromName: stored.fromName || '' }
      : null
    return { config, source: 'settings', stored }
  }
  const env = fromEnv()
  return { config: env, source: env ? 'env' : null, stored: null }
}

export function mailPublic(conn: Database.Database = defaultDb): MailPublic {
  const { config, source, stored } = resolveMail(conn)
  return {
    configured: !!config,
    source,
    host: config?.host ?? stored?.host ?? '',
    port: config?.port ?? stored?.port ?? 465,
    user: config?.user ?? stored?.user ?? '',
    from: config ? config.from : null,
    fromName: config?.fromName ?? stored?.fromName ?? '',
    hasPassword: !!config,
    updatedAt: stored?.updatedAt ?? null,
  }
}

export const mailInputSchema = z.object({
  host: z.string().trim().min(3, 'Укажите сервер SMTP, например smtp.yandex.ru').max(200).regex(/^[a-z0-9.-]+$/i, 'Сервер SMTP — только адрес, без http://'),
  port: z.coerce.number().int().min(1).max(65535),
  user: z.string().trim().min(3, 'Укажите логин — обычно полный адрес ящика').max(200),
  /** пусто — оставить сохранённый пароль */
  pass: z.string().max(500).optional(),
  from: z.string().trim().max(200).optional(),
  fromName: z.string().trim().max(100).optional(),
})
export type MailInput = z.infer<typeof mailInputSchema>

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Собрать настройки из формы: пустой пароль — взять сохранённый. */
export function configFromInput(input: MailInput, conn: Database.Database = defaultDb): MailConfig {
  const cur = resolveMail(conn)
  const pass = input.pass?.trim() || (cur.source === 'settings' ? (cur.config?.pass ?? '') : '')
  if (!pass) throw bad('Введите пароль приложения')
  const from = input.from?.trim() || input.user
  if (!EMAIL.test(from)) throw bad('Адрес отправителя должен быть почтой — укажите его или используйте логин-адрес')
  return { host: input.host, port: input.port, secure: secureFor(input.port), user: input.user, pass, from, fromName: input.fromName?.trim() || '' }
}

export function saveMail(input: MailInput, conn: Database.Database = defaultDb): MailPublic {
  const cfg = configFromInput(input, conn)
  writeStored(conn, {
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    passEnc: encryptToken(cfg.pass),
    from: input.from?.trim() || undefined,
    fromName: cfg.fromName || undefined,
    updatedAt: Date.now(),
  })
  return mailPublic(conn)
}

export function clearMail(conn: Database.Database = defaultDb): MailPublic {
  writeStored(conn, null)
  return mailPublic(conn)
}

export function transportFor(cfg: MailConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  })
}

export const fromHeader = (cfg: MailConfig) => (cfg.fromName ? { name: cfg.fromName, address: cfg.from } : cfg.from)

/** Понятная причина, почему почтовый сервер не принял подключение. */
export function explainMailError(e: unknown): string {
  const err = e as { code?: string; responseCode?: number; message?: string }
  if (err.code === 'EAUTH' || err.responseCode === 535) return 'Сервер не принял логин или пароль. Нужен пароль приложения, а не основной пароль ящика'
  if (err.code === 'ENOTFOUND' || err.code === 'EDNS') return 'Сервер SMTP не найден — проверьте адрес'
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNECTION' || err.code === 'ESOCKET' || err.code === 'ECONNREFUSED')
    return 'Не удалось подключиться к серверу — проверьте адрес и порт (обычно 465)'
  return err.message || 'Неизвестная ошибка почтового сервера'
}
