/**
 * Разовый перенос: документ прежнего конструктора меню (Vercel Blob `workspace.json` или локальный
 * `web/.data/workspace.json` из MenuPoster) → таблица poster_workspace.
 *
 *   cd backend && npx tsx scripts/import-poster-workspace.ts /path/to/workspace.json
 *
 * Заменяет текущий документ конструктора целиком (версия растёт, открытые вкладки получат 409 и
 * перезагрузят свежие данные). Строки, уже связанные с каталогом, сразу получают цены из базы.
 */
import { readFileSync } from 'node:fs'
import { config } from '../src/config'
import { db } from '../src/db'
import { importPosterWorkspace } from '../src/modules/admin/posterStore'
import type { Workspace } from '@sixth-cup/menu-core/model'

const file = process.argv[2]
if (!file) {
  console.error('Укажите файл: npx tsx scripts/import-poster-workspace.ts workspace.json')
  process.exit(1)
}
const ws = JSON.parse(readFileSync(file, 'utf8')) as Workspace
if (!Array.isArray(ws.groups) || !Array.isArray(ws.documents)) {
  console.error('Это не документ конструктора: нет groups/documents')
  process.exit(1)
}
const saved = importPosterWorkspace(ws, db)
console.log(
  `Готово (${config.dbPath}): кафе ${saved.cafes.length}, таблиц ${saved.groups.length}, документов ${saved.documents.length}, ` +
    `получателей ${saved.contacts.length}, отправок ${saved.sends.length}; версия ${saved.rev}`,
)
