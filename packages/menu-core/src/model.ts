// Модель конструктора. Всё состояние — один документ Workspace, который хранится целиком.

export type Price = number | null; // null — у позиции нет такого объёма

/**
 * Пометка о цене, пришедшей из базы. activeFrom — с какого дня цена действует: к этому дню новые
 * ценники и меню должны стоять в кафе. Без даты цена уже действует — перепечатать нужно срочно.
 */
export interface PriceNotice {
  at: string; // когда пришло обновление
  activeFrom?: string; // yyyy-mm-dd
}

export interface Line {
  name: string;
  allergen?: boolean; // метка «А» в рамке
  note?: string; // мелкая надпись сверху справа, как «сверху» у «Корица, какао»
}

/**
 * Вариация — отдельная позиция под напитком («Овсяное» под «Капучино», «Раф халва» под «Раф»)
 * со своими ценами. С флагом sharePrice она печатается в одном блоке с вариацией выше
 * и берёт её цену — как виды молока в макете.
 */
export interface Variation extends Line {
  id: string;
  prices: Price[];
  sharePrice?: boolean; // общая цена с вариацией выше
  priceNotice?: PriceNotice;
  /** Цена из базы sixth-cup: свой товар или вид молока (цена объёма основы + доплата). См. catalog.ts. */
  link?: CatalogLink | MilkLink;
}

/**
 * Привязка строки к товару каталога sixth-cup. ref — «g:<id группы>» или «p:<id товара>»;
 * sizes — какой размер товара стоит в какой колонке группы (ключ размера из каталога, null — колонка пустая).
 * missing — товара или размера в базе больше нет: печатается последняя известная цена.
 */
export interface CatalogLink {
  ref: string;
  sizes: (string | null)[];
  missing?: boolean;
}

/** Вариация — вид молока товара основы: цена каждой колонки = цена основы + доплата за молоко. */
export interface MilkLink {
  milkId: number;
  missing?: boolean;
}

/** Блоки вариаций: первая в блоке задаёт цену, следующие с sharePrice к ней присоединяются. */
export function variationBlocks(vars: Variation[]): Variation[][] {
  const out: Variation[][] = [];
  for (const v of vars) {
    const last = out[out.length - 1];
    if (last && v.sharePrice) last.push(v);
    else out.push([v]);
  }
  return out;
}

/** Цена, которая печатается у вариации: своя или общая цена её блока. */
export function variationPrices(vars: Variation[], id: string): Price[] | undefined {
  return variationBlocks(vars).find((b) => b.some((v) => v.id === id))?.[0].prices;
}

/** Держит сохранённые цены присоединённых вариаций равными цене блока. */
export function syncSharedPrices(item: Item) {
  for (const b of variationBlocks(item.variations)) for (const v of b.slice(1)) v.prices = [...b[0].prices];
}

/** Все кафе называются одинаково; отличает их адрес. */
export const CAFE_NAME = "Кафе 6.7";
export const DEFAULT_CAFE_ADDRESS = ""; // адрес ещё не указан
/** Обозначение кафе одной строкой: адрес, а пока его нет — общее название. */
export function cafeLabel(c?: { address: string } | null): string {
  return c?.address.trim() || CAFE_NAME;
}

