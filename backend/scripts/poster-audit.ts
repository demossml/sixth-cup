/**
 * Сверка конструктора «Меню и Ценники» с базой товаров — перед выкаткой или после правок каталога.
 *
 *   cd backend && npx tsx scripts/poster-audit.ts /путь/к/копии/sixth-cup.db [--json отчёт.json] [--all]
 *
 * Исходный файл не трогается: скрипт снимает с него копию (вместе с WAL) во временную папку, применяет
 * к копии те же миграции, что сервер при запуске, собирает каталог так же, как GET /poster/catalog, и
 * проходит по каждой строке меню:
 *   — к чему привязана, есть ли товар и размеры в базе (иначе сервер пометит строку missing);
 *   — как колонки меню сопоставлены с размерами товара (0.25 ↔ 250 мл);
 *   — расходится ли цена в меню с ценой в базе (что сервер поменяет при первом чтении документа);
 *   — совпадает ли название в меню с названием в базе (названия после привязки не сверяются);
 *   — какие непривязанные строки «Связать по названиям» свяжет сама, а какие — нет.
 * Плюс по каталогу: одинаковые названия (связь по названию возьмёт первое), товары без размеров
 * и с нулевой ценой, скрытые товары в меню, товары, которых нет в меню.
 *
 * --all — печатать списки целиком (по умолчанию — первые 30 строк каждого раздела).
 */
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { isMilkLink, linkByNames, nameKey, syncCatalogPrices, volumeMl, type Catalog, type CatalogProduct } from '@sixth-cup/menu-core/catalog'
import { isBlankItem, migrateWorkspace, variationTitle, type Group, type Item, type Variation, type Workspace } from '@sixth-cup/menu-core/model'
import { seedWorkspace } from '@sixth-cup/menu-core/seed'
import { runMigrations } from '../src/db/migrate'
import { SCHEMA } from '../src/db/schema'
import { migrateEvotorSchema } from '../src/integrations/evotor/db'
import { dedupeCategoriesByName } from '../src/modules/catalog/addonScheme'
import { buildPosterCatalog } from '../src/modules/admin/posterCatalog'

type Level = 'error' | 'warn' | 'info'
interface Finding {
  level: Level
  kind: string
  where: string
  text: string
}

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const option = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const source = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--json')
if (!source) {
  console.error('Укажите копию базы: npx tsx scripts/poster-audit.ts /путь/к/sixth-cup.db [--json отчёт.json] [--all]')
  process.exit(1)
}
const sourcePath = resolve(source)
if (!existsSync(sourcePath)) {
  console.error(`Файл не найден: ${sourcePath}`)
  process.exit(1)
}
const jsonPath = option('--json')
const limit = flag('--all') ? Infinity : 30

