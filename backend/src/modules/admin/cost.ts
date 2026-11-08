/**
 * Себестоимость / техкарты — калькуляция порций (отдельно от складских движений).
 * ИИ только черновики; запись в БД только после явного confirm с админки.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { resolveAiConfig } from '../../lib/aiSettings'
import { parseTechcardText, parseTechcardBuffer, type ParsedRecipe } from './techcardImport'

type Role = 'owner' | 'manager' | 'viewer'
function roleOf(c: { get: (k: string) => unknown }): Role {
  return (c.get('adminRole' as never) as Role) || 'owner'
}
function requireWrite(c: { get: (k: string) => unknown }) {
  if (roleOf(c) === 'viewer') throw bad('Read-only admin token', 403)
}

const unitZ = z.enum(['g', 'ml', 'pcs'])
const roleZ = z.enum(['base', 'optional'])

export function unitPriceKop(packPriceKop: number | null | undefined, packQty: number): number | null {
  if (packPriceKop == null || !(packQty > 0)) return null
  return packPriceKop / packQty
}

export function lineSumKop(qty: number, packPriceKop: number | null | undefined, packQty: number): number | null {
  const u = unitPriceKop(packPriceKop, packQty)
  if (u == null) return null
  return qty * u
}

export function recipeCostFromLines(
  lines: { qty: number; lineRole: string; packPriceKop: number | null; packQty: number }[],
): { costKop: number | null; optionalKop: number | null; missing: boolean } {
  let cost = 0
  let optional = 0
  let missing = false
  for (const ln of lines) {
    const s = lineSumKop(ln.qty, ln.packPriceKop, ln.packQty)
    if (s == null) {
      missing = true
      continue
    }
    if (ln.lineRole === 'optional') optional += s
    else cost += s
  }
  return {
    costKop: missing && cost === 0 ? null : cost,
    optionalKop: optional,
    missing,
  }
}

function rub(kop: number | null | undefined): number | null {
  if (kop == null || Number.isNaN(kop)) return null
  return Math.round(kop) / 100
}

function ingredientRow(id: number) {
  return db
    .prepare(
      `SELECT i.id, i.name, i.unit, i.pack_qty AS packQty, i.pack_price_kop AS packPriceKop,
              i.comment, i.active, i.category_id AS categoryId, c.name AS categoryName
         FROM cost_ingredients i
         JOIN cost_ingredient_categories c ON c.id = i.category_id
        WHERE i.id = ?`,
    )
    .get(id) as
    | {
        id: number
        name: string
        unit: string
        packQty: number
        packPriceKop: number | null
        comment: string | null
        active: number
        categoryId: number
        categoryName: string
      }
    | undefined
}

function isComplete(packQty: number, packPriceKop: number | null | undefined) {
  return packQty > 0 && packPriceKop != null && packPriceKop >= 0
}

function serializeIngredient(r: NonNullable<ReturnType<typeof ingredientRow>>) {
  const unitKop = unitPriceKop(r.packPriceKop, r.packQty)
  return {
    id: r.id,
    name: r.name,
    unit: r.unit,
    packQty: r.packQty,
    packPriceRub: rub(r.packPriceKop),
    unitPriceRub: unitKop == null ? null : Math.round(unitKop * 100) / 10000,
    comment: r.comment,
    active: !!r.active,
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    complete: isComplete(r.packQty, r.packPriceKop),
  }
}

function loadRecipeLines(recipeId: number) {
  return db
    .prepare(
      `SELECT l.id, l.ingredient_id AS ingredientId, l.qty, l.line_role AS lineRole, l.sort_order AS sortOrder,
              i.name AS ingredientName, i.unit, i.pack_qty AS packQty, i.pack_price_kop AS packPriceKop
         FROM cost_recipe_lines l
         JOIN cost_ingredients i ON i.id = l.ingredient_id
        WHERE l.recipe_id = ?
        ORDER BY l.sort_order, l.id`,
    )
    .all(recipeId) as {
    id: number
    ingredientId: number
    qty: number
    lineRole: string
    sortOrder: number
    ingredientName: string
    unit: string
    packQty: number
    packPriceKop: number | null
  }[]
}

function serializeRecipe(id: number) {
  const r = db
    .prepare(
      `SELECT id, name, output_label AS outputLabel, product_id AS productId,
              markup_pct AS markupPct, retail_price_kop AS retailPriceKop, method_text AS methodText, status
         FROM cost_recipes WHERE id = ?`,
    )
    .get(id) as
    | {
        id: number
        name: string
        outputLabel: string | null
        productId: number | null
        markupPct: number
        retailPriceKop: number | null
        methodText: string | null
        status: string
      }
    | undefined
  if (!r) return null
  const rawLines = loadRecipeLines(id)
  const totals = recipeCostFromLines(
    rawLines.map((l) => ({
      qty: l.qty,
      lineRole: l.lineRole,
      packPriceKop: l.packPriceKop,
      packQty: l.packQty,
    })),
  )
  const costRub = rub(totals.costKop == null ? null : Math.round(totals.costKop))
  const retailCalc =
    costRub == null ? null : Math.round(costRub * (1 + Number(r.markupPct) / 100) * 100) / 100
  const retailApproved = rub(r.retailPriceKop)
  const retail = retailApproved ?? retailCalc
  const marginRub =
    retail != null && costRub != null ? Math.round((retail - costRub) * 100) / 100 : null
  const marginPct =
    marginRub != null && retail != null && retail > 0
      ? Math.round((marginRub / retail) * 1000) / 10
      : null
  return {
    ...r,
    retailPriceRub: retailApproved,
    costRub,
    optionalRub: rub(totals.optionalKop == null ? null : Math.round(totals.optionalKop)),
    missingPrices: totals.missing,
    retailCalcRub: retailCalc,
    marginRub,
    marginPct,
    lines: rawLines.map((l) => {
      const sum = lineSumKop(l.qty, l.packPriceKop, l.packQty)
      return {
        id: l.id,
        ingredientId: l.ingredientId,
        ingredientName: l.ingredientName,
        unit: l.unit,
        qty: l.qty,
        lineRole: l.lineRole,
        sortOrder: l.sortOrder,
        packQty: l.packQty,
        packPriceRub: rub(l.packPriceKop),
        lineSumRub: sum == null ? null : Math.round(sum) / 100,
        complete: isComplete(l.packQty, l.packPriceKop),
      }
    }),
  }
}

/** Простой разбор текста без ключа ИИ — чтобы UI работал в dev. */
export function parseIngredientsFromText(text: string): {
  name: string
  category: string
  unit: 'g' | 'ml' | 'pcs'
  packQty: number
  packPriceRub: number | null
  confidence: 'high' | 'low'
  note?: string
}[] {
  const items: ReturnType<typeof parseIngredientsFromText> = []
  const lines = text
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean)
  for (const line of lines) {
    const priceM = line.match(/(\d+[.,]?\d*)\s*₽|\s(\d+[.,]?\d*)\s*руб/i)
    // \b в JS опирается на ASCII: после кириллической «л»/«г» он не срабатывает,
    // поэтому границу слова задаём явным lookahead — иначе «1 л» и «200 г» не распознаются.
    const notLetter = '(?![а-яёa-z])'
    const packMl = line.match(new RegExp(`(\\d+[.,]?\\d*)\\s*(мл|ml)${notLetter}`, 'i'))
    const packL = line.match(new RegExp(`(\\d+[.,]?\\d*)\\s*(л|l)${notLetter}`, 'i'))
    const packG = line.match(new RegExp(`(\\d+[.,]?\\d*)\\s*(кг|г|kg|g)${notLetter}`, 'i'))
    const packPcs = line.match(new RegExp(`(\\d+)\\s*(шт)${notLetter}`, 'i'))
    let unit: 'g' | 'ml' | 'pcs' = 'pcs'
    let packQty = 1
    if (packL) {
      unit = 'ml'
      packQty = parseFloat(packL[1].replace(',', '.')) * 1000
    } else if (packMl) {
      unit = 'ml'
      packQty = parseFloat(packMl[1].replace(',', '.'))
    } else if (packG) {
      unit = 'g'
      const n = parseFloat(packG[1].replace(',', '.'))
      packQty = /кг|kg/i.test(packG[2]) ? n * 1000 : n
    } else if (packPcs) {
      unit = 'pcs'
      packQty = parseInt(packPcs[1], 10)
    }
    const price = priceM
      ? parseFloat((priceM[1] || priceM[2]).replace(',', '.'))
      : null
    let category = 'Прочее'
    const low = line.toLowerCase()
    if (/молок|сливк|овсян|миндал|соев/.test(low)) category = 'Молоко и альтернативы'
    else if (/сироп|топпинг/.test(low)) category = 'Сиропы и топпинги'
    else if (/стакан|крышк|трубоч|салфет/.test(low)) category = 'Посуда'
    else if (/кофе|эспрессо|зерн|какао/.test(low)) category = 'Кофе и зерно'
    else if (/маршмел|кориц|спец|посып/.test(low)) category = 'Специи и украшения'
    else if (/хлеб|чиабат|индейк|сыр|салат|томат/.test(low)) category = 'Еда / заготовки'
    const name = line
      .replace(/[—\-–]\s*\d+[.,]?\d*\s*(₽|руб).*/i, '')
      .replace(new RegExp(`\\d+[.,]?\\d*\\s*(мл|ml|л|l|кг|г|kg|g|шт)${notLetter}.*`, 'i'), '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .replace(/[,.:]+$/, '')
    if (!name || name.length < 2) continue
    items.push({
      name: name.slice(0, 120),
      category,
      unit,
      packQty,
      packPriceRub: price,
      confidence: price != null && packQty > 0 ? 'high' : 'low',
      note: price == null ? 'Цена не распознана' : undefined,
    })
  }
  return items
}