export function migrateWorkspace(ws: Workspace): Workspace {
  type Legacy = { id: string; lines?: Line[]; prices: Price[] } & Partial<Line>;
  for (const g of ws.groups)
    for (const it of g.items)
      it.variations = (it.variations as Legacy[]).flatMap((v): Variation[] => {
        if (!Array.isArray(v.lines)) return [v as Variation];
        const lines = v.lines.length ? v.lines : [{ name: "" }];
        return lines.map((l, i) => ({ id: i === 0 ? v.id : `${v.id}-${i}`, ...l, prices: [...v.prices], ...(i > 0 ? { sharePrice: true } : {}) }));
      });
  // добавки раньше записывали одной строкой через запятую («Сироп ваниль, карамель, …») — это отдельные
  // позиции с общей ценой: делим один раз, на листе они по-прежнему печатаются вместе
  if ((ws.schema ?? 0) < 1) {
    for (const g of ws.groups) {
      if (g.style !== "addons") continue;
      g.items = g.items.flatMap((it): Item[] => {
        delete (it as Item & { separate?: boolean }).separate;
        const parts = it.name.split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length < 2) return [it];
        return parts.map((name, k) => ({
          id: k === 0 ? it.id : `${it.id}-${k}`,
          name: k === 0 ? name : ucFirst(name),
          prices: [...it.prices],
          variations: [],
          ...(k === 0 && it.allergen ? { allergen: true } : {}),
          ...(k === parts.length - 1 && it.note ? { note: it.note } : {}),
        }));
      });
    }
    ws.schema = 1;
  }
  // раньше вместо адреса стояло название «Кафе 6.7» — теперь название общее, а адрес отдельно
  if ((ws.schema ?? 0) < 2) {
    for (const c of ws.cafes ?? []) if (c.address.trim() === CAFE_NAME) c.address = "";
    ws.schema = 2;
  }
  // до появления нескольких кафе всё принадлежало одному
  if (!Array.isArray(ws.cafes) || ws.cafes.length === 0) ws.cafes = [{ id: "c-main", address: DEFAULT_CAFE_ADDRESS }];
  for (const d of ws.documents) if (!d.cafeId || !ws.cafes.some((c) => c.id === d.cafeId)) d.cafeId = ws.cafes[0].id;
  return ws;
}

export interface Item {
  id: string;
  name: string;
  allergen?: boolean;
  note?: string;
  prices: Price[]; // по колонкам группы
  variations: Variation[];
  /**
   * Только для добавок. Добавки с одной ценой, стоящие подряд, печатаются группой: одна цена и перечень
   * через запятую («+40 Сироп ваниль, карамель, лесной орех…»). split — не объединять с добавкой выше,
   * хотя цена та же.
   */
  split?: boolean;
  priceNotice?: PriceNotice;
  /** Цена из базы sixth-cup — руками не правится. См. catalog.ts. */
  link?: CatalogLink;
}

/** Обновление цены из базы: какая позиция (или её вариация), какая колонка объёма, новая цена и дата, с которой она действует. */
export interface PriceUpdate {
  itemId: string;
  variationId?: string;
  column: number;
  price: Price;
  activeFrom?: string;
}

/**
 * Принять цены из базы. Цена сразу встаёт в меню — документы с ней попадают в «ожидают печати»,
 * а пометка говорит, срочно это или к дате. Возвращает, сколько цен действительно изменилось.
 */
export function applyPriceUpdates(ws: Workspace, updates: PriceUpdate[], at = new Date().toISOString()): number {
  let changed = 0;
  for (const u of updates) {
    for (const g of ws.groups) {
      const item = g.items.find((i) => i.id === u.itemId);
      if (!item) continue;
      const target = u.variationId ? item.variations.find((v) => v.id === u.variationId) : item;
      if (!target || u.column < 0 || u.column >= Math.max(1, g.columns.length)) continue;
      if (target.prices[u.column] === u.price) continue;
      target.prices[u.column] = u.price;
      target.priceNotice = { at, ...(u.activeFrom ? { activeFrom: u.activeFrom } : {}) };
      syncSharedPrices(item);
      changed++;
    }
  }
  return changed;
}

/** Добавка стоит в одной группе с добавкой выше: цена та же и группу не разбивали вручную. */
export function addonJoins(items: Item[], i: number): boolean {
  if (i <= 0 || i >= items.length || items[i].split) return false;
  const a = items[i - 1].prices[0];
  return a != null && a === items[i].prices[0];
}

/** Добавки по группам с общей ценой, в порядке таблицы. */
export function addonGroups(items: Item[]): Item[][] {
  const out: Item[][] = [];
  items.forEach((it, i) => {
    if (addonJoins(items, i)) out[out.length - 1].push(it);
    else out.push([it]);
  });
  return out;
}

