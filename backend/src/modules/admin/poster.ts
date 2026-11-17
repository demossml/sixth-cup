/**
 * Конструктор «Меню и Ценники» (страница админки /poster.html): документ конструктора,
 * каталог с ценами из базы и отправка макетов в типографию.
 */
import { Hono } from 'hono'
import nodemailer from 'nodemailer'
import { changesForBatch, sentMark } from '@sixth-cup/menu-core/fingerprint'
import { uid, type Workspace } from '@sixth-cup/menu-core/model'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { buildPosterCatalog } from './posterCatalog'
import { loadPosterWorkspace, mutatePosterWorkspace, PosterConflict, savePosterWorkspace } from './posterStore'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_ZIP_BYTES = 20 * 1024 * 1024

type DocMark = { id: string; hash: string; file: string }

function smtpConfig() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null
  const port = Number(SMTP_PORT || 465)
  return { host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS }, from: MAIL_FROM || SMTP_USER }
}

/** Отметить документы отправленными: отметка, запись в истории и журнале. */
function markSent(ws: Workspace, docs: DocMark[], at: string, sendId: string) {
  for (const d of docs) {
    const doc = ws.documents.find((x) => x.id === d.id)
    if (doc) doc.lastSent = sentMark(ws, doc, d.hash, at, sendId)
  }
  return [...new Set(docs.map((d) => ws.documents.find((x) => x.id === d.id)?.cafeId).filter((x): x is string => !!x))]
}

function parseDocs(raw: unknown): DocMark[] {
  const list = typeof raw === 'string' ? (JSON.parse(raw || '[]') as unknown) : raw
  if (!Array.isArray(list)) return []
  return list.filter((d): d is DocMark => !!d && typeof d.id === 'string' && typeof d.hash === 'string' && typeof d.file === 'string')
}

export const adminPoster = new Hono()
  .get('/poster/workspace', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({ ws: loadPosterWorkspace() })
  })

  .put('/poster/workspace', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { ws?: Workspace; baseRev?: number } | null
    const ws = body?.ws
    if (!ws || typeof body?.baseRev !== 'number' || !Array.isArray(ws.groups) || !Array.isArray(ws.documents)) throw bad('Неверные данные')
    try {
      return c.json({ ws: savePosterWorkspace(ws, body.baseRev) })
    } catch (e) {
      if (e instanceof PosterConflict) return c.json({ error: 'conflict', ws: e.current }, 409)
      throw e
    }
  })

  /** Товары с размерами и ценами для выбора позиции меню. */
  .get('/poster/catalog', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(buildPosterCatalog(db))
  })

  /** Отметить документы отправленными без письма — когда архив скачали и передали сами. */
  .post('/poster/mark', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { docs?: unknown; note?: string } | null
    const docs = parseDocs(body?.docs)
    if (!docs.length) throw bad('Не выбрано ни одного документа')
    const sendId = uid('s')
    const at = new Date().toISOString()
    const ws = mutatePosterWorkspace((ws) => {
      const cafeIds = markSent(ws, docs, at, sendId)
      const to = body?.note?.trim() || 'передано вручную'
      ws.sends.push({ id: sendId, at, to, docIds: docs.map((d) => d.id), files: docs.map((d) => d.file), bytes: 0, changes: 0, cafeIds })
      ws.changeLog.push({ at, text: `Отмечено отправленным вручную: ${docs.length} файл(ов)` })
      return ws
    })
    c.set('audit' as never, { entity: 'poster', entityId: sendId, summary: `Меню и ценники: отмечено отправленным ${docs.length}` } as never)
    return c.json({ ws })
  })

  .get('/poster/send', (c) => {
    const cfg = smtpConfig()
    return c.json({ configured: !!cfg, from: cfg?.from ?? null })
  })

  /** Отправить архив макетов в типографию письмом. */
  .post('/poster/send', async (c) => {
    const cfg = smtpConfig()
    if (!cfg) throw bad('Почта не настроена: задайте SMTP_HOST, SMTP_USER, SMTP_PASS на сервере', 503)
    const form = await c.req.formData()
    const zip = form.get('zip')
    const to = String(form.get('to') ?? '').trim()
    const contactName = String(form.get('name') ?? '').trim()
    const docs = parseDocs(form.get('docs'))
    const message = String(form.get('message') ?? '').trim()
    const batch = String(form.get('batch') ?? '').trim() || undefined
    const cafeNote = String(form.get('cafes') ?? '').trim()
    if (!(zip instanceof File)) throw bad('Нет архива')
    if (!EMAIL.test(to)) throw bad('Проверьте адрес почты')
    if (zip.size > MAX_ZIP_BYTES) throw bad('Архив больше 20 МБ — отправьте частями или скачайте и пришлите вручную')
    if (!docs.length) throw bad('Не выбрано ни одного документа')

    const changes = changesForBatch(loadPosterWorkspace(), batch)
    const date = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })
    const text = [
      contactName ? `${contactName}, здравствуйте!` : 'Здравствуйте!',
      '',
      message || 'Во вложении макеты в печать.',
      ...(cafeNote ? ['', `Кафе: ${cafeNote}`] : []),
      '',
      `Файлы (${docs.length}):`,
      ...docs.map((d) => `• ${d.file}`),
      '',
      'PDF для печати: вылеты 3 мм, метки реза, шрифты встроены.',
      ...(changes.length ? ['', 'Что изменилось с прошлой отправки:', ...changes.slice(-40).map((ch) => `— ${ch.text}`)] : []),
    ].join('\n')

    try {
      const transport = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: cfg.auth })
      await transport.sendMail({
        from: cfg.from,
        to,
        subject: `Макеты в печать — 6.7, ${date}`,
        text,
        attachments: [{ filename: zip.name || 'makety.zip', content: Buffer.from(await zip.arrayBuffer()), contentType: 'application/zip' }],
      })
    } catch (e) {
      console.error(e)
      throw bad(`Почтовый сервер не принял письмо: ${(e as Error).message}`, 502)
    }

    const sendId = uid('s')
    const at = new Date().toISOString()
    const ws = mutatePosterWorkspace((ws) => {
      const cafeIds = markSent(ws, docs, at, sendId)
      const existing = ws.contacts.find((x) => x.email.toLowerCase() === to.toLowerCase())
      if (existing) existing.name = contactName || existing.name
      else ws.contacts.push({ id: uid('c'), name: contactName || to, email: to })
      ws.sends.push({ id: sendId, at, to, docIds: docs.map((d) => d.id), files: docs.map((d) => d.file), bytes: zip.size, changes: changes.length, batch, cafeIds })
      ws.changeLog.push({ at, text: `Отправлено в типографию: ${docs.length} файл(ов) → ${to}` })
      return ws
    })
    c.set('audit' as never, { entity: 'poster', entityId: sendId, summary: `Меню и ценники: ${docs.length} файл(ов) → ${to}` } as never)
    return c.json({ ws })
  })
