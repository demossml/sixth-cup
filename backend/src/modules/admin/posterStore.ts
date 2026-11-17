/**
 * Хранилище конструктора «Меню и Ценники»: один документ в таблице poster_workspace.
 *
 * Запись условная по rev — правка, сделанная от устаревшей версии, получает 409 со свежим документом.
 * База главнее: при каждом чтении и записи цены строк, привязанных к каталогу, сверяются с products,
 * изменения попадают в журнал и ставят документы в «Список в печать».
 */
import type Database from 'better-sqlite3'
import { db as defaultDb } from '../../db'
import { coalesce, LOG_LIMIT } from '@sixth-cup/menu-core/changelog'
import { syncCatalogPrices } from '@sixth-cup/menu-core/catalog'
import { diffWorkspace } from '@sixth-cup/menu-core/diff'
import { migrateWorkspace, type Workspace } from '@sixth-cup/menu-core/model'
import { seedWorkspace } from '@sixth-cup/menu-core/seed'
import { buildPosterCatalog } from './posterCatalog'

export class PosterConflict extends Error {
  constructor(public current: Workspace) {
    super('conflict')
  }
}

function readRow(conn: Database.Database): Workspace | null {
  const row = conn.prepare('SELECT json FROM poster_workspace WHERE id = 1').get() as { json: string } | undefined
  return row ? migrateWorkspace(JSON.parse(row.json) as Workspace) : null
}

function writeRow(conn: Database.Database, ws: Workspace) {
  conn
    .prepare(
      `INSERT INTO poster_workspace (id, json, rev, updated_at) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json, rev = excluded.rev, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(ws), ws.rev, Date.now())
}

/** Принять цены из базы. true — что-то поменялось (документ надо сохранить с новой версией). */
function syncPrices(conn: Database.Database, ws: Workspace, at: string): boolean {
  const r = syncCatalogPrices(ws, buildPosterCatalog(conn), at)
  if (r.log.length) ws.changeLog = coalesce(ws.changeLog, r.log.map((text) => ({ at, text }))).slice(-LOG_LIMIT)
  return r.changed > 0
}

/** Текущий документ с ценами из базы. Первый запуск — стартовое меню. */
export function loadPosterWorkspace(conn: Database.Database = defaultDb): Workspace {
  return conn.transaction(() => {
    const at = new Date().toISOString()
    const stored = readRow(conn)
    const ws = stored ?? seedWorkspace()
    const changed = syncPrices(conn, ws, at)
    if (!stored || changed) {
      if (stored) ws.rev += 1
      writeRow(conn, ws)
    }
    return ws
  }).immediate()
}

/** Сохранить правку клиента. baseRev — версия, от которой клиент правил. */
export function savePosterWorkspace(next: Workspace, baseRev: number, conn: Database.Database = defaultDb): Workspace {
  return conn.transaction(() => {
    migrateWorkspace(next) // вкладка, открытая до обновления, может прислать старый формат
    const cur = readRow(conn) ?? seedWorkspace()
    if (cur.rev !== baseRev) throw new PosterConflict(cur)
    const at = new Date().toISOString()
    const entries = diffWorkspace(cur, next).map((text) => ({ at, text }))
    const merged: Workspace = {
      ...next,
      rev: cur.rev + 1,
      // отправки и отметки «отправлено» меняет только сервер
      sends: cur.sends,
      documents: next.documents.map((d) => ({ ...d, lastSent: cur.documents.find((x) => x.id === d.id)?.lastSent })),
      changeLog: coalesce(cur.changeLog, entries).slice(-LOG_LIMIT),
    }
    // цену связанной строки клиент не перебьёт: после правки снова берём её из базы
    syncPrices(conn, merged, at)
    writeRow(conn, merged)
    return merged
  }).immediate()
}

/** Серверная правка (отметка отправки, получатели) — атомарно, от текущей версии. */
export function mutatePosterWorkspace(fn: (ws: Workspace) => Workspace, conn: Database.Database = defaultDb): Workspace {
  return conn.transaction(() => {
    const cur = readRow(conn) ?? seedWorkspace()
    const next = { ...fn(structuredClone(cur)), rev: cur.rev + 1 }
    writeRow(conn, next)
    return next
  }).immediate()
}

/** Положить документ целиком (перенос данных из прежнего конструктора). */
export function importPosterWorkspace(ws: Workspace, conn: Database.Database = defaultDb): Workspace {
  return conn.transaction(() => {
    const cur = readRow(conn)
    const next = migrateWorkspace(structuredClone(ws))
    next.rev = Math.max(next.rev ?? 0, cur?.rev ?? 0) + 1
    syncPrices(conn, next, new Date().toISOString())
    writeRow(conn, next)
    return next
  }).immediate()
}
