// Каталог sixth-cup в конструкторе: какие товары можно поставить в меню и откуда берутся их цены.
// Строка, привязанная к товару (link), получает цены из базы — руками их не правят. Сервер при каждом
// чтении и сохранении сверяет цены с базой (syncCatalogPrices): изменившаяся цена встаёт в меню,
// а документ попадает в «Список в печать» через priceNotice — как любое обновление цены из базы.

import {
  applyPriceUpdates,
  type CatalogLink,
  type Group,
  type Item,
  type MilkLink,
  type Price,
  type PriceUpdate,
  type Variation,
  type Workspace,
  variationTitle,
} from "./model";

/** Размер товара: ключ «p:<id товара>» (размер группы) или «v:<id объёма схемы>», подпись и цена в рублях. */
export interface CatalogSize {
  key: string;
  label: string;
  price: number;
}

/** Вид молока из схемы товара; доплата — в рублях (0 — бесплатно). */
export interface CatalogMilk {
  id: number;
  label: string;
  surcharge: number;
}

/** Товар для меню: группа размеров («Капучино») или одиночный товар. id — «g:<id>» или «p:<id>». */
export interface CatalogProduct {
  id: string;
  name: string;
  category: string | null;
  addon: boolean; // из категории добавок
  available: boolean;
  sizes: CatalogSize[];
  milk: CatalogMilk[];
}

export interface Catalog {
  products: CatalogProduct[];
}

/** Как сравнивать названия: без регистра, лишних пробелов и разницы «е/ё». */
export const nameKey = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");

export const isMilkLink = (l: CatalogLink | MilkLink | undefined): l is MilkLink => !!l && "milkId" in l;
export const isProductLink = (l: CatalogLink | MilkLink | undefined): l is CatalogLink => !!l && "ref" in l;

/** Объём в миллилитрах из подписи: «0.25», «0,35 л», «250 мл», «250». null — не объём («1 шт», «S»). */
export function volumeMl(label: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l)?\b/i.exec(label.trim());
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "мл" || unit === "ml") return Math.round(n);
  if (unit === "л" || unit === "l") return Math.round(n * 1000);
  return n < 5 ? Math.round(n * 1000) : Math.round(n); // «0.25» — литры, «250» — миллилитры
}

/**
 * Какой размер товара поставить в какую колонку группы. Сначала по объёму (0.25 ↔ 250 мл);
 * если объёмы не читаются, а размеров столько же, сколько колонок, — по порядку.
 * Одна колонка и один размер (добавки, «1 шт») — просто он.
 */
export function matchSizes(columns: string[], sizes: CatalogSize[]): (string | null)[] {
  const cols = Math.max(1, columns.length);
  if (sizes.length === 1 && cols === 1) return [sizes[0].key];
  const byVolume = Array.from({ length: cols }, (_, i) => {
    const ml = volumeMl(columns[i] ?? "");
    if (ml == null) return null;
    return sizes.find((s) => volumeMl(s.label) === ml)?.key ?? null;
  });
  if (byVolume.some((k) => k != null)) return byVolume;
  if (sizes.length === cols) return sizes.map((s) => s.key);
  return Array.from({ length: cols }, () => null);
}

/** Привязать строку к товару: колонки сопоставляются сами, цены сразу из базы. */
export function linkToProduct(group: Group, target: Item | Variation, product: CatalogProduct) {
  const link: CatalogLink = { ref: product.id, sizes: matchSizes(group.columns, product.sizes) };
  target.link = link;
  target.prices = linkPrices(product, link, Math.max(1, group.columns.length), target.prices);
}

/** Привязать вариацию к виду молока товара основы; если основа уже из базы — цены сразу «основа + доплата». */
export function linkToMilk(target: Variation, milk: CatalogMilk, item?: Item) {
  target.link = { milkId: milk.id };
  if (item?.link) target.prices = item.prices.map((p) => (p == null ? null : p + milk.surcharge));
}

/**
 * Связать с базой то, что совпадает по названию (без регистра и «ё»): позиции — с товарами
 * (в добавках — с товарами-добавками), вариации связанных позиций — с видами молока их товара
 * («Овсяное») или с отдельным товаром («Раф халва»). Уже связанное не трогает. Возвращает, сколько связано.
 */