const lcFirst = (s: string) => s.charAt(0).toLocaleLowerCase("ru-RU") + s.slice(1);
const ucFirst = (s: string) => s.charAt(0).toLocaleUpperCase("ru-RU") + s.slice(1);

/** Как группа добавок печатается на листе: одна строка, названия через запятую, одна цена. */
export function addonLine(group: Item[]): Line & { prices: Price[] } {
  return {
    name: [group[0].name.trim(), ...group.slice(1).map((it) => lcFirst(it.name.trim()))].filter(Boolean).join(", "),
    note: [...group].reverse().find((it) => it.note)?.note,
    allergen: group.some((it) => it.allergen) || undefined,
    prices: group[0].prices,
  };
}

/** Объединить выбранные добавки в группу: встают подряд за первой и получают её цену. */
export function groupAddons(g: Group, ids: string[]) {
  const picked = g.items.filter((it) => ids.includes(it.id));
  const price = picked.find((it) => it.prices[0] != null)?.prices[0];
  if (picked.length < 2 || price == null) return;
  const [head, ...rest] = picked;
  g.items = g.items.filter((it) => !rest.includes(it));
  g.items.splice(g.items.indexOf(head) + 1, 0, ...rest);
  head.prices[0] = price;
  for (const it of rest) {
    it.prices[0] = price;
    delete it.split;
  }
}

/** Вынуть выбранные добавки из групп: каждая печатается своей строкой, цена остаётся. */
export function splitAddons(g: Group, ids: string[]) {
  const joins = g.items.map((_, i) => addonJoins(g.items, i));
  g.items.forEach((it, i) => {
    const mine = ids.includes(it.id);
    const afterMine = i > 0 && ids.includes(g.items[i - 1].id);
    if (joins[i] && (mine || afterMine)) it.split = true;
  });
}

/**
 * hero    — крупный заголовок листа («Кофе», «Не кофе»), таблица на всю ширину
 * section — синий подзаголовок («Холодные»), таблица на всю ширину
 * compact — узкий список по центру с одной ценой («К кофе»)
 * addons  — синие добавки «+40 Сироп …» внизу листа
 */
export type GroupStyle = "hero" | "section" | "compact" | "addons";

export interface Group {
  id: string;
  title: string;
  style: GroupStyle;
  columns: string[]; // подписи колонок: "0.25", "0.35", "0.40" или "1 шт"
  items: Item[];
}

export interface Size {
  w: number; // мм, обрезной формат
  h: number;
}

/** Кафе — точка со своим меню и ценниками. Различаем по адресу. */
export interface Cafe {
  id: string;
  address: string; // «ул. Ленина, 12»
}

export interface MenuDoc {
  id: string;
  kind: "menu";
  cafeId: string;
  name: string;
  size: Size;
  copyOf?: string;
  groupIds: string[]; // какие группы на листе и в каком порядке
  template?: string; // из какого шаблона создано меню (lib/templates.ts)
  lastSent?: SentMark;
  createdAt: string;
}

export interface TagRef {
  groupId: string;
  itemId: string;
  variationId?: string;
  column: number; // какая цена (объём) идёт на ценник
}

/**
 * Дизайн ценника. Дизайн без sizes подстраивается под любой размер; дизайн с sizes нарисован под
 * конкретные размеры и другим не бывает. Новый дизайн — новая запись здесь и своя вёрстка в lib/layout/tag.ts.
 */
export const TAG_DESIGNS = {
  classic: { label: "Основной", sizes: undefined as Size[] | undefined },
} satisfies Record<string, { label: string; sizes?: Size[] }>;
export type TagDesign = keyof typeof TAG_DESIGNS;

/** Шаблон ценника: размер вместе с дизайном. В окне ценника выбирают именно шаблон. */
export interface TagTemplate {
  id: string;
  size: Size;
  design: TagDesign;
}

const BUILTIN_TAG_SIZES: Size[] = [
  { w: 90, h: 45 },
  { w: 70, h: 35 },
  { w: 120, h: 60 },
  { w: 58, h: 40 },
];

