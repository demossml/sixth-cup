
import { createPortal, flushSync } from "react-dom";
import { useFloating } from "./keepOnScreen";
import { usePresence } from "./presence";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, pointerWithin, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS, getEventCoordinates } from "@dnd-kit/utilities";
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { isMilkLink, linkByNames, linkToMilk, linkToProduct, nameKey, priceOrigin, setManualColumn, unlink, type Catalog } from "@/lib/catalog";
import { updateCatalogPrices, useCatalog } from "@/lib/client/catalog";
import {
  addonJoins, groupAddons, menuFamily, moveVariation, moveVariationTo, nestItem, unnestVariation, removeVariations, shareVariations, splitAddons, splitVariations, syncSharedPrices, unshareVariation, uid, variationPrices,
  type CatalogLink, type Group, type GroupStyle, type Item, type MenuDoc, type MilkLink, type Price, type Variation, type Workspace,
} from "@/lib/model";
import { focusCell, gridKeyDown } from "./gridNav";
import { Select } from "./Select";
import { scrollParent, useSweep, type Sweep } from "./sweep";
import { PriceCell } from "./PriceCell";
import { TablePicker } from "./TablePicker";
import { Icon } from "./ui";
import { useWs } from "./WorkspaceProvider";

// Редактор листа меню: каждая группа — таблица. Строки перетаскиваются внутри таблицы и между
// таблицами, группы — между собой. Стрелки ходят по ячейкам, Alt+↑/↓ двигает строку.

// Два типа таблиц. Стандартная — напитки и еда: название слева, цены по колонкам объёма стакана;
// у неё три вида на листе. Добавочная — то, что добавляют к напиткам стандартной таблицы:
// на листе синим, цена «+40» слева от названия.
const KINDS: { label: string; styles: [GroupStyle, string][] }[] = [
  { label: "Стандартная таблица", styles: [["hero", "Таблица с крупным заголовком"], ["section", "Таблица с подзаголовком"], ["compact", "Узкий список по центру"]] },
  { label: "Добавочная таблица", styles: [["addons", "Добавки к напиткам"]] },
];
const MAX_COLUMNS = 5;

// номера колонок для навигации: общие для всех таблиц
const NAV = { pick: 0, name: 1, note: 1.5, allergen: 2, price: 10, more: 30 };

const g$ = (w: Workspace, id: string) => w.groups.find((g) => g.id === id)!;
const i$ = (w: Workspace, gid: string, iid: string) => g$(w, gid).items.find((i) => i.id === iid)!;
const addons_ = (g: Group) => g.style === "addons";

/** id строки, которую нужно сфокусировать после следующей отрисовки (новая позиция). */
let focusAfterRender: string | null = null;

/**
 * Граница зон над товаром: левее — «поставить выше / ниже» (перестановка, вынос в позицию), правее — «станет вариацией».
 * Правая зона — 70 % ширины строки; левая — остальные 30 %, но не уже 180 px (на узкой панели правая чуть меньше).
 */
const nestFrom = (r: { left: number; width: number }) => r.left + Math.max(180, r.width * 0.3);
/** Сортировка без сдвигов: строки стоят на местах. */
const stayPut = () => null;

type DragData = { type: "group" } | { type: "item"; groupId: string; draft?: boolean } | { type: "variation"; groupId: string; itemId: string } | { type: "body"; groupId: string };

const collision: CollisionDetection = (args) => {
  const a = args.active.data.current as DragData | undefined;
  const containers = args.droppableContainers.filter((c) => {
    const d = c.data.current as DragData | undefined;
    if (!a || !d) return false;
    if (a.type === "group") return d.type === "group";
    // вариация: внутри своего товара — перестановка; над другим товаром — к нему; в списке позиций — стать позицией
    if (a.type === "variation") return (d.type === "variation" && d.itemId === a.itemId) || d.type === "item" || d.type === "body";
    return d.type === "item" || d.type === "body";
  });
  const scoped = { ...args, droppableContainers: containers };
  if (a?.type === "group") {
    // таблицы разной высоты: цель — та, над которой указатель, а если он между таблицами — ближайшая по вертикали
    const hits = pointerWithin(scoped);
    if (hits.length) return hits;
    const y = args.pointerCoordinates?.y;
    if (y === undefined) return closestCenter(scoped);
    let best: { id: string | number; d: number } | null = null;
    for (const c of containers) {
      const r = args.droppableRects.get(c.id);
      if (!r) continue;
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (!best || d < best.d) best = { id: c.id, d };
    }
    return best ? [{ id: best.id }] : [];
  }
  if (a?.type === "variation") {
    const hits = pointerWithin(scoped);
    const type = (h: { id: string | number }) => (args.droppableContainers.find((c) => c.id === h.id)?.data.current as DragData)?.type;
    // товар целиком (с вариациями) — тоже цель; над строкой своей вариации важнее она
    const own = hits.filter((h) => type(h) === "variation");
    if (own.length) return own;
    const rows = hits.filter((h) => type(h) === "item");
    if (rows.length) return rows;
    if (hits.length) return hits;
  }
  if (a?.type === "item") {
    const hits = pointerWithin(scoped);
    const rows = hits.filter((h) => (args.droppableContainers.find((c) => c.id === h.id)?.data.current as DragData)?.type === "item");
    if (rows.length) return rows;
    if (hits.length) return hits;
  }
  return closestCenter(scoped);
};

/** Ярлык перетаскиваемого держится у указателя, а не у левого верхнего угла таблицы или строки. */
/**
 * Что едет за курсором: копия самой строки (позиции, вариации) или таблицы — приподнятая, с тенью.
 * Копия делается из DOM в момент захвата, поэтому выглядит ровно так, как строка на месте;
 * чтобы сетка колонок и цвета таблицы (синие добавки) не потерялись, строку оборачиваем в копию класса её таблицы.
 */
function liftOf(id: string, type: DragData["type"]): Lift | null {
  const el = document.querySelector<HTMLElement>(`[data-drag-id="${id}"]`);
  if (!el) return null;
  const clone = el.cloneNode(true) as HTMLElement;
  const clean = (n: HTMLElement) => {
    n.classList.remove("dragging", "drop-before", "drop-after", "drop-target");
    n.style.transform = "";
    n.style.transition = "";
  };
  clean(clone);
  clone.removeAttribute("data-drag-id");
  clone.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  clone.querySelectorAll<HTMLElement>(".dragging, .drop-before, .drop-after").forEach(clean);
  // значения полей: копируется атрибут, а не то, что сейчас набрано
  const src = el.querySelectorAll<HTMLInputElement>("input");
  clone.querySelectorAll<HTMLInputElement>("input").forEach((n, k) => {
    n.value = src[k]?.value ?? n.value;
    n.checked = src[k]?.checked ?? n.checked;
    n.tabIndex = -1;
  });
  const table = type === "group" ? null : el.closest<HTMLElement>(".gt");
  return {
    node: clone,
    width: el.getBoundingClientRect().width,
    tableClass: table ? [...table.classList].filter((c) => !["dragging", "drop-target", "drop-before", "drop-after"].includes(c)).join(" ") : "",
    // переменные таблицы: сетка колонок (--tpl) и число колонок цен (--cols) — без них вариации с общей ценой разваливаются
    vars: table
      ? Object.fromEntries([...[...table.style].filter((p) => p.startsWith("--")).map((p) => [p, table.style.getPropertyValue(p)]), ["--tpl", getComputedStyle(table).getPropertyValue("--tpl")]])
      : {},
  };
}

type Lift = { node: HTMLElement; width: number; tableClass: string; vars: Record<string, string> };

/** Приподнятая копия: появляется с коротким «подлётом» (масштаб и тень), DOM-копию вставляет как есть. */
function Lifted({ lift }: { lift: Lift }) {
  const body = (
    <div
      className="mt-lift-body"
      ref={(box) => {
        if (box && lift.node.parentNode !== box) box.replaceChildren(lift.node);
      }}
    />
  );
  return (
    <div className="mt-lift" aria-hidden="true" inert="" style={{ width: lift.width }}>
      {lift.tableClass ? (
        <div className={lift.tableClass} style={lift.vars as CSSProperties}>
          {body}
        </div>
      ) : (
        body
      )}
    </div>
  );
}