function findIngredientByName(name: string, unit?: string) {
  const n = name.trim().toLowerCase()
  const rows = db
    .prepare(
      `SELECT id, name, unit, pack_qty AS packQty, pack_price_kop AS packPriceKop, category_id AS categoryId
         FROM cost_ingredients WHERE lower(name)=lower(?) AND active=1`,
    )
    .all(name) as { id: number; name: string; unit: string; packQty: number; packPriceKop: number | null; categoryId: number }[]
  if (unit) {
    const m = rows.find((r) => r.unit === unit)
    if (m) return m
  }
  return rows[0] || null
}

function ensureCategoryId(name: string): number {
  const existing = db.prepare(`SELECT id FROM cost_ingredient_categories WHERE name=?`).get(name) as
    | { id: number }
    | undefined
  if (existing) return existing.id
  const max = (db.prepare(`SELECT COALESCE(MAX(sort_order),0) AS m FROM cost_ingredient_categories`).get() as { m: number }).m
  const info = db
    .prepare(`INSERT INTO cost_ingredient_categories(name, sort_order, is_system) VALUES(?,?,0)`)
    .run(name, max + 10)
  return Number(info.lastInsertRowid)
}

function guessCategory(name: string): string {
  const low = name.toLowerCase()
  if (/молок|сливк|овсян|миндал|соев/.test(low)) return 'Молоко и альтернативы'
  if (/сироп|топпинг/.test(low)) return 'Сиропы и топпинги'
  if (/стакан|крышк|трубоч|салфет/.test(low)) return 'Посуда'
  if (/кофе|эспрессо|зерн|какао/.test(low)) return 'Кофе и зерно'
  if (/маршмел|кориц|спец|посып|анис|гвоздик/.test(low)) return 'Специи и украшения'
  if (/хлеб|чиабат|индейк|сыр|салат|томат|сэндвич|тунец/.test(low)) return 'Еда / заготовки'
  return 'Прочее'
}