/** Все шаблоны ценников: встроенные размеры основного дизайна, размеры, под которые нарисованы другие дизайны, и добавленные вручную. */
export function tagTemplates(ws: Workspace): TagTemplate[] {
  const out: TagTemplate[] = BUILTIN_TAG_SIZES.map((size) => ({ id: `classic-${size.w}x${size.h}`, size, design: "classic" }));
  for (const [design, d] of Object.entries(TAG_DESIGNS) as [TagDesign, { sizes?: Size[] }][])
    for (const size of d.sizes ?? []) out.push({ id: `${design}-${size.w}x${size.h}`, size, design });
  for (const t of ws.tagTemplates ?? []) if (!out.some((x) => sameTemplate(x, t))) out.push(t);
  return out;
}

export function sameTemplate(a: { size: Size; design?: TagDesign }, b: { size: Size; design?: TagDesign }): boolean {
  return a.size.w === b.size.w && a.size.h === b.size.h && (a.design ?? "classic") === (b.design ?? "classic");
}

export interface TagDoc {
  id: string;
  kind: "tag";
  cafeId: string;
  name: string;
  size: Size;
  design?: TagDesign; // не задан — основной
  copyOf?: string;
  ref?: TagRef; // ценник привязан к позиции меню — цена подтягивается сама
  customName?: string; // своё название вместо названия позиции
  customPrice?: Price; // своя цена, если нет привязки
  showInfo: boolean; // блок «Изготовлено … в …» справа внизу
  date?: string; // ISO yyyy-mm-dd; пусто — без даты
  maker?: string; // пусто — производитель по умолчанию из настроек
  lastSent?: SentMark;
  createdAt: string;
}

export type Doc = MenuDoc | TagDoc;

export interface SentMark {
  hash: string;
  at: string;
  sendId: string;
  /** Что ушло в печать (renderInput на момент отправки) — чтобы показать «Было» рядом с «Будет». */
  snap?: unknown;
}

/** Получатель макетов — обычно типография. Кафе в разных городах печатаются в разных типографиях. */
export interface Contact {
  id: string;
  name: string;
  email: string;
  cafeIds?: string[]; // для каких кафе печатает; не задано — для всех
}

export interface SendRecord {
  id: string;
  at: string;
  to: string;
  docIds: string[];
  files: string[];
  bytes: number;
  changes: number;
  batch?: string; // одна отправка нескольким получателям — общий номер
  cafeIds?: string[]; // кафе, чьи документы были в письме
}

/** Печатает ли получатель для этого кафе. */
export function contactServes(c: Contact, cafeId: string): boolean {
  return !c.cafeIds || c.cafeIds.includes(cafeId);
}

export interface ChangeEntry {
  at: string;
  text: string;
}

export interface Brand {
  accent: string; // синий из макета
  priceNote: string; // «Цены указаны в рублях РФ, с учетом НДС»
  allergenNote: string; // пояснение метки «А»; пусто — не печатать
  maker: string; // производитель по умолчанию для ценников
}

export interface Workspace {
  rev: number;
  schema?: number; // версия структуры данных, см. migrateWorkspace
  brand: Brand;
  cafes: Cafe[];
  groups: Group[];
  documents: Doc[];
  contacts: Contact[];
  sends: SendRecord[];
  changeLog: ChangeEntry[];
  tagTemplates?: TagTemplate[]; // шаблоны ценников, добавленные вручную (свои размеры)
}

export const SIZE_PRESETS: { label: string; size: Size; kind: Doc["kind"] | "any" }[] = [
  { label: "A5", size: { w: 148, h: 210 }, kind: "menu" },
  { label: "A4", size: { w: 210, h: 297 }, kind: "menu" },
  { label: "A3", size: { w: 297, h: 420 }, kind: "menu" },
  { label: "A2", size: { w: 420, h: 594 }, kind: "menu" },
  { label: "90×45", size: { w: 90, h: 45 }, kind: "tag" },
  { label: "70×35", size: { w: 70, h: 35 }, kind: "tag" },
  { label: "120×60", size: { w: 120, h: 60 }, kind: "tag" },
  { label: "58×40", size: { w: 58, h: 40 }, kind: "tag" },
];