export function MenuTables({ doc }: { doc: MenuDoc }) {
  const { ws, update, offerUndo } = useWs();
  const groups = doc.groupIds.map((id) => ws.groups.find((g) => g.id === id)).filter((g): g is Group => !!g);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [active, setActive] = useState<{ id: string; data: DragData; lift: Lift | null } | null>(null);
  // nest — позицию отпустят правее, на сам товар: она станет его вариацией
  const [hint, setHint] = useState<{ id: string; after: boolean; groupId: string; nest?: boolean } | null>(null);
  // куда встанет перетаскиваемая таблица: линия перед этой таблицей или после неё
  const [groupHint, setGroupHint] = useState<{ id: string; after: boolean } | null>(null);

  const setGroupIds = (w: Workspace, fn: (ids: string[]) => string[]) => {
    const d = w.documents.find((x) => x.id === doc.id) as MenuDoc;
    const next = fn(d.groupIds);
    for (const m of menuFamily(w, d)) m.groupIds = [...next];
  };

  const onStart = (e: DragStartEvent) => {
    const data = e.active.data.current as DragData;
    setActive({ id: String(e.active.id), data, lift: liftOf(String(e.active.id), data.type) });
  };

  const onMove = (e: DragMoveEvent) => {
    const a = e.active.data.current as DragData;
    const o = e.over?.data.current as DragData | undefined;
    if (a.type === "group") {
      const c = e.activatorEvent && getEventCoordinates(e.activatorEvent);
      if (!e.over || !c || o?.type !== "group" || e.over.id === e.active.id) return setGroupHint(null);
      const after = c.y + e.delta.y > e.over.rect.top + e.over.rect.height / 2;
      // линия «на том же месте» не нужна: таблица и так там стоит
      const ids = groups.map((g) => g.id);
      const from = ids.indexOf(String(e.active.id));
      const to = ids.indexOf(String(e.over.id)) + (after ? 1 : 0);
      if (to === from || to === from + 1) return setGroupHint(null);
      if (groupHint?.id !== e.over.id || groupHint.after !== after) setGroupHint({ id: String(e.over.id), after });
      return;
    }
    if (a.type === "variation") {
      // над своими вариациями — обычная перестановка внутри товара, без подсказок
      if (!o || !e.over || o.type === "variation") return setHint(null);
      const p = e.activatorEvent && getEventCoordinates(e.activatorEvent);
      if (o.type === "body" || (o.type === "item" && o.draft)) return setHint({ id: "", after: true, groupId: o.groupId });
      if (o.type !== "item" || !p) return setHint(null);
      const tg = groups.find((g) => g.id === o.groupId);
      const right = p.x + e.delta.x > nestFrom(e.over.rect);
      if (right) {
        // правее — к другому товару вариацией; на свой товар правее — ничего
        if (e.over.id === a.itemId || !tg || tg.style === "addons") return setHint(null);
        if (!hint?.nest || hint.id !== e.over.id) setHint({ id: String(e.over.id), after: false, groupId: o.groupId, nest: true });
        return;
      }
      // левее — встанет отдельной позицией перед товаром или после него
      const after = p.y + e.delta.y > e.over.rect.top + e.over.rect.height / 2;
      if (hint?.id !== e.over.id || hint.after !== after || hint.nest) setHint({ id: String(e.over.id), after, groupId: o.groupId });
      return;
    }
    if (a.type !== "item" || !o || !e.over) return setHint(null);
    // правее середины строки, над другим товаром стандартной таблицы — «станет вариацией»
    const c = e.activatorEvent && getEventCoordinates(e.activatorEvent);
    const target = o.type === "item" ? groups.find((g) => g.id === o.groupId) : undefined;
    if (c && o.type === "item" && !a.draft && !o.draft && e.over.id !== e.active.id && target && target.style !== "addons" && c.x + e.delta.x > nestFrom(e.over.rect)) {
      if (!hint?.nest || hint.id !== e.over.id) setHint({ id: String(e.over.id), after: false, groupId: o.groupId, nest: true });
      return;
    }
    if (o.type === "body") {
      if (o.groupId !== a.groupId) return setHint({ id: "", after: true, groupId: o.groupId });
      return setHint(null);
    }
    if (o.type !== "item" || o.groupId === a.groupId) return setHint(null);
    const r = e.active.rect.current.translated;
    const after = !!r && r.top + r.height / 2 > e.over.rect.top + e.over.rect.height / 2;
    if (hint?.id !== e.over.id || hint.after !== after) setHint({ id: String(e.over.id), after, groupId: o.groupId });
  };

  const onEnd = (e: DragEndEvent) => {
    setActive(null);
    const h = hint;
    const gh = groupHint;
    setHint(null);
    setGroupHint(null);
    const { active: act, over } = e;
    const a = act.data.current as DragData;
    if (a.type === "group") {
      if (!gh) return;
      update((w) =>
        setGroupIds(w, (ids) => {
          const rest = ids.filter((x) => x !== act.id);
          rest.splice(rest.indexOf(gh.id) + (gh.after ? 1 : 0), 0, String(act.id));
          return rest;
        }),
      );
      return;
    }
    if (!over || act.id === over.id) return;
    const o = over.data.current as DragData;
    if (a.type === "item" && o.type === "item" && h?.nest && h.id === over.id) {
      update((w) => void nestItem(w, a.groupId, String(act.id), o.groupId, String(over.id)));
      return;
    }
    if (a.type === "variation" && o.type === "item" && h?.id === over.id) {
      // к другому товару вариацией или в список отдельной позицией
      update((w) =>
        void (h.nest
          ? moveVariationTo(w, a.groupId, a.itemId, String(act.id), o.groupId, String(over.id))
          : unnestVariation(w, a.groupId, a.itemId, String(act.id), o.groupId, String(over.id), h.after)),
      );
      return;
    }
    if (a.type === "variation" && (o.type === "body" || (o.type === "item" && o.draft)) && h?.groupId === o.groupId) {
      update((w) => void unnestVariation(w, a.groupId, a.itemId, String(act.id), o.groupId));
      return;
    }
    if (a.type === "variation" && o.type === "variation") {
      update((w) => {
        const it = i$(w, a.groupId, a.itemId);
        const ids = it.variations.map((v) => v.id);
        moveVariation(it, ids.indexOf(String(act.id)), ids.indexOf(String(over.id))); // внутрь блока — с общей ценой

      });
      return;
    }
    if (a.type !== "item" || (o.type !== "item" && o.type !== "body")) return;
    const overDraft = o.type === "item" && !!o.draft;
    // утащили пустую строку-заготовку: на новом месте — пустая позиция (на лист не идёт, пока её не заполнят),
    // а в конце таблицы снова пустая строка
    const id = a.draft ? uid("i") : String(act.id);
    update((w) => {
      const from = g$(w, a.groupId);
      const to = g$(w, o.groupId);
      if (a.draft) from.items.push({ id, name: "", prices: from.style === "addons" ? [null] : from.columns.map(() => null), variations: [] });
      const idx = from.items.findIndex((i) => i.id === id);
      if (from === to) {
        if (o.type !== "item") return;
        from.items = arrayMove(from.items, idx, overDraft ? from.items.length - 1 : from.items.findIndex((i) => i.id === over.id));
        return;
      }
      const [moved] = from.items.splice(idx, 1);
      if (a.draft && to.style === "addons") moved.prices = [null];
      else if (a.draft) moved.prices = to.columns.map(() => null);
      let at = o.type === "item" && !overDraft ? to.items.findIndex((i) => i.id === over.id) : to.items.length;
      if (o.type === "item" && !overDraft && h?.id === over.id && h.after) at += 1;
      to.items.splice(at, 0, moved);
      // ценники идут за позицией
      for (const d of w.documents) if (d.kind === "tag" && d.ref?.itemId === moved.id) d.ref.groupId = to.id;
    });
  };

  // где открыт выбор вида новой таблицы: "end" — у кнопки «+ Таблица», иначе id таблицы, перед которой промежуток
  const [picker, setPicker] = useState<string | null>(null);
  const closePicker = useCallback(() => setPicker(null), []);
  /** Новая таблица выбранного вида — в конец или перед таблицей beforeId. Колонки — как у стандартной таблицы выше. */
  const addGroup = (style: GroupStyle, beforeId?: string) => {
    const upTo = beforeId ? groups.slice(0, groups.findIndex((g) => g.id === beforeId)) : groups;
    const prev = [...upTo].reverse().find((g) => g.style !== "addons");
    const columns = style === "addons" ? ["+"] : style === "compact" ? ["1 шт"] : prev ? [...prev.columns] : ["1 шт"];
    const id = uid("g");
    update((w) => {
      w.groups.push({ id, title: style === "addons" ? "Добавки" : "Новая таблица", style, columns, items: [] });
      setGroupIds(w, (ids) => {
        const at = beforeId ? ids.indexOf(beforeId) : -1;
        return at < 0 ? [...ids, id] : [...ids.slice(0, at), id, ...ids.slice(at)];
      });
    });
    setPicker(null);
    focusAfterRender = `title:${id}`;
  };

  const { catalog } = useCatalog();
  // сколько строк этого меню совпадает с базой по названию — считаем на копии
  const linkable = useMemo(() => (catalog ? linkByNames(structuredClone(groups), catalog) : 0), [catalog, groups]);
  const linkAll = () => {
    if (!catalog) return;
    offerUndo(`Связано с базой по названиям: ${linkable}`, ws);
    update((w) => linkByNames(doc.groupIds.map((id) => w.groups.find((g) => g.id === id)).filter((g): g is Group => !!g), catalog));
  };

  return (
    <div className="mt" onKeyDown={gridKeyDown}>
      <DndContext
        id={useId()}
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onStart}
        onDragMove={onMove}
        onDragEnd={onEnd}
        onDragCancel={() => {
          setActive(null);
          setHint(null);
          setGroupHint(null);
        }}
      >
        <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          {groups.map((g, gi) => (
            <Fragment key={g.id}>
            {/* промежуток между таблицами — один для всех, и перед добавками тоже: наведение — плюс, клик — выбор вида новой таблицы */}
            {gi > 0 && (
              <div className={`mt-gap ${picker === g.id ? "open" : ""}`}>
                <button type="button" className="mt-gap-btn" aria-label="Добавить таблицу" aria-expanded={picker === g.id} onClick={() => setPicker(picker === g.id ? null : g.id)}>
                  <span className="mt-gap-plus">
                    <Icon name="plus" size={16} />
                  </span>
                  <span className="mt-gap-tip" aria-hidden="true">
                    Добавить таблицу
                  </span>
                </button>
                {picker === g.id && <TablePicker onPick={(st) => addGroup(st, g.id)} onClose={closePicker} />}
              </div>
            )}
            <GroupTable
              group={g}
              attachedTo={g.style === "addons" ? groups.slice(0, gi).reverse().find((x) => x.style !== "addons")?.title : undefined}
              dropTarget={hint?.groupId === g.id}
              hint={hint}
              drop={groupHint?.id === g.id ? (groupHint.after ? "after" : "before") : null}
              canDelete
              onDelete={() => {
                offerUndo(`Группа «${g.title}» удалена`, ws);
                update((w) => {
                  setGroupIds(w, (ids) => ids.filter((x) => x !== g.id));
                  const used = w.documents.some((d) => d.kind === "menu" && d.groupIds.includes(g.id));
                  if (!used) w.groups = w.groups.filter((x) => x.id !== g.id);
                });
              }}
              onMove={(dir) => update((w) => setGroupIds(w, (ids) => (gi + dir < 0 || gi + dir >= ids.length ? ids : arrayMove(ids, gi, gi + dir))))}
            />
            </Fragment>
          ))}
        </SortableContext>
        {/* за курсором едет то, что взяли, — с того места, где взяли */}
        <DragOverlay dropAnimation={null}>{active?.lift && <Lifted lift={active.lift} />}</DragOverlay>
      </DndContext>
      <div className="mt-add">
        <button type="button" className="mt-add-table" aria-expanded={picker === "end"} onClick={() => setPicker(picker === "end" ? null : "end")}>
          <Icon name="plus" size={16} /> Таблица
        </button>
        {picker === "end" && <TablePicker onPick={(st) => addGroup(st)} onClose={closePicker} />}
      </div>
      <div className="mt-foot-actions">
        {linkable > 0 && (
          <button className="mt-add-group" onClick={linkAll} title="Строки с тем же названием, что у товара в базе, получат цены из базы">
            <Icon name="link-plus" size={16} /> Связать с базой по названиям: {linkable}
          </button>
        )}
      </div>
    </div>
  );
}

