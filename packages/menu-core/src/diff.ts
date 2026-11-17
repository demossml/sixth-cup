import { cafeLabel, printedGroup, resolveTag, sizeLabel, variationBlocks, type Doc, type Group, type Item, type Price, type Variation, type Workspace } from "./model";

// Журнал: человеческое описание того, что изменилось между двумя версиями меню.

const q = (s: string) => `«${s}»`;
const p = (v: Price | undefined) => (v === null || v === undefined ? "—" : String(v));
const varName = (v: Variation) => v.name || "вариация";

function byId<T extends { id: string }>(list: T[]) {
  return new Map(list.map((x) => [x.id, x]));
}

function orderChanged(a: string[], b: string[]) {
  const common = a.filter((id) => b.includes(id));
  const commonB = b.filter((id) => a.includes(id));
  return common.join() !== commonB.join();
}

function priceDiff(label: string, cols: string[], before: Price[], after: Price[], out: string[]) {
  const n = Math.max(before.length, after.length, cols.length);
  for (let i = 0; i < n; i++) {
    if ((before[i] ?? null) !== (after[i] ?? null)) out.push(`${label} ${cols[i] ?? `колонка ${i + 1}`}: ${p(before[i])} → ${p(after[i])}`);
  }
}

function itemDiff(g: Group, a: Item, b: Item, out: string[]) {
  if (a.name !== b.name) out.push(`${q(a.name)} переименована в ${q(b.name)}`);
  if (!!a.allergen !== !!b.allergen) out.push(`${q(b.name)}: метка аллергена ${b.allergen ? "добавлена" : "снята"}`);
  if ((a.note ?? "") !== (b.note ?? "")) out.push(`${q(b.name)}: надпись сверху ${q(b.note ?? "")}`);
  priceDiff(b.name, g.columns, a.prices, b.prices, out);
  const av = byId(a.variations);
  const bv = byId(b.variations);
  for (const v of b.variations) {
    const old = av.get(v.id);
    if (!old) {
      out.push(`${q(b.name)}: добавлена вариация ${q(varName(v))}`);
      continue;
    }
    if (varName(old) !== varName(v)) out.push(`${q(b.name)}: вариация ${q(varName(old))} → ${q(varName(v))}`);
    if (!!old.allergen !== !!v.allergen) out.push(`${q(b.name)} · ${varName(v)}: метка аллергена ${v.allergen ? "добавлена" : "снята"}`);
    if (!!old.sharePrice !== !!v.sharePrice) out.push(`${q(b.name)} · ${varName(v)}: ${v.sharePrice ? "общая цена с вариацией выше" : "своя цена"}`);
    else if (!v.sharePrice) {
      const block = variationBlocks(b.variations).find((bl) => bl[0].id === v.id) ?? [v];
      priceDiff(`${b.name} · ${block.map(varName).join(", ")}`, g.columns, old.prices, v.prices, out);
    }
  }
  for (const v of a.variations) if (!bv.has(v.id)) out.push(`${q(b.name)}: удалена вариация ${q(varName(v))}`);
  if (orderChanged(a.variations.map((v) => v.id), b.variations.map((v) => v.id))) out.push(`${q(b.name)}: изменён порядок вариаций`);
}

function groupDiff(a0: Group, b0: Group, out: string[], moved: Set<string> = new Set()) {
  // пустые строки-заготовки — не изменения: «добавлена позиция» появится, когда в неё что-то введут
  const a = printedGroup(a0);
  const b = printedGroup(b0);
  if (a.title !== b.title) out.push(`Группа ${q(a.title)} переименована в ${q(b.title)}`);
  if (a.style !== b.style) out.push(`Группа ${q(b.title)}: изменён вид`);
  if (a.columns.join("|") !== b.columns.join("|")) out.push(`Группа ${q(b.title)}: объёмы ${a.columns.join(" / ")} → ${b.columns.join(" / ")}`);
  const ai = byId(a.items);
  const bi = byId(b.items);
  for (const it of b.items) {
    const old = ai.get(it.id);
    if (!old) out.push(moved.has(it.id) ? `${q(it.name)} перенесена в ${q(b.title)}` : `${q(b.title)}: добавлена позиция ${q(it.name)}`);
    else itemDiff(b, old, it, out);
  }
  for (const it of a.items) if (!bi.has(it.id) && !moved.has(it.id)) out.push(`${q(b.title)}: удалена позиция ${q(it.name)}`);
  if (orderChanged(a.items.map((i) => i.id), b.items.map((i) => i.id))) out.push(`${q(b.title)}: изменён порядок позиций`);
}

