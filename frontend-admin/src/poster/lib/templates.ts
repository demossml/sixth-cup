import { linkByNames, syncCatalogPrices, type Catalog } from "./catalog";
import { uid, type Group, type MenuDoc, type Size, type Workspace } from "./model";
import { seedWorkspace } from "./seed";

// Шаблоны меню: с чего начать новый лист. У шаблона нет названия — только состав таблиц и формат.

export interface MenuTemplate {
  id: string;
  size: Size;
  groups: Group[];
}

const A = { A5: { w: 148, h: 210 }, A4: { w: 210, h: 297 }, A3: { w: 297, h: 420 }, A2: { w: 420, h: 594 } };
const blank = (): Group[] => [{ id: "tpl-blank", title: "Меню", style: "hero", columns: ["0.20", "0.30", "0.40"], items: [] }];

/**
 * Линейка размеров в шаблонах зашита старой («0.25 / 0.35 / 0.40»). В каталоге теперь
 * 200 / 300 / 400, поэтому подписи приводим к нему, иначе связка с базой не находит цены.
 */
function currentSizeLabels(groups: Group[]) {
  for (const g of groups) {
    g.columns = g.columns.map((c) => {
      const t = String(c).trim();
      if (t === "0.25") return "0.20";
      if (t === "0.35") return "0.30";
      return c;
    });
  }
}

let cache: MenuTemplate[] | null = null;
export function menuTemplates(): MenuTemplate[] {
  if (cache) return cache;
  const seed = seedWorkspace();
  const of = (id: string) => (seed.documents.find((d) => d.id === id) as MenuDoc).groupIds.map((g) => seed.groups.find((x) => x.id === g)!);
  cache = [
    { id: "table-addons", size: A.A4, groups: of("d-menu-coffee") }, // таблица с объёмами и добавки
    { id: "three-tables", size: A.A4, groups: of("d-menu-notcoffee") }, // две таблицы и узкий список
    { id: "blank-a5", size: A.A5, groups: blank() },
    { id: "blank-a4", size: A.A4, groups: blank() },
    { id: "blank-a3", size: A.A3, groups: blank() },
    { id: "blank-a2", size: A.A2, groups: blank() },
  ];
  return cache;
}

/** Лист шаблона для превью: временное меню с его таблицами. */
export function templatePreview(ws: Workspace, t: MenuTemplate, catalog?: Catalog | null): { ws: Workspace; doc: MenuDoc } {
  const groups = structuredClone(t.groups);
  currentSizeLabels(groups);
  const preview: Workspace = { ...ws, groups };
  if (catalog) {
    linkByNames(groups, catalog);
    syncCatalogPrices(preview, catalog);
  }
  return {
    ws: preview,
    doc: { id: `tpl-${t.id}`, kind: "menu", cafeId: "", name: "Шаблон", size: t.size, groupIds: groups.map((g) => g.id), createdAt: "" },
  };
}

/** Новое меню из шаблона: таблицы копируются со своими id, так что правки шаблон не трогают. Возвращает id листа. */
export function createFromTemplate(ws: Workspace, t: MenuTemplate, cafeId: string, catalog?: Catalog | null): string {
  const id = uid("d");
  const groups = structuredClone(t.groups);
  currentSizeLabels(groups);
  const groupIds = groups.map((g) => {
    const copy = g;
    copy.id = uid("g");
    for (const it of copy.items) {
      it.id = uid("i");
      for (const v of it.variations) v.id = uid("v");
    }
    ws.groups.push(copy);
    return copy.id;
  });
  ws.documents.push({ id, kind: "menu", cafeId, name: "Новое меню", size: { ...t.size }, groupIds, template: t.id, createdAt: new Date().toISOString() });
  // Новое меню сразу считается по базе: иначе шаблон приносит старые цены из seed.
  if (catalog) {
    linkByNames(groups, catalog);
    syncCatalogPrices(ws, catalog);
  }
  return id;
}
