/**
 * Конструктор «Меню и Ценники» (страница админки /poster.html): документ конструктора,
 * каталог с ценами из базы, почта и отправка макетов в типографию с подробной историей.
 */
import { Hono } from 'hono'
import { changesForBatch } from '@sixth-cup/menu-core/fingerprint'
import { uid, type Workspace } from '@sixth-cup/menu-core/model'
import type { SendDetails } from '@sixth-cup/menu-core/sends'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { enqueueProductSync } from './enqueue'
import { buildPosterCatalog, CatalogPriceError, setCatalogPrices, type CatalogPriceInput } from './posterCatalog'
import { clearMail, configFromInput, explainMailError, fromHeader, mailInputSchema, mailPublic, resolveMail, saveMail, transportFor } from './posterMail'
import { markAndCollect, readSendDetails, readSendPreviews, saveSendDetails, type DocMark } from './posterSends'
import { loadPosterWorkspace, mutatePosterWorkspace, PosterConflict, savePosterWorkspace } from './posterStore'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_ZIP_BYTES = 20 * 1024 * 1024

function parseDocs(raw: unknown): DocMark[] {
  const list = typeof raw === 'string' ? (JSON.parse(raw || '[]') as unknown) : raw
  if (!Array.isArray(list)) return []
  return list.filter((d): d is DocMark => !!d && typeof d.id === 'string' && typeof d.hash === 'string' && typeof d.file === 'string')
}