function docDiff(prev: Workspace, next: Workspace, a: Doc, b: Doc, out: string[]) {
  if (a.name !== b.name) out.push(`Документ ${q(a.name)} переименован в ${q(b.name)}`);
  if (a.size.w !== b.size.w || a.size.h !== b.size.h) out.push(`${q(b.name)}: размер ${sizeLabel(a.size)} → ${sizeLabel(b.size)}`);
  if (a.kind === "menu" && b.kind === "menu" && a.groupIds.join() !== b.groupIds.join()) {
    const same = a.groupIds.length === b.groupIds.length && a.groupIds.every((id) => b.groupIds.includes(id));
    out.push(`${q(b.name)}: ${same ? "изменён порядок групп" : "изменён состав групп"}`);
  }
  if (a.kind === "tag" && b.kind === "tag") {
    const ra = resolveTag(prev, a);
    const rb = resolveTag(next, b);
    if (JSON.stringify(a.ref) !== JSON.stringify(b.ref) || a.customName !== b.customName || a.customPrice !== b.customPrice) {
      if (ra.name !== rb.name || ra.price !== rb.price) out.push(`Ценник ${q(b.name)}: ${ra.name} ${p(ra.price)} → ${rb.name} ${p(rb.price)}`);
    }
    if (a.showInfo !== b.showInfo || a.date !== b.date || (a.maker ?? "") !== (b.maker ?? ""))
      out.push(`Ценник ${q(b.name)}: изменены дата или производитель`);
  }
}

export function diffWorkspace(prev: Workspace, next: Workspace): string[] {
  const out: string[] = [];
  const pc = byId(prev.cafes ?? []);
  for (const c of next.cafes ?? []) {
    const old = pc.get(c.id);
    if (!old) out.push(`Добавлено кафе ${q(cafeLabel(c))}`);
    else if (old.address !== c.address) out.push(`Адрес кафе: ${q(old.address || "не указан")} → ${q(c.address || "не указан")}`);
  }
  for (const c of prev.cafes ?? []) if (!(next.cafes ?? []).some((x) => x.id === c.id)) out.push(`Удалено кафе ${q(cafeLabel(c))}`);

  // позиция, сменившая группу, — перенос, а не удаление и добавление
  const home = (ws: Workspace) => new Map(ws.groups.flatMap((g) => g.items.map((i) => [i.id, g.id] as const)));
  const ph = home(prev);
  const nh = home(next);
  const moved = new Set([...nh].filter(([id, gid]) => ph.has(id) && ph.get(id) !== gid).map(([id]) => id));

  const ag = byId(prev.groups);
  const bg = byId(next.groups);
  for (const g of next.groups) {
    const old = ag.get(g.id);
    if (!old) out.push(`Добавлена группа ${q(g.title)}`);
    else groupDiff(old, g, out, moved);
  }
  for (const g of prev.groups) if (!bg.has(g.id)) out.push(`Удалена группа ${q(g.title)}`);
  if (orderChanged(prev.groups.map((g) => g.id), next.groups.map((g) => g.id))) out.push("Изменён порядок групп");

  const ad = byId(prev.documents);
  const bd = byId(next.documents);
  for (const d of next.documents) {
    const old = ad.get(d.id);
    if (!old) out.push(`Создан ${d.kind === "menu" ? "лист меню" : "ценник"} ${q(d.name)} ${sizeLabel(d.size)}`);
    else docDiff(prev, next, old, d, out);
  }
  for (const d of prev.documents) if (!bd.has(d.id)) out.push(`Удалён ${d.kind === "menu" ? "лист меню" : "ценник"} ${q(d.name)}`);

  const b0 = prev.brand;
  const b1 = next.brand;
  if (b0.priceNote !== b1.priceNote) out.push("Изменена пометка о ценах");
  if (b0.allergenNote !== b1.allergenNote) out.push("Изменено пояснение метки аллергена");
  if (b0.maker !== b1.maker) out.push(`Производитель по умолчанию: ${q(b1.maker)}`);
  if (b0.accent !== b1.accent) out.push("Изменён фирменный цвет");
  return out;
}
