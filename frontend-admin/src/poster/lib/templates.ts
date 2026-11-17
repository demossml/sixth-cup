import { uid, type Group, type MenuDoc, type Size, type Workspace } from "./model";
import { seedWorkspace } from "./seed";

// Шаблоны меню: с чего начать новый лист. У шаблона нет названия — только состав таблиц и формат.

export interface MenuTemplate {
  id: string;
  size: Size;
  groups: Group[];
}

const A = { A5: { w: 148, h: 210 }, A4: { w: 210, h: 297 }, A3: { w: 297, h: 420 }, A2: { w: 420, h: 594 } };
const blank = (): Group[] => [{ id: "tpl-blank", title: "Меню", style: "hero", columns: ["0.25", "0.35", "0.40"], items: [] }];

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
export function templatePreview(ws: Workspace, t: MenuTemplate): { ws: Workspace; doc: MenuDoc } {
  return {
    ws: { ...ws, groups: t.groups },
    doc: { id: `tpl-${t.id}`, kind: "menu", cafeId: "", name: "Шаблон", size: t.size, groupIds: t.groups.map((g) => g.id), createdAt: "" },
  };
}

/** Новое меню из шаблона: таблицы копируются со своими id, так что правки шаблон не трогают. Возвращает id листа. */
export function createFromTemplate(ws: Workspace, t: MenuTemplate, cafeId: string): string {
  const id = uid("d");
  const groupIds = t.groups.map((g) => {
    const copy: Group = structuredClone(g);
    copy.id = uid("g");
    for (const it of copy.items) {
      it.id = uid("i");
      for (const v of it.variations) v.id = uid("v");
    }
    ws.groups.push(copy);
    return copy.id;
  });
  ws.documents.push({ id, kind: "menu", cafeId, name: "Новое меню", size: { ...t.size }, groupIds, template: t.id, createdAt: new Date().toISOString() });
  return id;
}
