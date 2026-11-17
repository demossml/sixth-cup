import { isChanged, renderInput } from "./fingerprint";
import { sizeLabel, type Doc, type Price, type Size, type Workspace } from "./model";

// Что изменилось в документе с прошлой отправки: отдельно цены (было → стало), отдельно всё остальное.
// Сравнивается копия отправленного (lastSent.snap) с тем, что уйдёт в печать сейчас.

export interface PriceChange {
  what: string; // «Капучино 0.25», «Цена»
  from: Price;
  to: Price;
}

export interface DocChanges {
  /** new — ещё не печатали; same — без изменений; unknown — изменён, но копии прошлой отправки нет; changed — есть разбор. */
  state: "new" | "same" | "unknown" | "changed";
  prices: PriceChange[];
  other: string[];
}

type MenuSnap = {
  v?: number;
  size: Size;
  brand: unknown;
  groups: { t: string; s: string; c: string[]; i: { n: string; a: boolean; o: string; p: Price[]; v: { l: [string, boolean, string][]; p: Price[] }[] }[] }[];
};
type TagSnap = { v?: number; size: Size; accent: string; name: string; price: Price; volume: string; info: { date: string; maker: string } | null; design?: string };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const list = (names: string[]) => (names.length > 3 ? `${names.slice(0, 3).join(", ")} и ещё ${names.length - 3}` : names.join(", "));

/** Строки листа: позиции и блоки вариаций с ценами по колонкам. */
function menuRows(snap: MenuSnap) {
  const rows = new Map<string, { label: string; prices: Price[]; cols: string[]; mark: string; item: boolean }>();
  for (const g of snap.groups)
    for (const it of g.i) {
      rows.set(`${g.t}›${it.n}`, { label: it.n, prices: it.p, cols: g.c, mark: `${it.a}|${it.o}`, item: true });
      for (const b of it.v) {
        const names = b.l.map((l) => l[0]).join(", ");
        rows.set(`${g.t}›${it.n}›${names}`, { label: `${it.n} · ${names.toLocaleLowerCase("ru-RU")}`, prices: b.p, cols: g.c, mark: b.l.map((l) => `${l[1]}|${l[2]}`).join(";"), item: false });
      }
    }
  return rows;
}

export function docChanges(ws: Workspace, doc: Doc): DocChanges {
  const out: DocChanges = { state: "changed", prices: [], other: [] };
  if (!doc.lastSent) return { ...out, state: "new" };
  if (!isChanged(ws, doc)) return { ...out, state: "same" };
  const was = doc.lastSent.snap;
  if (!was || typeof was !== "object") return { ...out, state: "unknown" };
  const now = renderInput(ws, doc);

  if (doc.kind === "tag") {
    const a = was as TagSnap;
    const b = now as TagSnap;
    if (a.price !== b.price) out.prices.push({ what: "Цена", from: a.price, to: b.price });
    if (a.name !== b.name) out.other.push("название");
    if (a.volume !== b.volume) out.other.push("объём");
    if (!same(a.size, b.size) || (a.design ?? "") !== (b.design ?? "")) out.other.push(`размер ${sizeLabel(a.size)} → ${sizeLabel(b.size)}`);
    if (!!a.info !== !!b.info) out.other.push("блок «Изготовлено»");
    else if (a.info && b.info) {
      if (a.info.date !== b.info.date) out.other.push("дата");
      if (a.info.maker !== b.info.maker) out.other.push("производитель");
    }
    if (a.accent !== b.accent) out.other.push("цвет");
  } else {
    const a = was as MenuSnap;
    const b = now as MenuSnap;
    const ra = menuRows(a);
    const rb = menuRows(b);
    let marks = false;
    for (const [key, n] of rb) {
      const o = ra.get(key);
      if (!o) continue;
      n.prices.forEach((p, i) => {
        if ((o.prices[i] ?? null) !== (p ?? null)) out.prices.push({ what: n.cols.length > 1 && n.cols[i] ? `${n.label} ${n.cols[i]}` : n.label, from: o.prices[i] ?? null, to: p ?? null });
      });
      if (o.mark !== n.mark) marks = true;
    }
    const added = [...rb].filter(([k, r]) => r.item && !ra.has(k)).map(([, r]) => r.label);
    const removed = [...ra].filter(([k, r]) => r.item && !rb.has(k)).map(([, r]) => r.label);
    if (added.length) out.other.push(`добавлено: ${list(added)}`);
    if (removed.length) out.other.push(`убрано: ${list(removed)}`);
    const common = (m: typeof ra, other: typeof ra) => [...m.keys()].filter((k) => other.has(k));
    if (!same(common(ra, rb), common(rb, ra))) out.other.push("порядок позиций");
    if (marks) out.other.push("пометки");
    if (!same(a.groups.map((g) => [g.t, g.s, g.c]), b.groups.map((g) => [g.t, g.s, g.c]))) out.other.push("таблицы и колонки");
    if (!same(a.size, b.size)) out.other.push(`формат ${sizeLabel(a.size)} → ${sizeLabel(b.size)}`);
    if (!same(a.brand, b.brand)) out.other.push("сноски");
  }
  if ((was as { v?: number }).v !== (now as { v?: number }).v) out.other.push("обновлена вёрстка");
  if (!out.prices.length && !out.other.length) out.other.push("мелкие правки");
  return out;
}

const show = (p: Price) => (p == null ? "—" : String(p));

/** Цены одной строкой: «Капучино 0.25: 190 → 200» или «Капучино 0.25: 190 → 200 и ещё 2». */
export function priceChangesText(c: DocChanges): string {
  if (!c.prices.length) return "";
  const f = c.prices[0];
  return `${f.what}: ${show(f.from)} → ${show(f.to)}${c.prices.length > 1 ? ` и ещё ${c.prices.length - 1}` : ""}`;
}

/** Все цены построчно — для подсказки. */
export function priceChangesFull(c: DocChanges): string {
  return c.prices.map((p) => `${p.what}: ${show(p.from)} → ${show(p.to)}`).join("\n");
}