function useFocusAfterRender(key: string, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (focusAfterRender === key) {
      focusAfterRender = null;
      focusCell(ref.current ?? undefined);
    }
  });
}

/**
 * Сетка колонок: ручка | (галочка, ветка, цена добавки) | название | текст сверху | ветка | цены… | связь | меню.
 * Колонки цен — по ширине того, что в них введено (подпись объёма, цены позиций и вариаций), а не фиксированные:
 * --price-cols — ширины колонок, --price-sum — их сумма (по ней ставится ветка общей цены у вариаций).
 */
function gridStyle(g: Group): CSSProperties {
  const addons = g.style === "addons";
  const n = addons ? 1 : g.columns.length;
  const widths = Array.from({ length: n }, (_, i) => {
    const texts = [{ s: addons ? "Цена" : g.columns[i] ?? "", w: 500 }, { s: "—", w: 400 }];
    for (const it of g.items) {
      if (it.prices[i] != null) texts.push({ s: String(it.prices[i]), w: 400 });
      for (const v of it.variations) if (v.prices[i] != null) texts.push({ s: String(v.prices[i]), w: 400 });
    }
    // у поля цены по 6 px отступа с каждой стороны; уже 36 px колонка не бывает
    return Math.max(36, Math.ceil(Math.max(...texts.map((t) => textWidth(t.s, t.w)))) + 12);
  });
  return {
    ["--cols" as string]: n,
    ["--price-cols" as string]: widths.map((w) => `${w}px`).join(" "),
    ["--price-sum" as string]: `${widths.reduce((a, b) => a + b, 0)}px`,
  };
}

/** Ширина текста кеглем таблицы (16 px). Цифры в таблице моноширинные (tabular-nums) — каждая шириной самой широкой. */
const measure: { ctx?: CanvasRenderingContext2D | null; digit: Record<number, number> } = { digit: {} };
function textWidth(s: string, weight: number): number {
  if (measure.ctx === undefined) measure.ctx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  const ctx = measure.ctx;
  if (!ctx) return s.length * 10;
  ctx.font = `${weight} 16px ${getComputedStyle(document.body).fontFamily}`;
  measure.digit[weight] ??= Math.max(..."0123456789".split("").map((d) => ctx.measureText(d).width));
  let w = 0;
  for (const ch of s) w += /\d/.test(ch) ? measure.digit[weight] : ctx.measureText(ch).width;
  return w;
}