async function main() {
  // 1. Копия базы: backup() забирает и то, что ещё лежит в -wal.
  const dir = mkdtempSync(join(tmpdir(), 'poster-audit-'))
  const copyPath = join(dir, basename(sourcePath))
  const src = new Database(sourcePath, { readonly: true, fileMustExist: true })
  await src.backup(copyPath)
  src.close()

  try {
    const db = new Database(copyPath)
    db.pragma('foreign_keys = ON')

    // 2. Миграции — как при запуске сервера (src/db/index.ts).
    const applied = (): Set<string> => {
      const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
      return new Set(has ? (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id) : [])
    }
    const before = applied()
    db.exec(SCHEMA)
    migrateEvotorSchema(db)
    runMigrations(db)
    const collapsed = dedupeCategoriesByName(db)
    const newMigrations = [...applied()].filter((id) => !before.has(id)).sort()
    const triggers = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_price_stamp_%'").all() as { name: string }[]).map((r) => r.name)

    // 3. Каталог и документ конструктора.
    const catalog = buildPosterCatalog(db)
    const row = db.prepare('SELECT json, rev FROM poster_workspace WHERE id = 1').get() as { json: string; rev: number } | undefined
    const ws: Workspace = row ? migrateWorkspace(JSON.parse(row.json) as Workspace) : seedWorkspace()

    const findings = [...auditCatalog(catalog), ...auditMenu(ws, catalog)]
    const sync = syncCatalogPrices(structuredClone(ws), catalog)
    const autoLink = structuredClone(ws)
    const autoLinked = linkByNames(autoLink.groups, catalog)

    const counts = menuCounts(ws)
    const stamps = db.prepare('SELECT COUNT(*) AS n, SUM(at IS NOT NULL) AS dated FROM catalog_price_stamps').get() as { n: number; dated: number | null }
    db.close()

    // 4. Отчёт.
    const out: string[] = []
    const line = (s = '') => out.push(s)
    line(`Сверка конструктора «Меню и Ценники» с базой: ${sourcePath}`)
    line()
    line('База')
    line(`  Новые миграции на этой копии: ${newMigrations.length ? newMigrations.join(', ') : 'нет — база уже актуальна'}`)
    if (collapsed) line(`  Объединено одинаковых категорий: ${collapsed}`)
    line(`  Триггеры дат цен: ${triggers.length}/4${triggers.length < 4 ? ' — НЕ ВСЕ, проверьте миграцию 074' : ''}`)
    line(`  Отметки цен: ${stamps.n}, из них с датой изменения: ${stamps.dated ?? 0}`)
    line()
    line('Каталог для конструктора')
    const prods = catalog.products
    line(`  Товаров: ${prods.length} (групп размеров ${prods.filter((p) => p.id.startsWith('g:')).length}, добавок ${prods.filter((p) => p.addon).length}, скрытых ${prods.filter((p) => !p.available).length})`)
    line(`  С молоком: ${prods.filter((p) => p.milk.length).length}`)
    line()
    line('Меню')
    line(row ? `  Документ версии ${row.rev}` : '  Документа ещё нет — сервер при первом чтении создаст стартовое меню (проверяется оно)')
    line(`  Таблиц ${ws.groups.length}, позиций ${counts.items}, вариаций ${counts.variations}`)
    line(`  Привязано к базе: позиций ${counts.linkedItems}/${counts.items}, вариаций ${counts.linkedVars}/${counts.variations} (из них к молоку ${counts.milkVars})`)
    line(`  Цен «только для меню»: ${counts.manualCols}`)
    line()
    line(`Сервер при первом чтении поменяет цен: ${sync.changed}`)
    for (const s of sync.log.slice(0, limit)) line(`  ${s}`)
    if (sync.log.length > limit) line(`  …ещё ${sync.log.length - limit} (--all)`)
    line()
    const willLink = linkedDiff(ws, autoLink)
    line(`«Связать по названиям» свяжет ещё: ${autoLinked}`)
    for (const s of willLink.slice(0, limit)) line(`  ${s}`)
    if (willLink.length > limit) line(`  …ещё ${willLink.length - limit} (--all)`)
    const unmatched = unlinkedRows(autoLink)
    line(`Не найдено в базе по названию — останутся с ручной ценой: ${unmatched.length}`)
    for (const s of unmatched.slice(0, limit)) line(`  ${s}`)
    if (unmatched.length > limit) line(`  …ещё ${unmatched.length - limit} (--all)`)
    line()

    const sections: [Level, string][] = [
      ['error', 'ОШИБКИ — меню разойдётся с базой'],
      ['warn', 'ВНИМАНИЕ — проверить глазами'],
      ['info', 'СПРАВКА'],
    ]
    for (const [level, title] of sections) {
      const list = findings.filter((f) => f.level === level)
      line(`${title}: ${list.length}`)
      const byKind = new Map<string, Finding[]>()
      for (const f of list) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f])
      for (const [kind, fs] of byKind) {
        line(`  ${kind} (${fs.length})`)
        for (const f of fs.slice(0, limit)) line(`    ${f.where}: ${f.text}`)
        if (fs.length > limit) line(`    …ещё ${fs.length - limit} (--all)`)
      }
      line()
    }
    console.log(out.join('\n'))

    if (jsonPath) {
      writeFileSync(
        resolve(jsonPath),
        JSON.stringify({ source: sourcePath, newMigrations, triggers, counts, priceSync: sync, autoLinked, willLink, unmatched, findings }, null, 2),
      )
      console.log(`JSON: ${resolve(jsonPath)}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function auditCatalog(catalog: Catalog): Finding[] {
  const out: Finding[] = []
  const byName = new Map<string, CatalogProduct[]>()
  for (const p of catalog.products) {
    const k = `${p.addon ? 'a' : 'm'}|${nameKey(p.name)}`
    byName.set(k, [...(byName.get(k) ?? []), p])
    if (!p.sizes.length) out.push({ level: 'error', kind: 'Товар без размеров', where: label(p), text: 'в меню будет без цены' })
    for (const s of p.sizes)
      if (!s.price) out.push({ level: 'warn', kind: 'Нулевая цена в базе', where: label(p), text: `размер «${s.label}» (${s.key})` })
  }
  for (const list of byName.values())
    if (list.length > 1)
      out.push({
        level: 'warn',
        kind: 'Одинаковые названия в базе',
        where: list[0].name,
        text: `${list.map((p) => p.id).join(', ')} — «Связать по названиям» возьмёт первый (${list[0].id})`,
      })
  return out
}

function auditMenu(ws: Workspace, catalog: Catalog): Finding[] {
  const out: Finding[] = []
  const cat = new Map(catalog.products.map((p) => [p.id, p]))
  const milk = new Map(catalog.products.flatMap((p) => p.milk.map((m) => [m.id, m] as const)))
  const used = new Set<string>()

  for (const g of ws.groups) {
    const cols = Math.max(1, g.columns.length)
    for (const item of g.items) {
      if (isBlankItem(item)) continue
      const at = `${tableName(ws, g)} › ${item.name || '(без названия)'}`
      if (item.link) {
        used.add(item.link.ref)
        checkProductLink(out, at, g, cols, item, item.name, item.link, cat)
      } else if (item.name.trim()) {
        if (item.variations.some((v) => v.link && isMilkLink(v.link)))
          out.push({ level: 'error', kind: 'Молоко у непривязанной позиции', where: at, text: 'цена вариации не посчитается — привяжите позицию' })
      }
      for (const v of item.variations) {
        const vat = `${at} › ${v.name || '(без названия)'}`
        if (!v.link) continue
        if (isMilkLink(v.link)) {
          const m = milk.get(v.link.milkId)
          if (!m) out.push({ level: 'error', kind: 'Вида молока нет в базе', where: vat, text: `milkId ${v.link.milkId} — печатается последняя цена` })
          else {
            const base = item.link ? cat.get(item.link.ref) : undefined
            if (base && !base.milk.some((x) => x.id === m.id))
              out.push({ level: 'warn', kind: 'Молоко не из схемы товара', where: vat, text: `«${m.label}» не входит в схему молока «${base.name}»` })
            if (nameKey(v.name) !== nameKey(m.label))
              out.push({ level: 'warn', kind: 'Название отличается от базы', where: vat, text: `в базе «${m.label}»` })
          }
          if (v.sharePrice) out.push({ level: 'info', kind: 'Привязка у вариации с общей ценой', where: vat, text: 'не сверяется — печатается цена блока' })
        } else {
          used.add(v.link.ref)
          if (v.sharePrice) {
            out.push({ level: 'info', kind: 'Привязка у вариации с общей ценой', where: vat, text: 'не сверяется — печатается цена блока' })
            continue
          }
          checkProductLink(out, vat, g, cols, v, variationTitle(item.name, v.name), v.link, cat)
        }
      }
    }
  }

  for (const p of catalog.products)
    if (p.available && !used.has(p.id))
      out.push({ level: 'info', kind: p.addon ? 'Добавки нет в меню' : 'Товара нет в меню', where: label(p), text: p.sizes.map((s) => `${s.label} ${s.price}`).join(', ') })
  return out
}

function checkProductLink(
  out: Finding[],
  where: string,
  g: Group,
  cols: number,
  target: Item | Variation,
  menuName: string,
  link: NonNullable<Item['link']>,
  cat: Map<string, CatalogProduct>,
) {
  const p = cat.get(link.ref)
  if (!p) {
    out.push({ level: 'error', kind: 'Товара нет в базе', where, text: `${link.ref} — сервер пометит строку missing, печатается последняя цена` })
    return
  }
  if (!p.available) out.push({ level: 'warn', kind: 'Скрытый товар в меню', where, text: `${label(p)} скрыт в базе, а в меню печатается` })
  if (nameKey(menuName) !== nameKey(p.name)) out.push({ level: 'warn', kind: 'Название отличается от базы', where, text: `в базе «${p.name}» (${p.id})` })
  if (link.sizes.length !== cols)
    out.push({ level: 'warn', kind: 'Колонок в привязке не столько, сколько в таблице', where, text: `в привязке ${link.sizes.length}, в таблице ${cols}` })

  for (let i = 0; i < cols; i++) {
    const key = link.sizes[i] ?? null
    const col = g.columns[i] ?? `колонка ${i + 1}`
    if (key == null) {
      if (target.prices[i] != null && !link.manual?.includes(i))
        out.push({ level: 'warn', kind: 'Колонка без размера из базы', where, text: `«${col}»: цена ${target.prices[i]} своя, база её не обновляет` })
      continue
    }
    const size = p.sizes.find((s) => s.key === key)
    if (!size) {
      out.push({ level: 'error', kind: 'Размера нет в базе', where, text: `«${col}» → ${key}; у товара: ${p.sizes.map((s) => `${s.key} ${s.label}`).join(', ')}` })
      continue
    }
    const a = volumeMl(col)
    const b = volumeMl(size.label)
    if (a != null && b != null && a !== b)
      out.push({ level: 'error', kind: 'Колонка сопоставлена с другим объёмом', where, text: `«${col}» → «${size.label}» (${size.key})` })
    if (link.manual?.includes(i) && target.prices[i] !== size.price)
      out.push({ level: 'info', kind: 'Цена «только для меню»', where, text: `«${col}»: в меню ${target.prices[i] ?? '—'}, в базе ${size.price}` })
  }
  const unmapped = p.sizes.filter((s) => !link.sizes.includes(s.key))
  if (unmapped.length && p.sizes.length > 1)
    out.push({ level: 'info', kind: 'Размеры товара, которых нет в меню', where, text: unmapped.map((s) => `${s.label} ${s.price}`).join(', ') })
}

function menuCounts(ws: Workspace) {
  const c = { items: 0, variations: 0, linkedItems: 0, linkedVars: 0, milkVars: 0, manualCols: 0 }
  for (const g of ws.groups)
    for (const it of g.items) {
      if (isBlankItem(it)) continue
      c.items++
      if (it.link) c.linkedItems++
      c.manualCols += it.link?.manual?.length ?? 0
      for (const v of it.variations) {
        c.variations++
        if (v.link) c.linkedVars++
        if (v.link && isMilkLink(v.link)) c.milkVars++
        c.manualCols += v.link?.manual?.length ?? 0
      }
    }
  return c
}

/** Что «Связать по названиям» привязала бы: строка → товар или молоко. */
function linkedDiff(before: Workspace, after: Workspace): string[] {
  const out: string[] = []
  after.groups.forEach((g, gi) =>
    g.items.forEach((it, ii) => {
      const old = before.groups[gi]?.items[ii]
      if (it.link && !old?.link) out.push(`${tableName(after, g)} › ${it.name} → ${it.link.ref}`)
      it.variations.forEach((v, vi) => {
        if (v.link && !old?.variations[vi]?.link)
          out.push(`${tableName(after, g)} › ${it.name} › ${v.name} → ${isMilkLink(v.link) ? `молоко ${v.link.milkId}` : v.link.ref}`)
      })
    }),
  )
  return out
}

/** Строки с названием, которые и после «Связать по названиям» не привязаны (вариации — у привязанных позиций). */
function unlinkedRows(ws: Workspace): string[] {
  const out: string[] = []
  for (const g of ws.groups)
    for (const it of g.items) {
      if (isBlankItem(it) || !it.name.trim()) continue
      if (!it.link) out.push(`${tableName(ws, g)} › ${it.name}`)
      else if (g.style !== 'addons')
        for (const v of it.variations) if (!v.link && !v.sharePrice && v.name.trim()) out.push(`${tableName(ws, g)} › ${it.name} › ${v.name}`)
    }
  return out
}

const label = (p: CatalogProduct) => `${p.name} (${p.id}${p.category ? `, ${p.category}` : ''})`

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

/** Название таблицы; если таких несколько — с номером таблицы в документе («Кофе №4»). */
function tableName(ws: Workspace, g: Group): string {
  const title = g.title.trim() || '(без названия)'
  const same = ws.groups.filter((x) => (x.title.trim() || '(без названия)') === title).length
  return same > 1 ? `${title} №${ws.groups.indexOf(g) + 1}` : title
}