export function linkByNames(groups: Group[], catalog: Catalog): number {
  const byName = (name: string, addon?: boolean) =>
    catalog.products.find((p) => (addon === undefined || p.addon === addon) && nameKey(p.name) === nameKey(name));
  let n = 0;
  for (const g of groups) {
    const addons = g.style === "addons";
    for (const it of g.items) {
      if (!it.link && it.name.trim()) {
        const p = byName(it.name, addons) ?? (addons ? undefined : byName(it.name, false));
        if (p) {
          linkToProduct(g, it, p);
          n++;
        }
      }
      if (addons || !it.link) continue;
      const product = catalog.products.find((p) => p.id === it.link!.ref);
      for (const v of it.variations) {
        if (v.link || !v.name.trim()) continue;
        const milk = product?.milk.find((m) => nameKey(m.label) === nameKey(v.name));
        if (milk) {
          linkToMilk(v, milk, it);
          n++;
          continue;
        }
        const own = byName(variationTitle(it.name, v.name), false);
        if (own) {
          linkToProduct(g, v, own);
          n++;
        }
      }
    }
  }
  return n;
}

/** Отвязать от базы: строка становится ручной с текущими ценами. */
export function unlink(target: Item | Variation) {
  delete target.link;
}

function linkPrices(product: CatalogProduct, link: CatalogLink, cols: number, fallback: Price[]): Price[] {
  return Array.from({ length: cols }, (_, i) => {
    const key = link.sizes[i];
    if (key == null) return null;
    return product.sizes.find((s) => s.key === key)?.price ?? fallback[i] ?? null;
  });
}

/** Цена строки в базе по колонкам; missing — товара или какого-то из размеров нет. */
function productPrices(cat: Map<string, CatalogProduct>, link: CatalogLink, cols: number): { prices: (Price | undefined)[]; missing: boolean } {
  const product = cat.get(link.ref);
  if (!product) return { prices: Array(cols).fill(undefined), missing: true };
  let missing = false;
  const prices = Array.from({ length: cols }, (_, i) => {
    const key = link.sizes[i];
    if (key == null) return null;
    const size = product.sizes.find((s) => s.key === key);
    if (!size) {
      missing = true;
      return undefined; // размер пропал — оставить последнюю цену
    }
    return size.price;
  });
  return { prices, missing };
}

export interface CatalogSync {
  changed: number; // сколько цен изменилось
  log: string[]; // строки для журнала изменений
}

/**
 * Сверить цены связанных строк с базой и принять изменения. Пропавший товар или размер не обнуляет
 * цену — строка помечается link.missing, печатается последняя известная цена.
 */
export function syncCatalogPrices(ws: Workspace, catalog: Catalog, at = new Date().toISOString()): CatalogSync {
  const cat = new Map(catalog.products.map((p) => [p.id, p]));
  const milk = new Map(catalog.products.flatMap((p) => p.milk.map((m) => [m.id, m] as const)));
  const updates: PriceUpdate[] = [];
  const log: string[] = [];
  const push = (g: Group, item: Item, v: Variation | undefined, column: number, price: Price) => {
    const target = v ?? item;
    if (target.prices[column] === price) return;
    updates.push({ itemId: item.id, variationId: v?.id, column, price });
    const name = v ? `${item.name} ${v.name.toLocaleLowerCase("ru-RU")}` : item.name;
    const col = g.columns.length > 1 ? ` ${g.columns[column]}` : "";
    log.push(`Цена из базы: ${name.trim()}${col}: ${fmt(target.prices[column])} → ${fmt(price)}`);
  };

  for (const g of ws.groups) {
    const cols = Math.max(1, g.columns.length);
    for (const item of g.items) {
      let base: (Price | undefined)[] | null = null;
      if (item.link) {
        const r = productPrices(cat, item.link, cols);
        setMissing(item.link, r.missing);
        base = r.prices;
        r.prices.forEach((p, i) => p !== undefined && push(g, item, undefined, i, p));
      }
      for (const v of item.variations) {
        if (!v.link || v.sharePrice) continue; // присоединённая вариация печатается с ценой блока
        if (isMilkLink(v.link)) {
          const m = milk.get(v.link.milkId);
          setMissing(v.link, !m || !item.link);
          if (!m || !base) continue;
          base.forEach((p, i) => p !== undefined && push(g, item, v, i, p == null ? null : p + m.surcharge));
        } else {
          const r = productPrices(cat, v.link, cols);
          setMissing(v.link, r.missing);
          r.prices.forEach((p, i) => p !== undefined && push(g, item, v, i, p));
        }
      }
    }
  }
  const changed = applyPriceUpdates(ws, updates, at);
  return { changed, log: changed ? log : [] };
}

function setMissing(link: CatalogLink | MilkLink, missing: boolean) {
  if (missing) link.missing = true;
  else delete link.missing;
}

const fmt = (p: Price | undefined) => (p == null ? "—" : String(p));

/** Цена строки берётся из базы — поле цены только для чтения. */
export const priceFromCatalog = (target: Item | Variation): boolean => !!target.link;