function GroupTable({
  group: g, attachedTo, dropTarget, hint, drop, onDelete, onMove,
}: {
  group: Group; attachedTo?: string; dropTarget: boolean; hint: { id: string; after: boolean; nest?: boolean } | null; drop: "before" | "after" | null;
  canDelete: boolean; onDelete: () => void; onMove: (dir: 1 | -1) => void;
}) {
  const { ws, update, offerUndo } = useWs();
  const root = useRef<HTMLElement | null>(null);
  // Галочки: в добавочной таблице — у добавок, в стандартной — у вариаций одной позиции (общая цена бывает
  // только между вариациями одного напитка). Отметка вариации другой позиции начинает выбор заново.
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const ownerOf = (id: string) => g.items.find((it) => it.variations.some((v) => v.id === id));
  const pickItem = addons_(g) ? undefined : pickedIds.map(ownerOf).find(Boolean);
  const picked = addons_(g)
    ? pickedIds.filter((id) => g.items.some((it) => it.id === id))
    : pickedIds.filter((id) => pickItem?.variations.some((v) => v.id === id));
  const setPick = (id: string, on: boolean) =>
    setPickedIds((p) => {
      const cur = !addons_(g) && p.length > 0 && ownerOf(p.find((x) => ownerOf(x)) ?? "") !== ownerOf(id) ? [] : p;
      return on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((x) => x !== id);
    });
  const pick = useSweep((id) => picked.includes(id), setPick);
  const clearPick = () => setPickedIds([]);
  // таблица при перетаскивании остаётся на месте (приглушённой), остальные не прыгают: место показывает линия
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useSortable({ id: g.id, data: { type: "group" } satisfies DragData });
  const { setNodeRef: setBodyRef } = useDroppable({ id: `body:${g.id}`, data: { type: "body", groupId: g.id } satisfies DragData });
  // строка над таблицей тоже берёт таблицу — мышью и касанием, без клавиатурного слушателя (см. разметку)
  const { onKeyDown: _keys, ...barDrag } = listeners ?? {};
  const titleRef = useRef<HTMLInputElement>(null);
  useFocusAfterRender(`title:${g.id}`, titleRef);
  const addons = g.style === "addons";
  const setG = (fn: (x: Group) => void) => update((w) => fn(g$(w, g.id)));

  // колонка — объём стакана: у каждой позиции и вариации в ней своя цена
  const addColumn = () => {
    setG((x) => {
      x.columns.push("");
      for (const it of x.items) {
        it.prices.push(null);
        for (const v of it.variations) v.prices.push(null);
      }
    });
    const at = g.columns.length;
    requestAnimationFrame(() => focusCell(root.current?.querySelector<HTMLElement>(`[data-col="${at}"]`) ?? undefined));
  };
  const removeColumn = (i: number) => {
    const used = g.items.some((it) => it.prices[i] != null || it.variations.some((v) => v.prices[i] != null));
    if (used) offerUndo(`Объём «${g.columns[i] || i + 1}» убран вместе с ценами`, ws);
    update((w) => {
      const x = g$(w, g.id);
      x.columns.splice(i, 1);
      for (const it of x.items) {
        it.prices.splice(i, 1);
        for (const v of it.variations) v.prices.splice(i, 1);
      }
      // ценники этой таблицы: колонки правее сдвинулись на одну
      for (const d of w.documents) if (d.kind === "tag" && d.ref?.groupId === x.id && d.ref.column > i) d.ref.column -= 1;
    });
  };

  return (
    <section
      ref={(el) => {
        root.current = el;
        setNodeRef(el);
      }}
      data-drag-id={g.id}
      style={gridStyle(g)}
      className={`gt gt-${g.style} ${isDragging ? "dragging" : ""} ${dropTarget ? "drop-target" : ""} ${drop ? `drop-${drop}` : ""}`}
      role="table"
      aria-label={g.title || "Таблица"}
      data-pick-root
      onPointerDown={pick.down}
      onKeyDown={(e) => {
        if (e.key === "Escape" && picked.length > 0) clearPick();
      }}
    >
      {/* за верхнюю строку таблицу тоже можно перетащить: тянуть за пустое место или кнопки — клик по ним
          работает как раньше, перетаскивание начинается только со сдвига на 4 px. Только мышь и касание:
          Enter и пробел на кнопках строки должны нажимать их, а не брать таблицу (с клавиатуры — за ручку) */}
      <div className="gt-bar" {...barDrag}>
        <Select
          variant="quiet"
          className="gt-kind"
          label="Тип и вид таблицы"
          value={g.style}
          onChange={(v) => setG((x) => (x.style = v as GroupStyle))}
          options={KINDS.flatMap((k) => [{ group: k.label }, ...k.styles.map(([st, l]) => ({ value: st as string, label: l }))])}
        />
        {addons ? null : (
          <button className="gt-coladd" disabled={g.columns.length >= MAX_COLUMNS} onClick={addColumn} title="Добавить колонку: объём стакана со своей ценой">
            <Icon name="plus" size={14} /> Объём
          </button>
        )}
      </div>
      <div className="gt-row gt-head" role="row" data-nav-row>
        <button className="gt-grip" ref={setActivatorNodeRef} {...attributes} {...listeners} tabIndex={-1} aria-label={`Перетащить группу «${g.title}»`}>
          <Icon name="grip" size={14} />
        </button>
        {addons && (
          <PickAll
            all={g.items.length > 0 && picked.length === g.items.length}
            some={picked.length > 0}
            onChange={(on) => setPickedIds(on ? g.items.map((it) => it.id) : [])}
          />
        )}
        {/* узкая колонка перед ценами — под ветку общей цены (точка, линия, стрелка); в шапке пустая */}
        {addons && <span className="gt-tie" aria-hidden="true" />}
        {addons && <span className="gt-colhead" role="columnheader">Цена</span>}
        {/* у добавок названия таблицы на листе нет — в шапке подпись колонки «Имя», как «Цена» */}
        {addons ? (
          <span className="gt-colhead gt-namehead" role="columnheader">Имя</span>
        ) : (
          <input
            ref={titleRef}
            className="gt-title"
            role="columnheader"
            aria-label="Название группы"
            data-nav={NAV.name}
            value={g.title}
            placeholder="Название группы"
            onChange={(e) => setG((x) => (x.title = e.target.value))}
            onKeyDown={(e) => {
              if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                e.preventDefault();
                onMove(e.key === "ArrowUp" ? -1 : 1);
                requestAnimationFrame(() => titleRef.current?.focus());
              }
            }}
          />
        )}
        {!addons && <span className="gt-tie" aria-hidden="true" />}
        {!addons &&
          g.columns.map((c, i) => (
            <input
              key={i}
              className="gt-colhead"
              role="columnheader"
              aria-label={`Объём стакана, колонка ${i + 1}`}
              data-nav={NAV.price + i}
              data-nav-free
              data-col={i}
              placeholder="объём"
              value={c}
              onChange={(e) => setG((x) => (x.columns[i] = e.target.value))}
            />
          ))}
        <RowMenu label={`Таблица «${g.title}»`}>
          {(close) => (
            <>
              {!addons && (
                <>
                  <MenuItem icon="plus" disabled={g.columns.length >= MAX_COLUMNS} onClick={() => (addColumn(), close())}>
                    Добавить объём
                  </MenuItem>
                  {g.columns.length > 1 &&
                    g.columns.map((c, i) => (
                      <MenuItem key={i} icon="minus" onClick={() => (removeColumn(i), close())}>
                        Убрать объём «{c || i + 1}»
                      </MenuItem>
                    ))}
                  <div className="rm-sep" role="separator" />
                </>
              )}
              <MenuItem icon="up" onClick={() => (onMove(-1), close())}>
                Таблицу выше
              </MenuItem>
              <MenuItem icon="chevron" onClick={() => (onMove(1), close())}>
                Таблицу ниже
              </MenuItem>
              <div className="rm-sep" role="separator" />
              <MenuItem icon="trash" danger onClick={() => (onDelete(), close())}>
                Удалить таблицу
              </MenuItem>
            </>
          )}
        </RowMenu>
      </div>

      {/* пока позицию держат над товаром «стать вариацией», строки не раздвигаются — товар под курсором не уезжает */}
      <SortableContext items={[...g.items.map((i) => i.id), `draft:${g.id}`]} strategy={hint?.nest ? stayPut : verticalListSortingStrategy}>
        <div ref={setBodyRef} role="rowgroup" className="gt-body">
          {g.items.map((it, k) => (
            <ItemRows
              key={it.id}
              group={g}
              item={it}
              index={k}
              hint={hint?.id === it.id ? (hint.nest ? "nest" : hint.after ? "after" : "before") : null}
              picked={picked.includes(it.id)}
              pickedVars={pickItem?.id === it.id ? picked : NONE}
              pick={pick}
            />
          ))}
          <DraftRow group={g} hint={hint?.id === `draft:${g.id}` ? (hint.after ? "after" : "before") : null} />
        </div>
      </SortableContext>
      {picked.length > 0 && (
        // выбор: панель действий висит над первой отмеченной строкой
        <PickBar
          key={addons ? "addons" : pickItem?.id}
          ids={picked}
          dep={g}
          count={picked.length}
          of={addons ? undefined : pickItem?.name}
          onClear={clearPick}
          actions={
            addons
              ? [
                  { label: "Объединить", icon: "subitem-2", hint: "Поставить подряд и дать одну цену: на листе — одной строкой через запятую", disabled: picked.length < 2, run: () => setG((x) => groupAddons(x, picked)) },
                  { label: "Разделить", icon: "pen-writing-2", hint: "Печатать каждую своей строкой", disabled: !picked.some((id) => { const i = g.items.findIndex((x) => x.id === id); return addonJoins(g.items, i) || addonJoins(g.items, i + 1); }), run: () => setG((x) => splitAddons(x, picked)) },
                  { label: "Удалить", danger: true, run: () => {
                    offerUndo(`${picked.length === 1 ? "Добавка удалена" : `Удалено добавок: ${picked.length}`}`, ws);
                    setG((x) => (x.items = x.items.filter((it) => !picked.includes(it.id))));
                  } },
                ]
              : [
                  { label: "Общая цена", icon: "subitem-2", hint: "Поставить подряд и дать цену первой: на листе — один блок с одной ценой", disabled: picked.length < 2, run: () => setG((x) => shareVariations(x.items.find((it) => it.id === pickItem!.id)!, picked)) },
                  { label: "Своя цена", icon: "pen-writing-2", hint: "Печатать каждую отдельно; цена, что была общей, останется у каждой", disabled: !picked.some((id) => { const vs = pickItem!.variations; const i = vs.findIndex((v) => v.id === id); return !!vs[i]?.sharePrice || !!vs[i + 1]?.sharePrice; }), run: () => setG((x) => splitVariations(x.items.find((it) => it.id === pickItem!.id)!, picked)) },
                  { label: "Удалить", danger: true, run: () => {
                    offerUndo(`${picked.length === 1 ? "Вариация удалена" : `Удалено вариаций: ${picked.length}`} у «${pickItem!.name || "позиции"}»`, ws);
                    setG((x) => removeVariations(x.items.find((it) => it.id === pickItem!.id)!, picked));
                  } },
                ]
          }
        />
      )}
    </section>
  );
}

