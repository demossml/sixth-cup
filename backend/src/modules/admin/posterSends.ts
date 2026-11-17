/**
 * Подробности отправок конструктора «Меню и Ценники» (таблица poster_send_details): что ушло,
 * что изменилось с прошлого раза, текст письма. Пишутся вместе с отметкой «отправлено».
 */
import type Database from 'better-sqlite3'
import { docChanges } from '@sixth-cup/menu-core/changes'
import { sentMark } from '@sixth-cup/menu-core/fingerprint'
import { resolveTag, type ChangeEntry, type Doc, type SendRecord, type Workspace } from '@sixth-cup/menu-core/model'
import type { SendDetails, SendPreview, SentDoc } from '@sixth-cup/menu-core/sends'
import { db as defaultDb } from '../../db'

export type DocMark = { id: string; hash: string; file: string }

const title = (ws: Workspace, d: Doc) => (d.kind === 'tag' ? resolveTag(ws, d).name : d.name)

/**
 * Отметить документы отправленными и собрать, что именно ушло. Вызывается внутри правки документа
 * конструктора: «что изменилось» считается до отметки — по прошлой отправке каждого документа.
 */
export function markAndCollect(ws: Workspace, marks: DocMark[], at: string, sendId: string): { docs: SentDoc[]; cafeIds: string[] } {
  const docs: SentDoc[] = []
  for (const m of marks) {
    const doc = ws.documents.find((x) => x.id === m.id)
    if (!doc) continue
    const changes = docChanges(ws, doc)
    doc.lastSent = sentMark(ws, doc, m.hash, at, sendId)
    docs.push({
      id: doc.id,
      kind: doc.kind,
      name: title(ws, doc),
      size: { ...doc.size },
      cafeId: doc.cafeId,
      file: m.file,
      hash: m.hash,
      ...(doc.lastSent.snap ? { snap: doc.lastSent.snap } : {}),
      changes,
    })
  }
  return { docs, cafeIds: [...new Set(docs.map((d) => d.cafeId))] }
}

export function saveSendDetails(details: SendDetails, conn: Database.Database = defaultDb) {
  conn
    .prepare('INSERT INTO poster_send_details (send_id, at, json) VALUES (?, ?, ?) ON CONFLICT(send_id) DO UPDATE SET at=excluded.at, json=excluded.json')
    .run(details.id, details.at, JSON.stringify(details))
}

/** Правки между прошлой отправкой и этой — для отправок, у которых подробности не сохранились. */
function logBetween(ws: Workspace, s: SendRecord): ChangeEntry[] {
  const i = ws.sends.findIndex((x) => x.id === s.id)
  const prev = ws.sends.slice(0, i).reverse().find((x) => !s.batch || x.batch !== s.batch)
  return ws.changeLog.filter((c) => (!prev || c.at > prev.at) && c.at <= s.at && !/^(Отправлено в типографию|Отмечено отправленным)/.test(c.text))
}

/** Отправка, сделанная до хранения подробностей: собрать, что можно, из документа конструктора. */
function legacyDetails(ws: Workspace, s: SendRecord): SendDetails {
  return {
    id: s.id,
    at: s.at,
    method: s.bytes ? 'email' : 'manual',
    to: s.to,
    bytes: s.bytes,
    batch: s.batch,
    legacy: true,
    log: logBetween(ws, s),
    docs: s.docIds.flatMap((id, i): SentDoc[] => {
      const doc = ws.documents.find((d) => d.id === id)
      if (!doc) return [{ id, kind: 'menu', name: s.files[i] ?? 'Документ удалён', size: { w: 0, h: 0 }, cafeId: '', file: s.files[i] ?? '', hash: '', changes: { state: 'unknown', prices: [], other: [] } }]
      const snap = doc.lastSent?.sendId === s.id ? doc.lastSent.snap : undefined
      return [{ id, kind: doc.kind, name: title(ws, doc), size: { ...doc.size }, cafeId: doc.cafeId, file: s.files[i] ?? '', hash: doc.lastSent?.hash ?? '', ...(snap ? { snap } : {}), changes: { state: 'unknown', prices: [], other: [] } }]
    }),
  }
}

const SNIPPET_MAX = 280
const MAX_PREVIEW_DOCS = 24 // столько превью точно не поместится в строку; дальше — счётчик «+N»

export function readSendPreviews(ws: Workspace, ids: string[], conn: Database.Database = defaultDb): SendPreview[] {
  const get = conn.prepare('SELECT json FROM poster_send_details WHERE send_id = ?')
  return ids.flatMap((id): SendPreview[] => {
    const row = get.get(id) as { json: string } | undefined
    const s = ws.sends.find((x) => x.id === id)
    if (!row && !s) return []
    const d: SendDetails = row ? (JSON.parse(row.json) as SendDetails) : legacyDetails(ws, s!)
    const raw = d.message?.trim() || d.text?.trim() || ''
    const flat = raw.replace(/\s+/g, ' ')
    return [
      {
        id,
        snippet: flat ? (flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX - 1)}…` : flat) : null,
        docs: d.docs.slice(0, MAX_PREVIEW_DOCS).map((x) => ({ id: x.id, kind: x.kind, name: x.name, size: x.size, ...(x.snap ? { snap: x.snap } : {}) })),
      },
    ]
  })
}

/** Подробности отправки с прошлыми версиями её документов — для сравнения «Было / Отправлено». */
export function readSendDetails(ws: Workspace, sendId: string, conn: Database.Database = defaultDb): SendDetails | null {
  const s = ws.sends.find((x) => x.id === sendId)
  const row = conn.prepare('SELECT json FROM poster_send_details WHERE send_id = ?').get(sendId) as { json: string } | undefined
  if (!row && !s) return null
  const details: SendDetails = row ? (JSON.parse(row.json) as SendDetails) : legacyDetails(ws, s!)

  const need = new Set(details.docs.map((d) => d.id))
  const earlier = conn.prepare('SELECT json FROM poster_send_details WHERE at < ? ORDER BY at DESC').iterate(details.at) as IterableIterator<{ json: string }>
  for (const r of earlier) {
    if (!need.size) break
    const older = JSON.parse(r.json) as SendDetails
    for (const d of older.docs) {
      if (!need.has(d.id)) continue
      need.delete(d.id)
      const target = details.docs.find((x) => x.id === d.id)
      if (target) target.prev = { sendId: older.id, at: older.at, ...(d.snap ? { snap: d.snap } : {}) }
    }
  }
  return details
}