function defaultPackQty(unit: string): number {
  if (unit === 'ml') return 1000
  if (unit === 'g') return 1000
  return 50
}

/** Импорт техкарт: создаёт stub-ингредиенты без цены (красные) и рецепты со строками. */
function importParsedRecipes(parsed: ParsedRecipe[]) {
  const t = Date.now()
  const result = {
    recipesCreated: 0,
    recipesUpdated: 0,
    ingredientsCreated: 0,
    missingIngredientNames: [] as string[],
    recipeIds: [] as number[],
  }
  db.transaction(() => {
    for (const pr of parsed) {
      const lineIds: { ingredientId: number; qty: number; lineRole: string }[] = []
      for (const ln of pr.lines) {
        let ing = findIngredientByName(ln.ingredientName, ln.unit)
        if (!ing) {
          const catId = ensureCategoryId(guessCategory(ln.ingredientName))
          const packQty = defaultPackQty(ln.unit)
          const info = db
            .prepare(
              `INSERT INTO cost_ingredients(category_id, name, unit, pack_qty, pack_price_kop, comment, active, created_at, updated_at)
               VALUES(?,?,?,?,NULL,?,?,?,?)`,
            )
            .run(
              catId,
              ln.ingredientName,
              ln.unit,
              packQty,
              'Импорт из техкарты — укажите цену закупки',
              1,
              t,
              t,
            )
          result.ingredientsCreated++
          result.missingIngredientNames.push(ln.ingredientName)
          ing = {
            id: Number(info.lastInsertRowid),
            name: ln.ingredientName,
            unit: ln.unit,
            packQty,
            packPriceKop: null,
            categoryId: catId,
          }
        } else if (ing.packPriceKop == null) {
          result.missingIngredientNames.push(ing.name)
        }
        lineIds.push({
          ingredientId: ing.id,
          qty: ln.qty,
          lineRole: ln.lineRole,
        })
      }
      const existing = db
        .prepare(`SELECT id FROM cost_recipes WHERE lower(name)=lower(?)`)
        .get(pr.name) as { id: number } | undefined
      let recipeId: number
      if (existing) {
        recipeId = existing.id
        db.prepare(
          `UPDATE cost_recipes SET output_label=COALESCE(?, output_label), method_text=COALESCE(?, method_text), updated_at=? WHERE id=?`,
        ).run(pr.outputLabel, pr.methodText, t, recipeId)
        db.prepare(`DELETE FROM cost_recipe_lines WHERE recipe_id=?`).run(recipeId)
        result.recipesUpdated++
      } else {
        const info = db
          .prepare(
            `INSERT INTO cost_recipes(name, output_label, product_id, markup_pct, retail_price_kop, method_text, status, created_at, updated_at)
             VALUES(?,?,NULL,300,NULL,?,'active',?,?)`,
          )
          .run(pr.name, pr.outputLabel, pr.methodText, t, t)
        recipeId = Number(info.lastInsertRowid)
        result.recipesCreated++
      }
      lineIds.forEach((ln, i) => {
        db.prepare(
          `INSERT INTO cost_recipe_lines(recipe_id, ingredient_id, qty, line_role, sort_order) VALUES(?,?,?,?,?)`,
        ).run(recipeId, ln.ingredientId, ln.qty, ln.lineRole, i)
      })
      result.recipeIds.push(recipeId)
    }
  })()
  result.missingIngredientNames = [...new Set(result.missingIngredientNames)]
  return result
}