function ItemRows({
  group: g, item: it, index, hint, picked, pickedVars, pick,
}: {
  group: Group; item: Item; index: number; hint: "before" | "after" | "nest" | null; picked: boolean;
  /** отмеченные вариации этой позиции (выбор в таблице — всегда у одной позиции) */ pickedVars: string[];
  pick: Sweep;
}) {
  const { ws, update, offerUndo } = useWs();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: it.id,
    data: { type: "item", groupId: g.id } satisfies DragData,
  });
  // добавка в группе с общей ценой: joined — присоединена к добавке выше, grouped — есть соседи по группе
  const joined = g.style === "addons" && addonJoins(g.items, index);
  const grouped = joined || (g.style === "addons" && addonJoins(g.items, index + 1));
  const nameRef = useRef<HTMLInputElement>(null);
  useFocusAfterRender(`name:${it.id}`, nameRef);
  const addons = g.style === "addons";
  const cols = addons ? ["+"] : g.columns;
  const setItem = (fn: (x: Item, gr: Group) => void) => update((w) => fn(i$(w, g.id, it.id), g$(w, g.id)));
  const { catalog } = useCatalog();
  const tagCount = ws.documents.filter((d) => d.kind === "tag" && d.ref?.itemId === it.id).length;

  const moveRow = (e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    e.stopPropagation();
    const to = index + (e.key === "ArrowUp" ? -1 : 1);
    if (to < 0 || to >= g.items.length) return;
    const focused = document.activeElement as HTMLElement | null;
    update((w) => {
      const gr = g$(w, g.id);
      gr.items = arrayMove(gr.items, index, to);
    });
    requestAnimationFrame(() => focused?.focus());
  };

  /** Новая пустая позиция на месте at (выше текущей — index, ниже — index + 1), курсор — в её название. */
  const insertItem = (at: number) => {
    const id = uid("i");
    update((w) => {
      const gr = g$(w, g.id);
      gr.items.splice(at, 0, { id, name: "", prices: addons ? [null] : gr.columns.map(() => null), variations: [] });
    });
    focusAfterRender = `name:${id}`;
  };

  const addVariation = () => {
    const id = uid("v");
    setItem((x) => x.variations.push({ id, name: "", prices: x.prices.map(() => null) }));
    focusAfterRender = `name:${id}`;
  };

  // добавки с общей ценой: цена у группы одна — меняется у первой, меняется у всех, кто к ней присоединён
  const priceMates = (items: Item[], at: number): Item[] => {
    if (!addons || addonJoins(items, at)) return [];
    let end = at + 1;
    while (end < items.length && addonJoins(items, end)) end++;
    return items.slice(at + 1, end);
  };
  /** Поставить цену в колонку i (и присоединённым добавкам); manual: true — «только для меню», false — снова из базы. */
  const setPrice = (i: number, v: Price, manual: boolean | null) =>
    update((w) => {
      const gr = g$(w, g.id);
      const at = gr.items.findIndex((x) => x.id === it.id);
      for (const x of [gr.items[at], ...priceMates(gr.items, at)]) {
        x.prices[i] = v;
        if (manual !== null) setManualColumn(x, i, manual);
      }
    });
  const price = (i: number) => {
    const origin = priceOrigin(catalog, it, it, i);
    return (
      <PriceCell
        key={i}
        className="gt-price"
        nav={NAV.price + (addons ? 0 : i)}
        label={`${it.name || "Позиция"} ${cols[i]}`}
        value={it.prices[i] ?? null}
        origin={origin}
        onManual={(v) => setPrice(i, v, null)}
        onMenuOnly={(v) => setPrice(i, v, true)}
        onUpdateDb={async (v) => {
          const keys = [it, ...priceMates(g.items, index)].map((x) => priceOrigin(catalog, x, x, i).dbKey).filter((k) => k != null);
          await updateCatalogPrices(keys.map((k) => ({ ...k, price: v })));
          setPrice(i, v, false);
        }}
        onRestore={() => setPrice(i, origin.dbPrice === undefined ? (it.prices[i] ?? null) : origin.dbPrice, false)}
      />
    );
  };

  return (
    <div
      ref={setNodeRef}
      data-drag-id={it.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`gt-item ${isDragging ? "dragging" : ""} ${hint ? `drop-${hint}` : ""} ${grouped ? "in-group" : ""} ${joined ? "joined" : ""}`}
    >
      <div className="gt-row" role="row" data-nav-row onKeyDown={moveRow} data-pick={addons ? it.id : undefined}>
        <button className="gt-grip" ref={setActivatorNodeRef} {...attributes} {...listeners} tabIndex={-1} aria-label={`Перетащить «${it.name}»`}>
          <Icon name="grip" size={14} />
        </button>
        {addons && (
          <span className="gt-pick" role="cell" data-pick-box onClick={() => pick.click(it.id)}>
            <input type="checkbox" data-nav={NAV.pick} tabIndex={-1} checked={picked} readOnly aria-label={`Выбрать «${it.name || "добавку"}», чтобы объединить или разделить`} />
          </span>
        )}
        {addons && <span className="gt-tie" aria-hidden="true" />}
        {addons && price(0)}
        <span className="gt-name" role="cell">
          <input
            ref={nameRef}
            className="gt-input"
            data-nav={NAV.name}
            aria-label="Название"
            placeholder={addons ? "Добавка" : "Позиция"}
            value={it.name}
            onChange={(e) => setItem((x) => (x.name = e.target.value))}
          />
          {it.allergen && <AllergenMark />}
        </span>
        <NoteCell value={it.note} label={`Текст сверху у «${it.name || "позиции"}»`} onChange={(t) => setItem((x) => (x.note = t))} />
        {!addons && <span className="gt-tie" aria-hidden="true" />}
        {!addons && cols.map((_, i) => price(i))}
        <CatalogButton
          entries={productEntries(catalog, addons)}
          link={it.link}
          linkedId={isProductLinkOf(it.link) ? it.link.ref : undefined}
          linkedTo={linkedName(catalog, it.link)}
          onPick={(e) => {
            const p = catalog?.products.find((x) => x.id === e.id);
            if (p) setItem((x, gr) => ((x.name = p.name), linkToProduct(gr, x, p)));
          }}
        />
        <RowMenu label={`«${it.name || "Позиция"}»`}>
          {(close) => (
            <>
              <MenuItem icon="arrow-up-from-line" onClick={() => (insertItem(index), close())}>
                Создать позицию выше
              </MenuItem>
              <MenuItem icon="arrow-down-from-line" onClick={() => (insertItem(index + 1), close())}>
                Создать позицию ниже
              </MenuItem>
              {!addons && (
                <MenuItem icon="subitem" onClick={() => (addVariation(), close())}>
                  Добавить вариацию
                </MenuItem>
              )}
              <div className="rm-sep" role="separator" />
              <MenuItem checked={!!it.allergen} onClick={() => (setItem((x) => (x.allergen = !x.allergen || undefined)), close())}>
                Пометка «Аллерген»
              </MenuItem>
              {/* узкая таблица (телефон): колонки «Текст сверху» нет — поле здесь */}
              <label className="rm-field rm-note">
                <span>Текст сверху</span>
                <input className="text-input" value={it.note ?? ""} placeholder="напр. «сверху»" onChange={(e) => setItem((x) => (x.note = e.target.value || undefined))} />
              </label>
              {it.link && (
                <MenuItem icon="unlink" onClick={() => (setItem((x) => unlink(x)), close())}>
                  Отвязать от базы
                </MenuItem>
              )}
              <MenuItem
                icon="copy"
                onClick={() => {
                  const id = uid("i");
                  update((w) => {
                    const gr = g$(w, g.id);
                    const copy = structuredClone(gr.items[index]);
                    copy.id = id;
                    copy.name = `${copy.name} (копия)`;
                    copy.variations.forEach((v) => (v.id = uid("v")));
                    gr.items.splice(index + 1, 0, copy);
                  });
                  focusAfterRender = `name:${id}`;
                  close();
                }}
              >
                Дублировать
              </MenuItem>
              <div className="rm-sep" role="separator" />
              <MenuItem
                icon="trash"
                danger
                onClick={() => {
                  offerUndo(`«${it.name || "Позиция"}» удалена${tagCount ? ` (ценников: ${tagCount})` : ""}`, ws);
                  update((w) => {
                    const gr = g$(w, g.id);
                    gr.items = gr.items.filter((x) => x.id !== it.id);
                  });
                  close();
                }}
              >
                Удалить позицию
              </MenuItem>
            </>
          )}
        </RowMenu>
      </div>
      {it.variations.length > 0 && (
        <SortableContext items={it.variations.map((v) => v.id)} strategy={verticalListSortingStrategy}>
          {it.variations.map((v, vi) => (
            <VariationRow key={v.id} group={g} item={it} v={v} index={vi} cols={cols} picked={pickedVars.includes(v.id)} picking={pickedVars.length > 0} pick={pick} />
          ))}
        </SortableContext>
      )}
    </div>
  );
}