export function sizeLabel(s: Size): string {
  const p = SIZE_PRESETS.find((x) => x.size.w === s.w && x.size.h === s.h);
  return p ? p.label : `${fmtMm(s.w)}×${fmtMm(s.h)}`;
}

function fmtMm(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

export function uid(prefix = ""): string {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return prefix + rnd.replace(/-/g, "").slice(0, 10);
}

export function findItem(ws: Workspace, groupId: string, itemId: string) {
  let group = ws.groups.find((g) => g.id === groupId);
  let item = group?.items.find((i) => i.id === itemId);
  if (!item) {
    // позицию могли перетащить в другую группу — ценник идёт за ней
    group = ws.groups.find((g) => g.items.some((i) => i.id === itemId));
    item = group?.items.find((i) => i.id === itemId);
  }
  return { group, item };
}

/** Листы меню кафе без копий других размеров (копии показываются у оригинала). */
export function cafeMenus(ws: Workspace, cafeId: string): MenuDoc[] {
  return ws.documents.filter((d): d is MenuDoc => d.kind === "menu" && d.cafeId === cafeId && !d.copyOf);
}

/** Лист и его копии под другие размеры — у них общий состав групп. */
export function menuFamily(ws: Workspace, doc: MenuDoc): MenuDoc[] {
  const root = doc.copyOf ?? doc.id;
  return ws.documents.filter((d): d is MenuDoc => d.kind === "menu" && (d.id === root || d.copyOf === root));
}

/** Группы, которые стоят на листах меню кафе, в порядке листов. */
export function cafeGroups(ws: Workspace, cafeId: string): Group[] {
  const ids = [...new Set(cafeMenus(ws, cafeId).flatMap((d) => d.groupIds))];
  return ids.map((id) => ws.groups.find((g) => g.id === id)).filter((g): g is Group => !!g);
}

/**
 * Полная копия листа: новые группы, позиции и вариации со своими id — правки копии
 * не трогают оригинал. Возвращает id нового листа.
 */
export function deepCopyMenu(ws: Workspace, doc: MenuDoc, cafeId: string, name: string, ids = new Map<string, string>()): string {
  const id = uid("d");
  const fresh = (old: string, prefix: string) => {
    const n = uid(prefix);
    ids.set(old, n);
    return n;
  };
  const groupIds = doc.groupIds.map((gid) => {
    if (ids.has(gid)) return ids.get(gid)!; // группа уже скопирована с соседним листом
    const g = ws.groups.find((x) => x.id === gid);
    if (!g) return gid;
    const copy: Group = structuredClone(g);
    copy.id = fresh(g.id, "g");
    for (const it of copy.items) {
      it.id = fresh(it.id, "i");
      for (const v of it.variations) v.id = fresh(v.id, "v");
    }
    ws.groups.push(copy);
    return copy.id;
  });
  ws.documents.push({ id, kind: "menu", cafeId, name, size: { ...doc.size }, groupIds, createdAt: new Date().toISOString() });
  return id;
}

/** «Капучино» + «Овсяное» → «Капучино овсяное»; «Раф» + «Раф халва» → «Раф халва». */
export function variationTitle(itemName: string, varName: string): string {
  const v = varName.trim();
  if (!v) return itemName;
  if (v.toLocaleLowerCase("ru-RU").startsWith(itemName.trim().toLocaleLowerCase("ru-RU"))) return v;
  return `${itemName} ${v.toLocaleLowerCase("ru-RU")}`;
}

/** Название и цена ценника с учётом привязки к меню. */
export function resolveTag(ws: Workspace, doc: TagDoc): { name: string; price: Price; volume?: string; broken: boolean } {
  if (doc.ref) {
    const { group, item } = findItem(ws, doc.ref.groupId, doc.ref.itemId);
    if (group && item) {
      const variation = doc.ref.variationId ? item.variations.find((v) => v.id === doc.ref!.variationId) : undefined;
      const prices = variation ? (variationPrices(item.variations, variation.id) ?? variation.prices) : item.prices;
      const baseName = variation ? variationTitle(item.name, variation.name) : item.name;
      const col = Math.min(doc.ref.column, group.columns.length - 1);
      const label = group.columns[col] ?? "";
      const volume = /шт/i.test(label) || group.columns.length < 2 ? undefined : label;
      return { name: doc.customName?.trim() || baseName, price: prices[col] ?? null, volume, broken: false };
    }
    return { name: doc.customName?.trim() || "Позиция удалена из меню", price: doc.customPrice ?? null, broken: true };
  }
  return { name: doc.customName?.trim() || "Без названия", price: doc.customPrice ?? null, broken: false };
}

export function cloneWs<T>(x: T): T {
  return structuredClone(x);
}

/** Новое кафе с копией меню и ценников другого кафе (или пустое). */
export function addCafe(ws: Workspace, address: string, copyFrom?: string): string {
  const cafeId = uid("c");
  ws.cafes.push({ id: cafeId, address });
  if (!copyFrom) return cafeId;
  const ids = new Map<string, string>();
  const src = ws.documents.filter((d) => d.cafeId === copyFrom);
  for (const d of src.filter((x): x is MenuDoc => x.kind === "menu" && !x.copyOf)) {
    const nid = deepCopyMenu(ws, d, cafeId, d.name, ids);
    ids.set(d.id, nid);
  }
  const now = new Date().toISOString();
  for (const d of src) {
    if (d.kind === "menu" && !d.copyOf) continue;
    const copy = structuredClone(d) as Doc;
    copy.id = uid("d");
    copy.cafeId = cafeId;
    copy.lastSent = undefined;
    copy.createdAt = now;
    if (copy.copyOf) copy.copyOf = ids.get(copy.copyOf) ?? undefined;
    if (copy.kind === "menu") copy.groupIds = copy.groupIds.map((g) => ids.get(g) ?? g);
    if (copy.kind === "tag" && copy.ref)
      copy.ref = { ...copy.ref, groupId: ids.get(copy.ref.groupId) ?? copy.ref.groupId, itemId: ids.get(copy.ref.itemId) ?? copy.ref.itemId, variationId: copy.ref.variationId && (ids.get(copy.ref.variationId) ?? copy.ref.variationId) };
    ids.set(d.id, copy.id);
    ws.documents.push(copy);
  }
  return cafeId;
}

/** Удалить лист меню (с копиями других размеров) и группы, которые больше нигде не стоят. */
export function removeMenu(ws: Workspace, doc: MenuDoc) {
  const family = doc.copyOf ? [doc] : menuFamily(ws, doc);
  const gone = new Set(family.map((d) => d.id));
  ws.documents = ws.documents.filter((d) => !gone.has(d.id));
  if (doc.copyOf) return;
  const used = new Set(ws.documents.flatMap((d) => (d.kind === "menu" ? d.groupIds : [])));
  ws.groups = ws.groups.filter((g) => used.has(g.id) || !doc.groupIds.includes(g.id));
}

/**
 * Убрать один формат меню — лист одного размера, — оставив остальные. Если убирают основной лист,
 * основным становится следующий формат: меню остаётся с тем же названием и таблицами.
 * Последний формат так не убрать — это уже удаление меню (removeMenu). Возвращает лист, который остался.
 */
export function removeFormat(ws: Workspace, doc: MenuDoc): MenuDoc | null {
  const family = menuFamily(ws, doc);
  if (family.length < 2) return null;
  const rootId = doc.copyOf ?? doc.id;
  const rest = family.filter((d) => d.id !== doc.id);
  const root = doc.id === rootId ? rest[0] : rest.find((d) => d.id === rootId)!;
  for (const d of rest) d.copyOf = d.id === root.id ? undefined : root.id;
  ws.documents = ws.documents.filter((d) => d.id !== doc.id);
  return root;
}