export const adminCost = new Hono()
  .get('/cost/categories', (c) => {
    const rows = db
      .prepare(
        `SELECT id, name, sort_order AS sortOrder, is_system AS isSystem FROM cost_ingredient_categories ORDER BY sort_order, id`,
      )
      .all()
    return c.json({ categories: rows })
  })
  .post(
    '/cost/categories',
    zValidator(
      'json',
      z.object({
        name: z.string().trim().min(1).max(80),
      }),
    ),
    (c) => {
      requireWrite(c)
      const { name } = c.req.valid('json')
      try {
        const max = (
          db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM cost_ingredient_categories`).get() as {
            m: number
          }
        ).m
        const info = db
          .prepare(
            `INSERT INTO cost_ingredient_categories(name, sort_order, is_system) VALUES(?,?,0)`,
          )
          .run(name, max + 10)
        return c.json({
          ok: true,
          category: {
            id: Number(info.lastInsertRowid),
            name,
            sortOrder: max + 10,
            isSystem: 0,
          },
        })
      } catch {
        throw bad('Категория уже есть', 409)
      }
    },
  )
  .get('/cost/ingredients', (c) => {
    const q = (c.req.query('q') || '').trim()
    const cat = c.req.query('categoryId')
    const onlyComplete = c.req.query('complete') === '1'
    let sql = `SELECT i.id, i.name, i.unit, i.pack_qty AS packQty, i.pack_price_kop AS packPriceKop,
                      i.comment, i.active, i.category_id AS categoryId, c.name AS categoryName
                 FROM cost_ingredients i
                 JOIN cost_ingredient_categories c ON c.id = i.category_id
                WHERE 1=1`
    const params: (string | number)[] = []
    if (q) {
      sql += ` AND i.name LIKE ?`
      params.push(`%${q}%`)
    }
    if (cat) {
      sql += ` AND i.category_id = ?`
      params.push(Number(cat))
    }
    sql += ` ORDER BY c.sort_order, i.name`
    let rows = db.prepare(sql).all(...params) as NonNullable<ReturnType<typeof ingredientRow>>[]
    if (onlyComplete) {
      rows = rows.filter((r) => isComplete(r.packQty, r.packPriceKop) && r.active)
    }
    return c.json({
      ingredients: rows.map(serializeIngredient),
    })
  })
  .post(
    '/cost/ingredients',
    zValidator(
      'json',
      z.object({
        name: z.string().trim().min(1).max(120),
        categoryId: z.number().int().positive(),
        unit: unitZ,
        packQty: z.number().positive(),
        packPriceRub: z.number().nonnegative().nullable().optional(),
        comment: z.string().max(300).nullable().optional(),
        active: z.boolean().optional(),
      }),
    ),
    (c) => {
      requireWrite(c)
      const p = c.req.valid('json')
      const cat = db
        .prepare(`SELECT id FROM cost_ingredient_categories WHERE id=?`)
        .get(p.categoryId)
      if (!cat) throw bad('Категория не найдена', 404)
      const t = Date.now()
      const kop =
        p.packPriceRub == null ? null : Math.round(Number(p.packPriceRub) * 100)
      const info = db
        .prepare(
          `INSERT INTO cost_ingredients(category_id, name, unit, pack_qty, pack_price_kop, comment, active, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          p.categoryId,
          p.name,
          p.unit,
          p.packQty,
          kop,
          p.comment ?? null,
          p.active === false ? 0 : 1,
          t,
          t,
        )
      const row = ingredientRow(Number(info.lastInsertRowid))
      return c.json({ ok: true, ingredient: row ? serializeIngredient(row) : null })
    },
  )
  .put(
    '/cost/ingredients/:id',
    zValidator(
      'json',
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
        categoryId: z.number().int().positive().optional(),
        unit: unitZ.optional(),
        packQty: z.number().positive().optional(),
        packPriceRub: z.number().nonnegative().nullable().optional(),
        comment: z.string().max(300).nullable().optional(),
        active: z.boolean().optional(),
      }),
    ),
    (c) => {
      requireWrite(c)
      const id = Number(c.req.param('id'))
      const cur = ingredientRow(id)
      if (!cur) throw bad('Ингредиент не найден', 404)
      const p = c.req.valid('json')
      const name = p.name ?? cur.name
      const categoryId = p.categoryId ?? cur.categoryId
      const unit = p.unit ?? cur.unit
      const packQty = p.packQty ?? cur.packQty
      const kop =
        p.packPriceRub !== undefined
          ? p.packPriceRub == null
            ? null
            : Math.round(Number(p.packPriceRub) * 100)
          : cur.packPriceKop
      const comment = p.comment !== undefined ? p.comment : cur.comment
      const active = p.active !== undefined ? (p.active ? 1 : 0) : cur.active
      db.prepare(
        `UPDATE cost_ingredients SET category_id=?, name=?, unit=?, pack_qty=?, pack_price_kop=?, comment=?, active=?, updated_at=? WHERE id=?`,
      ).run(categoryId, name, unit, packQty, kop, comment, active, Date.now(), id)
      const row = ingredientRow(id)
      return c.json({ ok: true, ingredient: row ? serializeIngredient(row) : null })
    },
  )

  .delete('/cost/ingredients/:id', (c) => {
    requireWrite(c)
    const id = Number(c.req.param('id'))
    if (!ingredientRow(id)) throw bad('Ингредиент не найден', 404)
    const used = db
      .prepare(
        `SELECT r.id AS recipeId, r.name AS recipeName FROM cost_recipe_lines l
         JOIN cost_recipes r ON r.id = l.recipe_id WHERE l.ingredient_id=? LIMIT 20`,
      )
      .all(id) as { recipeId: number; recipeName: string }[]
    if (used.length) {
      throw bad(
        `Нельзя удалить: используется в рецептах: ${used.map((u) => u.recipeName).join(', ')}`,
        409,
      )
    }
    db.prepare(`DELETE FROM cost_ingredients WHERE id=?`).run(id)
    return c.json({ ok: true })
  })

  .get('/cost/ingredients/:id/usage', (c) => {
    const id = Number(c.req.param('id'))
    if (!ingredientRow(id)) throw bad('Ингредиент не найден', 404)
    const rows = db
      .prepare(
        `SELECT r.id AS recipeId, r.name AS recipeName, l.qty, l.line_role AS lineRole, i.unit
           FROM cost_recipe_lines l
           JOIN cost_recipes r ON r.id = l.recipe_id
           JOIN cost_ingredients i ON i.id = l.ingredient_id
          WHERE l.ingredient_id = ?
          ORDER BY r.name`,
      )
      .all(id)
    return c.json({ usage: rows })
  })
  .get('/cost/recipes', (c) => {
    const ids = (
      db.prepare(`SELECT id FROM cost_recipes ORDER BY name`).all() as { id: number }[]
    ).map((r) => r.id)
    return c.json({
      recipes: ids.map((id) => serializeRecipe(id)).filter(Boolean),
    })
  })
  .get('/cost/recipes/:id', (c) => {
    const rec = serializeRecipe(Number(c.req.param('id')))
    if (!rec) throw bad('Рецепт не найден', 404)
    return c.json({ recipe: rec })
  })
  .post(
    '/cost/recipes',
    zValidator(
      'json',
      z.object({
        name: z.string().trim().min(1).max(120),
        outputLabel: z.string().max(40).nullable().optional(),
        productId: z.number().int().positive().nullable().optional(),
        markupPct: z.number().min(0).max(10000).optional(),
        retailPriceRub: z.number().nonnegative().nullable().optional(),
        methodText: z.string().max(4000).nullable().optional(),
        lines: z
          .array(
            z.object({
              ingredientId: z.number().int().positive(),
              qty: z.number().positive(),
              lineRole: roleZ.optional(),
            }),
          )
          .optional(),
      }),
    ),
    (c) => {
      requireWrite(c)
      const p = c.req.valid('json')
      const t = Date.now()
      const retailKop =
        p.retailPriceRub == null || p.retailPriceRub === undefined
          ? null
          : Math.round(Number(p.retailPriceRub) * 100)
      const create = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO cost_recipes(name, output_label, product_id, markup_pct, retail_price_kop, method_text, status, created_at, updated_at)
             VALUES(?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            p.name,
            p.outputLabel ?? null,
            p.productId ?? null,
            p.markupPct ?? 300,
            retailKop,
            p.methodText ?? null,
            'active',
            t,
            t,
          )
        const id = Number(info.lastInsertRowid)
        for (const [i, ln] of (p.lines || []).entries()) {
          const ing = ingredientRow(ln.ingredientId)
          if (!ing) throw bad(`Ингредиент ${ln.ingredientId} не найден`, 400)
          // неполный ингредиент допустим: в UI красный, в себес не входит
          db.prepare(
            `INSERT INTO cost_recipe_lines(recipe_id, ingredient_id, qty, line_role, sort_order) VALUES(?,?,?,?,?)`,
          ).run(id, ln.ingredientId, ln.qty, ln.lineRole ?? 'base', i)
        }
        return id
      })
      const id = create()
      return c.json({ ok: true, recipe: serializeRecipe(id) })
    },
  )
  .put(
    '/cost/recipes/:id',
    zValidator(
      'json',
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
        outputLabel: z.string().max(40).nullable().optional(),
        productId: z.number().int().positive().nullable().optional(),
        markupPct: z.number().min(0).max(10000).optional(),
        retailPriceRub: z.number().nonnegative().nullable().optional(),
        methodText: z.string().max(4000).nullable().optional(),
        lines: z
          .array(
            z.object({
              ingredientId: z.number().int().positive(),
              qty: z.number().positive(),
              lineRole: roleZ.optional(),
            }),
          )
          .optional(),
      }),
    ),
    (c) => {
      requireWrite(c)
      const id = Number(c.req.param('id'))
      if (!serializeRecipe(id)) throw bad('Рецепт не найден', 404)
      const p = c.req.valid('json')
      const t = Date.now()
      db.transaction(() => {
        const cur = db
          .prepare(
            `SELECT name, output_label AS outputLabel, product_id AS productId, markup_pct AS markupPct,
                    retail_price_kop AS retailPriceKop, method_text AS methodText FROM cost_recipes WHERE id=?`,
          )
          .get(id) as {
          name: string
          outputLabel: string | null
          productId: number | null
          markupPct: number
          retailPriceKop: number | null
          methodText: string | null
        }
        const retailKop =
          p.retailPriceRub !== undefined
            ? p.retailPriceRub == null
              ? null
              : Math.round(Number(p.retailPriceRub) * 100)
            : cur.retailPriceKop
        db.prepare(
          `UPDATE cost_recipes SET name=?, output_label=?, product_id=?, markup_pct=?, retail_price_kop=?, method_text=?, updated_at=? WHERE id=?`,
        ).run(
          p.name ?? cur.name,
          p.outputLabel !== undefined ? p.outputLabel : cur.outputLabel,
          p.productId !== undefined ? p.productId : cur.productId,
          p.markupPct ?? cur.markupPct,
          retailKop,
          p.methodText !== undefined ? p.methodText : cur.methodText,
          t,
          id,
        )
        if (p.lines) {
          db.prepare(`DELETE FROM cost_recipe_lines WHERE recipe_id=?`).run(id)
          for (const [i, ln] of p.lines.entries()) {
            const ing = ingredientRow(ln.ingredientId)
            if (!ing) throw bad(`Ингредиент ${ln.ingredientId} не найден`, 400)
            // неполный ингредиент допустим
            db.prepare(
              `INSERT INTO cost_recipe_lines(recipe_id, ingredient_id, qty, line_role, sort_order) VALUES(?,?,?,?,?)`,
            ).run(id, ln.ingredientId, ln.qty, ln.lineRole ?? 'base', i)
          }
        }
      })()
      return c.json({ ok: true, recipe: serializeRecipe(id) })
    },
  )
  .delete('/cost/recipes/:id', (c) => {
    requireWrite(c)
    const id = Number(c.req.param('id'))
    db.prepare(`DELETE FROM cost_recipe_lines WHERE recipe_id=?`).run(id)
    const r = db.prepare(`DELETE FROM cost_recipes WHERE id=?`).run(id)
    if (!r.changes) throw bad('Рецепт не найден', 404)
    return c.json({ ok: true })
  })
  .post(
    '/cost/import/techcard-text',
    zValidator('json', z.object({ text: z.string().min(1).max(500_000) })),
    (c) => {
      requireWrite(c)
      const { text } = c.req.valid('json')
      const parsed = parseTechcardText(text)
      if (!parsed.length) throw bad('Не удалось разобрать техкарту — проверьте формат', 400)
      const result = importParsedRecipes(parsed)
      return c.json({ ok: true, parsed: parsed.length, ...result })
    },
  )
  .post('/cost/import/techcard-file', async (c) => {
    requireWrite(c)
    const body = await c.req.parseBody()
    const file = body['file']
    if (!file || typeof file === 'string') throw bad('Нужен файл file (xlsx/csv)', 400)
    const f = file as File
    // Техкарта — это таблица на пару десятков строк: большой файл явно не про неё,
    // а разбор Excel дорогой (и лишний риск для памяти).
    if (f.size > 5 * 1024 * 1024) throw bad('Файл больше 5 МБ — сохраните техкарту отдельно', 400)
    const buf = await f.arrayBuffer()
    let parsed
    try {
      parsed = parseTechcardBuffer(buf, f.name || 'techcard.xlsx')
    } catch (e) {
      throw bad(e instanceof Error ? e.message : 'Не удалось прочитать файл', 400)
    }
    if (!parsed.length) throw bad('В файле не найдено рецептов с составом', 400)
    const result = importParsedRecipes(parsed)
    return c.json({ ok: true, file: f.name, parsed: parsed.length, ...result })
  })

  .get('/cost/summary', (c) => {
    const ids = (
      db.prepare(`SELECT id FROM cost_recipes ORDER BY name`).all() as { id: number }[]
    ).map((r) => r.id)
    const recipes = ids.map((id) => serializeRecipe(id)).filter(Boolean) as NonNullable<
      ReturnType<typeof serializeRecipe>
    >[]
    return c.json({
      rows: recipes.map((r) => ({
        id: r.id,
        name: r.name,
        outputLabel: r.outputLabel,
        costRub: r.costRub,
        markupPct: r.markupPct,
        retailRub: r.retailPriceRub ?? r.retailCalcRub,
        marginPct: r.marginPct,
        missingPrices: r.missingPrices,
        warnings: r.missingPrices ? ['нет цен у сырья'] : [],
      })),
    })
  })
  .post(
    '/cost/ai/parse',
    zValidator(
      'json',
      z.object({
        text: z.string().min(1).max(20000),
      }),
    ),
    async (c) => {
      requireWrite(c)
      const { text } = c.req.valid('json')
      const cfg = resolveAiConfig()
      let items = parseIngredientsFromText(text)
      if (cfg.enabled && cfg.hasKey) {
        try {
          const url = cfg.baseUrl.replace(/\/$/, '') + '/chat/completions'
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${cfg.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: cfg.model,
              temperature: 0.1,
              messages: [
                {
                  role: 'system',
                  content:
                    'Ты извлекаешь ингредиенты кофейни из текста/прайса. Верни ТОЛЬКО JSON: {"items":[{"name":"...","category":"Молоко и альтернативы|Кофе и зерно|Сиропы и топпинги|Посуда|Еда / заготовки|Специи и украшения|Прочее","unit":"g|ml|pcs","packQty":number,"packPriceRub":number|null,"confidence":"high|low","note":"..."}]} Без markdown.',
                },
                { role: 'user', content: text.slice(0, 12000) },
              ],
            }),
            signal:
              typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
                ? AbortSignal.timeout(45000)
                : undefined,
          })
          if (res.ok) {
            const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
            const raw = j.choices?.[0]?.message?.content?.trim() || ''
            const m = raw.match(/\{[\s\S]*\}/)
            if (m) {
              const parsed = JSON.parse(m[0]) as { items?: typeof items }
              if (Array.isArray(parsed.items) && parsed.items.length) items = parsed.items
            }
          }
        } catch {
          /* fallback heuristic already in items */
        }
      }
      return c.json({
        ok: true,
        provider: cfg.hasKey && cfg.enabled ? 'deepseek' : 'heuristic',
        items,
      })
    },
  )
  .post(
    '/cost/ingredients/bulk',
    zValidator(
      'json',
      z.object({
        items: z.array(
          z.object({
            name: z.string().trim().min(1).max(120),
            categoryName: z.string().trim().min(1).max(80).optional(),
            categoryId: z.number().int().positive().optional(),
            unit: unitZ,
            packQty: z.number().positive(),
            packPriceRub: z.number().nonnegative().nullable().optional(),
            comment: z.string().max(300).nullable().optional(),
          }),
        ),
      }),
    ),
    (c) => {
      requireWrite(c)
      const { items } = c.req.valid('json')
      const created: unknown[] = []
      const t = Date.now()
      db.transaction(() => {
        for (const it of items) {
          let categoryId = it.categoryId
          if (!categoryId && it.categoryName) {
            const existing = db
              .prepare(`SELECT id FROM cost_ingredient_categories WHERE name=?`)
              .get(it.categoryName) as { id: number } | undefined
            if (existing) categoryId = existing.id
            else {
              const max = (
                db
                  .prepare(`SELECT COALESCE(MAX(sort_order),0) AS m FROM cost_ingredient_categories`)
                  .get() as { m: number }
              ).m
              const info = db
                .prepare(
                  `INSERT INTO cost_ingredient_categories(name, sort_order, is_system) VALUES(?,?,0)`,
                )
                .run(it.categoryName, max + 10)
              categoryId = Number(info.lastInsertRowid)
            }
          }
          if (!categoryId) {
            categoryId = (
              db.prepare(`SELECT id FROM cost_ingredient_categories WHERE name='Прочее'`).get() as {
                id: number
              }
            ).id
          }
          const kop =
            it.packPriceRub == null || it.packPriceRub === undefined
              ? null
              : Math.round(Number(it.packPriceRub) * 100)
          const info = db
            .prepare(
              `INSERT INTO cost_ingredients(category_id, name, unit, pack_qty, pack_price_kop, comment, active, created_at, updated_at)
               VALUES(?,?,?,?,?,?,1,?,?)`,
            )
            .run(categoryId, it.name, it.unit, it.packQty, kop, it.comment ?? null, t, t)
          const row = ingredientRow(Number(info.lastInsertRowid))
          if (row) created.push(serializeIngredient(row))
        }
      })()
      return c.json({ ok: true, ingredients: created })
    },
  )