function VariationRow({ group: g, item: it, v, index, cols, picked, picking, pick }: {
  group: Group; item: Item; v: Variation; index: number; cols: string[];
  /** отмечена галочкой; picking — у этой позиции уже что-то отмечено, галочки видны у всех её вариаций */ picked: boolean; picking: boolean; pick: Sweep;
}) {
  const { update } = useWs();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: v.id,
    data: { type: "variation", groupId: g.id, itemId: it.id } satisfies DragData,
  });
  const nameRef = useRef<HTMLInputElement>(null);
  useFocusAfterRender(`name:${v.id}`, nameRef);
  const setV = (fn: (x: Variation, item: Item) => void) =>
    update((w) => {
      const item = i$(w, g.id, it.id);
      fn(item.variations.find((x) => x.id === v.id)!, item);
      syncSharedPrices(item);
    });
  const { catalog } = useCatalog();
  const base = isProductLinkOf(it.link) ? catalog?.products.find((p) => p.id === it.link!.ref) : undefined;
  const shared = index > 0 && !!v.sharePrice;
  // вариации с общей ценой — одна группа: первая задаёт цену, у остальных она та же (на листе цена стоит одна на всех)
  const grouped = shared || !!it.variations[index + 1]?.sharePrice;
  const blockPrices = variationPrices(it.variations, v.id) ?? v.prices;
  /** Новая вариация на месте at; внутри блока с общей ценой присоединяется к нему (правила — moveVariation). */
  const insertVariation = (at: number) => {
    const id = uid("v");
    update((w) => {
      const item = i$(w, g.id, it.id);
      item.variations.push({ id, name: "", prices: item.prices.map(() => null) });
      moveVariation(item, item.variations.length - 1, at);
    });
    focusAfterRender = `name:${id}`;
  };
  /** Своя цена в колонке i у присоединённой вариации: отвязать, остальные колонки — прежняя общая цена. Курсор остаётся в ячейке. */
  const breakShare = (i: number, val: Price) => {
    const from = [...blockPrices];
    setV((x, item) => {
      unshareVariation(item, x.id);
      x.prices = from;
      x.prices[i] = val;
    });
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(`[data-drag-id="${v.id}"] input[data-nav="${NAV.price + i}"]`);
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  return (
    <div
      ref={setNodeRef}
      data-drag-id={v.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`gt-row gt-var ${shared ? "shared" : ""} ${grouped ? "in-group" : ""} ${isDragging ? "dragging" : ""} ${picked ? "picked" : ""} ${picking ? "picking" : ""}`}
      role="row"
      data-nav-row
      data-pick={v.id}
      data-pick-scope={it.id}
      onKeyDown={(e) => {
        if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault();
        e.stopPropagation();
        const to = index + (e.key === "ArrowUp" ? -1 : 1);
        if (to < 0 || to >= it.variations.length) return;
        const focused = document.activeElement as HTMLElement | null;
        setV((_, item) => moveVariation(item, index, to));
        requestAnimationFrame(() => focused?.focus());
      }}
    >
      <button className="gt-grip small" ref={setActivatorNodeRef} {...attributes} {...listeners} tabIndex={-1} aria-label={`Перетащить «${v.name}»`}>
        <Icon name="grip" size={12} />
      </button>
      <span className="gt-name" role="cell">
        {/* галочка — в отступе вариации: видна при наведении на строку и пока у позиции что-то отмечено */}
        <span className="gt-vpick" data-pick-box onClick={() => pick.click(v.id)}>
          <input type="checkbox" data-nav={NAV.pick} tabIndex={-1} checked={picked} readOnly aria-label={`Выбрать «${v.name || "вариацию"}», чтобы дать общую цену, разделить или удалить`} />
        </span>
        <input
          ref={nameRef}
          className="gt-input"
          data-nav={NAV.name}
          aria-label={`Вариация «${it.name}»`}
          placeholder="Вариация"
          value={v.name}
          onChange={(e) => setV((x) => (x.name = e.target.value))}
        />
        {v.allergen && <AllergenMark />}
      </span>
      <NoteCell value={v.note} label={`Текст сверху у вариации «${v.name || it.name}»`} onChange={(t) => setV((x) => (x.note = t))} />
      <span className="gt-tie" aria-hidden="true" />
      {shared ? (
        // общая цена — серым в пустых полях; своя цифра в любой колонке отвязывает вариацию
        cols.map((c, i) => (
          <input
            key={i}
            className="gt-price gt-shared-in"
            data-nav={NAV.price + i}
            data-nav-free=""
            inputMode="numeric"
            pattern="[0-9]*"
            enterKeyHint="next"
            value=""
            placeholder={blockPrices[i] == null ? "—" : String(blockPrices[i])}
            title="Цена общая с вариацией выше. Впишите свою, чтобы задать отдельную цену"
            aria-label={`${v.name || "Вариация"} ${c}: цена общая с вариацией выше, ${blockPrices[i] ?? "нет"}. Впишите свою, чтобы отвязать`}
            onChange={(e) => {
              const t = e.target.value.replace(/[^\d]/g, "").slice(0, 6);
              if (t) breakShare(i, Number(t));
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace" || e.key === "Delete") {
                e.preventDefault();
                breakShare(i, null);
              }
            }}
          />
        ))
      ) : (
        cols.map((c, i) => {
          const origin = priceOrigin(catalog, it, v, i);
          const put = (val: Price, manual: boolean | null) =>
            setV((x) => {
              x.prices[i] = val;
              if (manual !== null) setManualColumn(x, i, manual);
            });
          return (
            <PriceCell
              key={i}
              className="gt-price"
              nav={NAV.price + i}
              label={`${v.name || "Вариация"} ${c}`}
              value={v.prices[i] ?? null}
              origin={origin}
              onManual={(val) => put(val, null)}
              onMenuOnly={(val) => put(val, true)}
              onUpdateDb={async (val) => {
                if (origin.dbKey) await updateCatalogPrices([{ ...origin.dbKey, price: val }]);
                put(val, false);
              }}
              onRestore={() => put(origin.dbPrice === undefined ? (v.prices[i] ?? null) : origin.dbPrice, false)}
            />
          );
        })
      )}
      <CatalogButton
        entries={[
          ...(base?.milk ?? []).map((m) => ({ id: `m:${m.id}`, name: m.label, category: `Молоко для «${base!.name}»`, detail: m.surcharge ? `+${m.surcharge}` : "без доплаты" })),
          ...productEntries(catalog, false),
        ]}
        link={v.link}
        linkedId={isMilkLink(v.link) ? `m:${(v.link as MilkLink).milkId}` : isProductLinkOf(v.link) ? v.link.ref : undefined}
        linkedTo={isMilkLink(v.link) ? base?.milk.find((m) => m.id === (v.link as MilkLink).milkId)?.label : linkedName(catalog, v.link)}
        onPick={(e) => {
          const milk = e.id.startsWith("m:") ? base?.milk.find((m) => `m:${m.id}` === e.id) : undefined;
          if (milk) return setV((x, item) => ((x.name = milk.label), linkToMilk(x, milk, item)));
          const p = catalog?.products.find((x) => x.id === e.id);
          if (p) setV((x) => ((x.name = p.name), linkToProduct(g, x, p))); // «Раф» + «Раф халва» печатается как «Раф халва»
        }}
      />
      <RowMenu label={`Вариация «${v.name || ""}»`}>
        {(close) => (
          <>
            {index > 0 && (
              <>
                <MenuItem
                  checked={!!shared}
                  iconOff="share-down"
                  onClick={() => (setV((x, item) => (x.sharePrice ? unshareVariation(item, x.id) : (x.sharePrice = true))), close())}
                >
                  Цена общая с вариацией выше
                </MenuItem>
                <div className="rm-sep" role="separator" />
              </>
            )}
            <MenuItem icon="arrow-up-from-line" onClick={() => (insertVariation(index), close())}>
              Создать вариацию выше
            </MenuItem>
            <MenuItem icon="arrow-down-from-line" onClick={() => (insertVariation(index + 1), close())}>
              Создать вариацию ниже
            </MenuItem>
            <div className="rm-sep" role="separator" />
            <MenuItem checked={!!v.allergen} onClick={() => (setV((x) => (x.allergen = !x.allergen || undefined)), close())}>
              Пометка «Аллерген»
            </MenuItem>
            <label className="rm-field rm-note">
              <span>Текст сверху</span>
              <input className="text-input" value={v.note ?? ""} placeholder="напр. «сверху»" onChange={(e) => setV((x) => (x.note = e.target.value || undefined))} />
            </label>
            <div className="rm-sep" role="separator" />
            {v.link && (
              <>
                <MenuItem icon="unlink" onClick={() => (setV((x) => unlink(x)), close())}>
                  Отвязать от базы
                </MenuItem>
                <div className="rm-sep" role="separator" />
              </>
            )}
            <MenuItem icon="trash" danger onClick={() => (setV((_, item) => (item.variations = item.variations.filter((x) => x.id !== v.id))), close())}>
              Удалить вариацию
            </MenuItem>
          </>
        )}
      </RowMenu>
    </div>
  );
}