const audit = (c: { set: (k: never, v: never) => void }, entityId: string, summary: string) =>
  c.set('audit' as never, { entity: 'poster', entityId, summary } as never)

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

  /**
   * «Обновить в базе тоже»: цена из редактора меню записывается в товар. Документ конструктора здесь не
   * трогаем — редактор сам ставит ту же цену в строку и сохраняет её обычным порядком (иначе версия
   * документа сменилась бы у него под ногами). Ответ — свежий каталог с новыми ценами и датами.
   */
  .post('/poster/catalog/prices', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { updates?: unknown } | null
    const list = Array.isArray(body?.updates) ? body.updates : null
    const ok = (u: unknown): u is CatalogPriceInput =>
      !!u && typeof u === 'object' && typeof (u as CatalogPriceInput).ref === 'string' && typeof (u as CatalogPriceInput).key === 'string' && typeof (u as CatalogPriceInput).price === 'number'
    if (!list || !list.length || list.length > 50 || !list.every(ok)) throw bad('Неверные данные')
    let r: ReturnType<typeof setCatalogPrices>
    try {
      r = setCatalogPrices(db, list)
    } catch (e) {
      if (e instanceof CatalogPriceError) throw bad(e.message, 409)
      throw e
    }
    enqueueProductSync(r.productIds)
    if (r.log.length) audit(c, r.productIds.join(','), `Конструктор меню: ${r.log.join('; ')}`)
    return c.json({ catalog: buildPosterCatalog(db), changed: r.productIds.length })
  })

  // ---------- почта ----------

  /** С какого ящика уходят письма (пароль не отдаётся). */
  .get('/poster/mail', (c) => c.json(mailPublic()))

  .put('/poster/mail', async (c) => {
    const parsed = mailInputSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Проверьте поля')
    const mail = saveMail(parsed.data)
    audit(c, 'mail', `Меню и ценники: почта ${mail.user} (${mail.host}:${mail.port})`)
    return c.json(mail)
  })

  .delete('/poster/mail', (c) => {
    const mail = clearMail()
    audit(c, 'mail', 'Меню и ценники: почта отключена')
    return c.json(mail)
  })

  /**
   * Проверить подключение — с тем, что сейчас в форме (пустой пароль — сохранённый), или с сохранёнными
   * настройками. С адресом `to` ещё и отправить тестовое письмо.
   */
  .post('/poster/mail/test', async (c) => {
    const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>
    let cfg = resolveMail().config
    if (body.host) {
      const parsed = mailInputSchema.safeParse(body)
      if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Проверьте поля')
      cfg = configFromInput(parsed.data)
    }
    if (!cfg) throw bad('Почта не настроена')
    const to = typeof body.to === 'string' ? body.to.trim() : ''
    if (to && !EMAIL.test(to)) throw bad('Проверьте адрес для тестового письма')
    const transport = transportFor(cfg)
    try {
      await transport.verify()
      if (to)
        await transport.sendMail({
          from: fromHeader(cfg),
          to,
          subject: 'Проверка почты — меню и ценники 6.7',
          text: 'Это тестовое письмо из конструктора меню и ценников 6.7. Если вы его видите — почта подключена, макеты в типографию будут уходить с этого адреса.',
        })
    } catch (e) {
      return c.json({ ok: false, error: explainMailError(e) })
    } finally {
      transport.close()
    }
    return c.json({ ok: true, sent: !!to })
  })

  // ---------- отправка и история ----------

  /** Совместимость: короткое состояние почты для блока отправки. */
  .get('/poster/send', (c) => {
    const m = mailPublic()
    return c.json({ configured: m.configured, from: m.from })
  })

  /** Подробности отправки: что ушло, что изменилось, письмо, прошлые версии документов. */
  /** Превью для строк списка отправок: ?ids=a,b,c (до 20 за раз — список просит те строки, что видны). */
  .get('/poster/sends/previews', (c) => {
    const ids = [...new Set((c.req.query('ids') ?? '').split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 20)
    if (!ids.length) throw bad('Не указаны отправки')
    return c.json({ previews: readSendPreviews(loadPosterWorkspace(), ids) })
  })

  .get('/poster/sends/:id', (c) => {
    const details = readSendDetails(loadPosterWorkspace(), c.req.param('id'))
    if (!details) throw bad('Отправка не найдена', 404)
    c.header('Cache-Control', 'no-store')
    return c.json(details)
  })

  /** Отметить документы отправленными без письма — когда архив скачали и передали сами. */
  .post('/poster/mark', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { docs?: unknown; note?: string } | null
    const marks = parseDocs(body?.docs)
    if (!marks.length) throw bad('Не выбрано ни одного документа')
    const sendId = uid('s')
    const at = new Date().toISOString()
    const to = body?.note?.trim() || 'передано вручную'
    let details: SendDetails | null = null
    const ws = mutatePosterWorkspace((ws) => {
      const log = changesForBatch(ws)
      const { docs, cafeIds } = markAndCollect(ws, marks, at, sendId)
      ws.sends.push({ id: sendId, at, to, docIds: marks.map((d) => d.id), files: marks.map((d) => d.file), bytes: 0, changes: log.length, cafeIds })
      ws.changeLog.push({ at, text: `Отмечено отправленным вручную: ${marks.length} файл(ов)` })
      details = { id: sendId, at, method: 'manual', to, bytes: 0, docs, log }
      return ws
    })
    if (details) saveSendDetails(details)
    audit(c, sendId, `Меню и ценники: отмечено отправленным ${marks.length}`)
    return c.json({ ws })
  })

  /** Отправить архив макетов в типографию письмом. */
  .post('/poster/send', async (c) => {
    const cfg = resolveMail().config
    if (!cfg) throw bad('Почта не подключена: откройте «Почта» → «Настройки» в конструкторе', 503)
    const form = await c.req.formData()
    const zip = form.get('zip')
    const to = String(form.get('to') ?? '').trim()
    const contactName = String(form.get('name') ?? '').trim()
    const marks = parseDocs(form.get('docs'))
    const message = String(form.get('message') ?? '').trim()
    const batch = String(form.get('batch') ?? '').trim() || undefined
    const cafeNote = String(form.get('cafes') ?? '').trim()
    if (!(zip instanceof File)) throw bad('Нет архива')
    if (!EMAIL.test(to)) throw bad('Проверьте адрес почты')
    if (zip.size > MAX_ZIP_BYTES) throw bad('Архив больше 20 МБ — отправьте частями или скачайте и пришлите вручную')
    if (!marks.length) throw bad('Не выбрано ни одного документа')

    const changes = changesForBatch(loadPosterWorkspace(), batch)
    const date = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })
    const subject = `Макеты в печать — 6.7, ${date}`
    const text = [
      contactName ? `${contactName}, здравствуйте!` : 'Здравствуйте!',
      '',
      message || 'Во вложении макеты в печать.',
      ...(cafeNote ? ['', `Кафе: ${cafeNote}`] : []),
      '',
      `Файлы (${marks.length}):`,
      ...marks.map((d) => `• ${d.file}`),
      '',
      'PDF для печати: вылеты 3 мм, метки реза, шрифты встроены.',
      ...(changes.length ? ['', 'Что изменилось с прошлой отправки:', ...changes.slice(-40).map((ch) => `— ${ch.text}`)] : []),
    ].join('\n')

    const transport = transportFor(cfg)
    try {
      await transport.sendMail({
        from: fromHeader(cfg),
        to,
        subject,
        text,
        attachments: [{ filename: zip.name || 'makety.zip', content: Buffer.from(await zip.arrayBuffer()), contentType: 'application/zip' }],
      })
    } catch (e) {
      console.error(e)
      throw bad(`Почтовый сервер не принял письмо: ${explainMailError(e)}`, 502)
    } finally {
      transport.close()
    }

    const sendId = uid('s')
    const at = new Date().toISOString()
    let details: SendDetails | null = null
    const ws = mutatePosterWorkspace((ws) => {
      const { docs, cafeIds } = markAndCollect(ws, marks, at, sendId)
      const existing = ws.contacts.find((x) => x.email.toLowerCase() === to.toLowerCase())
      if (existing) existing.name = contactName || existing.name
      else ws.contacts.push({ id: uid('c'), name: contactName || to, email: to })
      ws.sends.push({ id: sendId, at, to, docIds: marks.map((d) => d.id), files: marks.map((d) => d.file), bytes: zip.size, changes: changes.length, batch, cafeIds })
      ws.changeLog.push({ at, text: `Отправлено в типографию: ${marks.length} файл(ов) → ${to}` })
      details = { id: sendId, at, method: 'email', to, ...(contactName ? { toName: contactName } : {}), subject, text, ...(message ? { message } : {}), bytes: zip.size, batch, docs, log: changes }
      return ws
    })
    if (details) saveSendDetails(details)
    audit(c, sendId, `Меню и ценники: ${marks.length} файл(ов) → ${to}`)
    return c.json({ ws })
  })