const NONE: string[] = [];

/**
 * Пустая строка в конце таблицы — вместо кнопки «+ Позиция». Первый же введённый символ (в названии, тексте сверху
 * или цене) создаёт позицию, курсор остаётся в том же поле уже настоящей строки, а ниже снова пустая строка.
 * Пока ничего не введено, позиции нет. Строку можно утащить за ручку: на новом месте встанет пустая позиция
 * (на лист она не идёт, пока её не заполнят — isBlankItem), а в конце таблицы появится новая пустая строка.
 */
function DraftRow({ group: g, hint }: { group: Group; hint: "before" | "after" | null }) {
  const { update } = useWs();
  const addons = g.style === "addons";
  const id = `draft:${g.id}`;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { type: "item", groupId: g.id, draft: true } satisfies DragData,
  });
  const what = addons ? "добавка" : "позиция";
  /** Создать позицию с тем, что ввели, и перевести курсор в то же поле новой строки (в конец текста). */
  const start = (fill: (it: Item) => void, nav: number) => {
    const nid = uid("i");
    // строка появляется сразу (flushSync), и курсор переходит в неё до следующего нажатия — быстрый набор не теряет букв
    flushSync(() =>
      update((w) => {
        const gr = g$(w, g.id);
        const it: Item = { id: nid, name: "", prices: addons ? [null] : gr.columns.map(() => null), variations: [] };
        fill(it);
        gr.items.push(it);
      }),
    );
    const el = document.querySelector<HTMLInputElement>(`[data-drag-id="${nid}"] input[data-nav="${nav}"]`);
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };
  const price = (i: number) => (
    <input
      key={i}
      className="gt-price"
      data-nav={NAV.price + i}
      inputMode="numeric"
      pattern="[0-9]*"
      value=""
      aria-label={`Цена новой позиции${addons ? "" : `, ${g.columns[i] || i + 1}`}`}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d]/g, "").slice(0, 6);
        if (t) start((it) => (it.prices[i] = Number(t)), NAV.price + i);
      }}
    />
  );
  return (
    <div
      ref={setNodeRef}
      data-drag-id={id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`gt-item gt-draft ${isDragging ? "dragging" : ""} ${hint ? `drop-${hint}` : ""}`}
    >
      <div className="gt-row" role="row" data-nav-row>
        <button className="gt-grip" ref={setActivatorNodeRef} {...attributes} {...listeners} tabIndex={-1} aria-label={`Перетащить пустую строку: на новом месте появится пустая ${what}`}>
          <Icon name="grip" size={14} />
        </button>
        {addons && <span className="gt-pick" role="cell" />}
        {addons && <span className="gt-tie" aria-hidden="true" />}
        {addons && price(0)}
        <span className="gt-name" role="cell">
          <input
            className="gt-input"
            data-nav={NAV.name}
            value=""
            placeholder={addons ? "Новая добавка" : "Новая позиция"}
            aria-label={addons ? "Новая добавка" : "Новая позиция"}
            onChange={(e) => e.target.value && start((it) => (it.name = e.target.value), NAV.name)}
          />
        </span>
        <span className="gt-notecell" role="cell">
          <input
            className="gt-note-in"
            data-nav={NAV.note}
            value=""
            aria-label={`Текст сверху у новой ${addons ? "добавки" : "позиции"}`}
            onChange={(e) => e.target.value && start((it) => (it.note = e.target.value), NAV.note)}
          />
        </span>
        {!addons && <span className="gt-tie" aria-hidden="true" />}
        {!addons && g.columns.map((_, i) => price(i))}
      </div>
    </div>
  );
}

/** Галочка в шапке: отметить все строки таблицы или снять отметку; отмечены не все — черта в квадрате. */
function PickAll({ all, some, onChange }: { all: boolean; some: boolean; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some && !all;
  }, [some, all]);
  return (
    <span className="gt-pick" role="columnheader">
      <input
        ref={ref}
        type="checkbox"
        data-nav={NAV.pick}
        tabIndex={-1}
        checked={all}
        onChange={() => onChange(!all)}
        aria-label={all ? "Снять выбор со всех добавок" : "Выбрать все добавки"}
      />
    </span>
  );
}

/** Действие панели выбора; danger — удаление: только иконка корзины, подпись — для диктора и в подсказке. */
type PickAction = { label: string; icon?: string; hint?: string; disabled?: boolean; danger?: boolean; run: () => void };

/**
 * Панель действий с отмеченными строками. Висит поверх таблицы сразу над первой отмеченной строкой — действие
 * рядом с тем, к чему оно относится. Если первую отмеченную строку прокрутили вверх, панель остаётся видна
 * под прилипшей шапкой таблицы, пока таблица на экране. Действие снимает выбор; Esc и ✕ — тоже.
 * Каждая кнопка — не меньше 44×44: панель появляется и на телефоне.
 */
function PickBar({ ids, dep, count, of, actions, onClear }: {
  ids: string[]; /** при правке таблицы строки сдвигаются — пересчитать место */ dep: unknown;
  count: number; of?: string; actions: PickAction[]; onClear: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [y, setY] = useState<number | null>(null);
  const key = ids.join(",");
  useLayoutEffect(() => {
    // таблицу ищем от самой панели: ref таблицы — функция, на время отрисовки React обнуляет его и ставит
    // заново уже после этого эффекта; через него панель видела пустоту и не переезжала при протяжке вверх
    const sec = bar.current?.closest<HTMLElement>("[data-pick-root]");
    if (!sec) return;
    const scroller = scrollParent(sec);
    const place = () => {
      const first = [...sec.querySelectorAll<HTMLElement>("[data-pick]")].find((r) => ids.includes(r.dataset.pick!));
      if (!first || !bar.current) return;
      const s = sec.getBoundingClientRect();
      const h = bar.current.offsetHeight;
      const head = sec.querySelector(".gt-head")?.getBoundingClientRect().height ?? 0;
      const view = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
      let top = first.getBoundingClientRect().top - s.top - h - 6;
      top = Math.max(top, view + head + 6 - s.top); // не уходит под прилипшую шапку и за верх панели
      top = Math.min(top, s.height - h - 6); // и не вылезает за низ таблицы
      setY(Math.round(top));
    };
    place();
    scroller.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      scroller.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dep]);
  return (
    <div
      ref={bar}
      className="gt-pickbar"
      role="toolbar"
      aria-label="Действия с отмеченными строками"
      style={{ translate: `0 ${y ?? 0}px`, visibility: y == null ? "hidden" : undefined }}
    >
      {/* сколько отмечено — круглый бейдж; подробно («у «Латте»») — в подсказке и для диктора */}
      <span className="gt-pickbar-count" aria-live="polite" title={`Выбрано ${count}${of ? ` у «${of}»` : ""}`}>
        <span className="gt-pickbar-badge" aria-hidden="true">{count}</span>
        <span className="sr-only">Выбрано {count}{of ? ` у «${of}»` : ""}</span>
      </span>
      {actions.map((a) => (
        <button
          key={a.label}
          className={a.danger ? "danger" : undefined}
          disabled={a.disabled}
          title={a.hint ?? a.label}
          aria-label={a.danger ? a.label : undefined}
          onClick={() => {
            a.run();
            onClear();
          }}
        >
          <Icon name={a.danger ? "trash-2" : (a.icon ?? "plus")} size={16} />
          {!a.danger && <span className="gt-pickbar-label">{a.label}</span>}
        </button>
      ))}
      <button className="gt-pickbar-x" onClick={onClear} aria-label="Снять выбор" title="Снять выбор (Esc)">
        <Icon name="close-2" size={16} />
      </button>
    </div>
  );
}

/** Метка «А» у названия, как на листе. Только показывает: включается в меню «⋯» строки — «Пометка «Аллерген»». */
function AllergenMark() {
  return (
    <span className="gt-a" title="Аллерген — пометка включается в меню «⋯» строки">
      <span aria-hidden="true">А</span>
      <span className="sr-only">аллерген</span>
    </span>
  );
}

/** Колонка «Текст сверху»: мелкая надпись над названием на листе («сверху» у «Корица, какао»), по правому краю. */
function NoteCell({ value, label, onChange }: { value?: string; label: string; onChange: (v: string | undefined) => void }) {
  return (
    <span className="gt-notecell" role="cell">
      <input
        className="gt-note-in"
        data-nav={NAV.note}
        aria-label={label}
        title="Мелкий текст сверху справа от названия, как «сверху» у «Корица, какао»"
        placeholder="сверху"
        spellCheck={false}
        autoComplete="off"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    </span>
  );
}

/**
 * Пункт меню «⋯»: слева слот 16 px под иконку, справа текст — у всех пунктов текст начинается с одной линии.
 * С checked пункт — переключатель: в слоте галочка, когда включён, и пусто, когда нет.
 */
function MenuItem({ icon, iconOff, checked, danger, disabled, onClick, children }: {
  icon?: string; /** у переключателя — иконка, пока он выключен (включён — галочка) */ iconOff?: string;
  checked?: boolean; danger?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode;
}) {
  const toggle = checked !== undefined;
  return (
    <button
      role={toggle ? "menuitemcheckbox" : "menuitem"}
      aria-checked={toggle ? checked : undefined}
      className={`rm-item ${danger ? "danger" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="rm-ico" aria-hidden="true">
        {toggle ? (checked ? <Icon name="check" size={16} /> : iconOff && <Icon name={iconOff} size={16} />) : icon && <Icon name={icon} size={16} />}
      </span>
      <span className="rm-text">{children}</span>
    </button>
  );
}

/** Меню действий строки: открывается кнопкой ⋯, закрывается Esc или кликом мимо. */
function RowMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const { mounted, closing } = usePresence(open);
  // меню — в document.body поверх всего: иначе его перекрывали таблицы ниже и обрезала панель
  useFloating(mounted, btn, box);
  useEffect(() => {
    if (!open) return;
    // сначала кнопка: фокус в поле открыл бы на телефоне клавиатуру, хотя нужен был другой пункт
    const first = box.current?.querySelector<HTMLElement>("button:not(:disabled)") ?? box.current?.querySelector<HTMLElement>("input");
    first?.focus();
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && e.target !== btn.current) setOpen(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  return (
    <span className="rm">
      <button
        ref={btn}
        className="gt-more"
        data-nav={NAV.more}
        tabIndex={-1}
        aria-label={`Действия: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="more" size={16} />
      </button>
      {mounted &&
        createPortal(
        <div
          ref={box}
          className="rm-menu floating"
          data-closing={closing || undefined}
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") return close();
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            if (e.target instanceof HTMLInputElement) return;
            e.preventDefault();
            const items = [...(box.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input") ?? [])];
            const i = items.indexOf(document.activeElement as HTMLElement);
            items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          }}
        >
          {children(close)}
        </div>,
          document.body,
        )}
    </span>
  );
}


/** Строка списка товаров: товар каталога или вид молока товара основы. */
interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  detail?: string; // цены справа
}

const isProductLinkOf = (l: CatalogLink | MilkLink | undefined): l is CatalogLink => !!l && "ref" in l;

/** Товары каталога для списка; в таблице добавок сначала добавки, в остальных — в конце. */
function productEntries(catalog: Catalog | null, addons: boolean): CatalogEntry[] {
  if (!catalog) return [];
  const list = catalog.products.map((p) => ({
    entry: { id: p.id, name: p.name, category: p.category ?? "Без категории", detail: p.sizes.map((x) => x.price).join(" · ") },
    rank: p.addon === addons ? 0 : 1,
  }));
  return list.sort((a, b) => a.rank - b.rank).map((x) => x.entry);
}

function linkedName(catalog: Catalog | null, link: CatalogLink | MilkLink | undefined): string | undefined {
  return isProductLinkOf(link) ? catalog?.products.find((p) => p.id === link.ref)?.name : undefined;
}

/** Подпись секции наверху списка — товар, с которым строка уже связана. */
const LINKED_SECTION = "Установлена связь";

/**
 * Связь строки с базой — кнопка в самом краю строки, перед «⋯». У связанной строки — синяя цепь,
 * у несвязанной иконка каталога видна при наведении. Список товаров открывается под кнопкой;
 * товар, с которым строка связана, стоит наверху в секции «Установлена связь» и на своём месте в группе.
 */
function CatalogButton({ entries, link, linkedId, linkedTo, onPick }: {
  entries: CatalogEntry[];
  link?: CatalogLink | MilkLink;
  linkedId?: string; // id строки списка, с которой связана позиция
  linkedTo?: string; // с чем связана строка
  onPick: (e: CatalogEntry) => void;
}) {
  const { catalog, error } = useCatalog();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [act, setAct] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  // строки списка: сначала связанный товар (если подходит под поиск), потом все по группам
  const found = useMemo(() => {
    const k = nameKey(q);
    const hits = entries.filter((p) => nameKey(p.name).includes(k));
    const linked = linkedId ? hits.find((p) => p.id === linkedId) : undefined;
    const rows = hits.map((p) => ({ ...p, key: p.id, section: p.category }));
    return linked ? [{ ...linked, key: `linked:${linked.id}`, section: LINKED_SECTION }, ...rows] : rows;
  }, [q, entries, linkedId]);
  const { mounted, closing } = usePresence(open);
  useFloating(mounted, btn, box, { gap: 2 });
  // фокус в поиск — после того как список встал на место, иначе браузер прокрутит панель к нему
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLInputElement>(".cat-q")?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${act}"]`)?.scrollIntoView({ block: "nearest" });
  }, [act]);

  const shut = () => {
    setOpen(false);
    btn.current?.focus();
  };
  const pick = (p: CatalogEntry) => {
    onPick(p);
    setOpen(false);
    // фокус — обратно на кнопку связи, как при Esc: поле названия ловить не нужно (рамка видна только с клавиатуры)
    btn.current?.focus({ preventScroll: true });
  };

  return (
    <span className="gt-link">
      <button
        ref={btn}
        className={`gt-cat${link ? (link.missing ? " missing" : " linked") : ""}`}
        tabIndex={-1}
        aria-label={link ? `Связано с базой${linkedTo ? `: ${linkedTo}` : ""}. Выбрать другой товар` : "Связать с базой товаров"}
        title={
          link?.missing
            ? "Товара или размера больше нет в базе — печатается последняя известная цена. Выберите товар заново или отвяжите строку"
            : link
              ? `Связано с базой${linkedTo ? `: ${linkedTo}` : ""}. Нажмите, чтобы выбрать другой товар`
              : "Связать с базой товаров"
        }
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setQ("");
          setAct(0);
          setOpen(!open);
        }}
      >
        <Icon name={link ? "link" : "link-plus"} size={16} />
      </button>
      {mounted &&
        createPortal(
        <div
          ref={box}
          className="cat floating"
          data-closing={closing || undefined}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") return shut();
            if (e.key === "Enter" && found[act]) return (e.preventDefault(), pick(found[act]));
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            if (found.length) setAct((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + found.length) % found.length);
          }}
        >
          <input
            className="cat-q"
            role="combobox"
            aria-expanded="true"
            aria-controls={id}
            aria-activedescendant={found[act] ? `${id}-${act}` : undefined}
            aria-label="Найти в базе товаров"
            placeholder="Найти в базе товаров"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setAct(0);
            }}
          />
          <ul ref={list} id={id} className="cat-list" role="listbox" aria-label="Товары">
            {found.map((p, i) => (
              <li key={p.key} role="presentation" className={p.section === LINKED_SECTION ? "cat-linked" : undefined}>
                {(i === 0 || found[i - 1].section !== p.section) && <div className="cat-cat">{p.section}</div>}
                <div
                  id={`${id}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === act}
                  className={`cat-opt ${i === act ? "on" : ""}`}
                  onPointerDown={(e) => e.preventDefault()}
                  onPointerMove={() => i !== act && setAct(i)}
                  onClick={() => pick(p)}
                >
                  <span className="cat-name">{p.name}</span>
                  {p.detail && <span className="cat-price">{p.detail}</span>}
                </div>
              </li>
            ))}
            {!found.length && <li className="cat-empty">{!catalog && !error ? "Загружаю базу товаров…" : "В базе такого нет"}</li>}
          </ul>
          <p className="cat-foot">{error ? `Не удалось загрузить: ${error}` : "Цены приходят из базы и меняются в админке, в «Каталог и касса»"}</p>
        </div>,
          document.body,
        )}
    </span>
  );
}
