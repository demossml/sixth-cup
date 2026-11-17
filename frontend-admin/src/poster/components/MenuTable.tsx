
import { useKeepOnScreen } from "./keepOnScreen";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, pointerWithin, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS, getEventCoordinates } from "@dnd-kit/utilities";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { isMilkLink, linkByNames, linkToMilk, linkToProduct, nameKey, unlink, type Catalog } from "@/lib/catalog";
import { useCatalog } from "@/lib/client/catalog";
import {
  addonJoins, groupAddons, menuFamily, splitAddons, syncSharedPrices, uid, variationPrices,
  type CatalogLink, type Group, type GroupStyle, type Item, type MenuDoc, type MilkLink, type Variation, type Workspace,
} from "@/lib/model";
import { focusCell, gridKeyDown } from "./gridNav";
import { Select } from "./Select";
import { useSweep, type Sweep } from "./sweep";
import { Icon, PriceInput } from "./ui";
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

/** Названия всех позиций и вариаций этого меню — чтобы отметить в каталоге то, что уже добавлено. */
const MenuNames = createContext<Set<string>>(new Set());

/** id строки, которую нужно сфокусировать после следующей отрисовки (новая позиция). */
let focusAfterRender: string | null = null;

type DragData = { type: "group" } | { type: "item"; groupId: string } | { type: "variation"; groupId: string; itemId: string } | { type: "body"; groupId: string };

const collision: CollisionDetection = (args) => {
  const a = args.active.data.current as DragData | undefined;
  const containers = args.droppableContainers.filter((c) => {
    const d = c.data.current as DragData | undefined;
    if (!a || !d) return false;
    if (a.type === "group") return d.type === "group";
    if (a.type === "variation") return d.type === "variation" && d.itemId === a.itemId;
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
  const [hint, setHint] = useState<{ id: string; after: boolean; groupId: string } | null>(null);
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
    if (a.type !== "item" || !o || !e.over) return setHint(null);
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
    if (a.type === "variation" && o.type === "variation") {
      update((w) => {
        const it = i$(w, a.groupId, a.itemId);
        const ids = it.variations.map((v) => v.id);
        it.variations = arrayMove(it.variations, ids.indexOf(String(act.id)), ids.indexOf(String(over.id)));
        syncSharedPrices(it);
      });
      return;
    }
    if (a.type !== "item" || (o.type !== "item" && o.type !== "body")) return;
    update((w) => {
      const from = g$(w, a.groupId);
      const to = g$(w, o.groupId);
      const idx = from.items.findIndex((i) => i.id === act.id);
      if (from === to) {
        if (o.type !== "item") return;
        from.items = arrayMove(from.items, idx, from.items.findIndex((i) => i.id === over.id));
        return;
      }
      const [moved] = from.items.splice(idx, 1);
      let at = o.type === "item" ? to.items.findIndex((i) => i.id === over.id) : to.items.length;
      if (o.type === "item" && h?.id === over.id && h.after) at += 1;
      to.items.splice(at, 0, moved);
      // ценники идут за позицией
      for (const d of w.documents) if (d.kind === "tag" && d.ref?.itemId === moved.id) d.ref.groupId = to.id;
    });
  };

  const addGroup = () => {
    const prev = [...groups].reverse().find((g) => g.style !== "addons");
    const id = uid("g");
    update((w) => {
      w.groups.push({ id, title: "Новая таблица", style: "section", columns: prev ? [...prev.columns] : ["1 шт"], items: [] });
      setGroupIds(w, (ids) => [...ids, id]);
    });
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

  const names = useMemo(() => new Set(groups.flatMap((g) => g.items.flatMap((it) => [it.name, ...it.variations.map((v) => v.name)])).map(nameKey)), [groups]);

  return (
    <MenuNames.Provider value={names}>
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
            <GroupTable
              key={g.id}
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
          ))}
        </SortableContext>
        {/* за курсором едет то, что взяли, — с того места, где взяли */}
        <DragOverlay dropAnimation={null}>{active?.lift && <Lifted lift={active.lift} />}</DragOverlay>
      </DndContext>
      <div className="mt-foot-actions">
        <button className="mt-add-group" onClick={addGroup}>
          <Icon name="plus" size={16} /> Таблица
        </button>
        {linkable > 0 && (
          <button className="mt-add-group" onClick={linkAll} title="Строки с тем же названием, что у товара в базе, получат цены из базы">
            <Icon name="catalog" size={16} /> Связать с базой по названиям: {linkable}
          </button>
        )}
      </div>
      <p className="mt-keys">
        <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> — по ячейкам, <kbd>Enter</kbd> — вниз, <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> — переставить строку. Строки
        перетаскиваются за <Icon name="grip" size={12} /> внутри таблицы и в другую таблицу.
      </p>
    </div>
    </MenuNames.Provider>
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

/** Сетка колонок: ручка | (цена добавки) | название | А | цены… | меню */
function gridStyle(g: Group): CSSProperties {
  return { ["--cols" as string]: g.style === "addons" ? 1 : g.columns.length };
}

function GroupTable({
  group: g, attachedTo, dropTarget, hint, drop, onDelete, onMove,
}: {
  group: Group; attachedTo?: string; dropTarget: boolean; hint: { id: string; after: boolean } | null; drop: "before" | "after" | null;
  canDelete: boolean; onDelete: () => void; onMove: (dir: 1 | -1) => void;
}) {
  const { ws, update, offerUndo } = useWs();
  const root = useRef<HTMLElement | null>(null);
  // добавочная таблица: строки отмечаются галочками, чтобы объединить их в группу с одной ценой или разделить
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const picked = pickedIds.filter((id) => g.items.some((it) => it.id === id));
  const setPick = (id: string, on: boolean) => setPickedIds((p) => (on ? (p.includes(id) ? p : [...p, id]) : p.filter((x) => x !== id)));
  const pick = useSweep((id) => picked.includes(id), setPick);
  // таблица при перетаскивании остаётся на месте (приглушённой), остальные не прыгают: место показывает линия
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useSortable({ id: g.id, data: { type: "group" } satisfies DragData });
  const { setNodeRef: setBodyRef } = useDroppable({ id: `body:${g.id}`, data: { type: "body", groupId: g.id } satisfies DragData });
  const titleRef = useRef<HTMLInputElement>(null);
  useFocusAfterRender(`title:${g.id}`, titleRef);
  const addons = g.style === "addons";
  const setG = (fn: (x: Group) => void) => update((w) => fn(g$(w, g.id)));

  const addItem = () => {
    const id = uid("i");
    setG((x) => x.items.push({ id, name: "", prices: (addons ? [null] : x.columns.map(() => null)), variations: [] }));
    focusAfterRender = `name:${id}`;
  };

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
    >
      <div className="gt-bar">
        <Select
          variant="quiet"
          className="gt-kind"
          label="Тип и вид таблицы"
          value={g.style}
          onChange={(v) => setG((x) => (x.style = v as GroupStyle))}
          options={KINDS.flatMap((k) => [{ group: k.label }, ...k.styles.map(([st, l]) => ({ value: st as string, label: l }))])}
        />
        {addons && picked.length > 0 ? (
          <span className="gt-picked" role="group" aria-label="Выбранные добавки">
            <span className="count">Выбрано {picked.length}</span>
            <button className="btn dark small" disabled={picked.length < 2} onClick={() => (setG((x) => groupAddons(x, picked)), setPickedIds([]))} title="Поставить подряд и дать одну цену: на листе — одной строкой через запятую">
              Объединить
            </button>
            <button className="btn small" onClick={() => (setG((x) => splitAddons(x, picked)), setPickedIds([]))} title="Печатать каждую своей строкой">
              Разделить
            </button>
            <button className="icon-btn small" onClick={() => setPickedIds([])} aria-label="Снять выбор">
              <Icon name="close" size={16} />
            </button>
          </span>
        ) : addons ? (
          <span className="gt-bar-note">{attachedTo ? `к «${attachedTo}» · ` : ""}соседние с одной ценой печатаются одной строкой</span>
        ) : (
          <button className="gt-coladd" disabled={g.columns.length >= MAX_COLUMNS} onClick={addColumn} title="Добавить колонку: объём стакана со своей ценой">
            <Icon name="plus" size={14} /> Объём
          </button>
        )}
      </div>
      <div className="gt-row gt-head" role="row" data-nav-row>
        <button className="gt-grip" ref={setActivatorNodeRef} {...attributes} {...listeners} tabIndex={-1} aria-label={`Перетащить группу «${g.title}»`}>
          <Icon name="grip" size={14} />
        </button>
        {addons && <span className="gt-colhead" role="columnheader">+₽</span>}
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

      <SortableContext items={g.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div ref={setBodyRef} role="rowgroup" className="gt-body">
          {g.items.map((it, k) => (
            <ItemRows
              key={it.id}
              group={g}
              item={it}
              index={k}
              hint={hint?.id === it.id ? (hint.after ? "after" : "before") : null}
              picked={picked.includes(it.id)}
              pick={pick}
            />
          ))}
          {g.items.length === 0 && <div className={`gt-empty ${dropTarget ? "on" : ""}`}>Перетащите сюда строку или добавьте новую</div>}
        </div>
      </SortableContext>
      <div className="gt-adds">
        <button className="gt-add" onClick={addItem}>
          <Icon name="plus" size={14} /> {addons ? "Добавка" : "Позиция"}
        </button>
      </div>
    </section>
  );
}

function ItemRows({
  group: g, item: it, index, hint, picked, pick,
}: {
  group: Group; item: Item; index: number; hint: "before" | "after" | null; picked: boolean;
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
  const table = g.style === "hero" || g.style === "section";
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

  const addVariation = () => {
    const id = uid("v");
    setItem((x) => x.variations.push({ id, name: "", prices: x.prices.map(() => null) }));
    focusAfterRender = `name:${id}`;
  };

  const price = (i: number) => (
    <PriceInput
      key={i}
      className="gt-price"
      nav={NAV.price + (addons ? 0 : i)}
      label={`${it.name || "Позиция"} ${cols[i]}`}
      value={it.prices[i] ?? null}
      locked={it.link ? DB_PRICE : undefined}
      onChange={(v) =>
        update((w) => {
          const gr = g$(w, g.id);
          const at = gr.items.findIndex((x) => x.id === it.id);
          if (addons) {
            // цена у группы одна: меняется у первой — меняется у всех, кто к ней присоединён
            let end = at + 1;
            while (end < gr.items.length && addonJoins(gr.items, end)) end++;
            if (!addonJoins(gr.items, at)) for (const m of gr.items.slice(at + 1, end)) m.prices[i] = v;
          }
          gr.items[at].prices[i] = v;
        })
      }
    />
  );

  return (
    <div
      ref={setNodeRef}
      data-drag-id={it.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`gt-item ${isDragging ? "dragging" : ""} ${hint ? `drop-${hint}` : ""} ${grouped ? "in-group" : ""} ${joined ? "joined" : ""}`}
    >
      <div className="gt-row" role="row" data-nav-row onKeyDown={moveRow} onPointerEnter={addons ? () => pick.over(it.id) : undefined}>
        <button className="gt-grip" ref={setActivatorNodeRef} {...attributes} {...listeners} tabIndex={-1} aria-label={`Перетащить «${it.name}»`}>
          <Icon name="grip" size={14} />
        </button>
        {addons && (
          <span className="gt-pick" role="cell" onPointerDown={(e) => pick.start(it.id, e)} onClick={() => pick.click(it.id)}>
            <input type="checkbox" data-nav={NAV.pick} tabIndex={-1} checked={picked} readOnly aria-label={`Выбрать «${it.name || "добавку"}», чтобы объединить или разделить`} />
          </span>
        )}
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
          {it.note && <sup className="gt-note">{it.note}</sup>}
          <input
            className="gt-note-in"
            data-nav={NAV.note}
            aria-label={`Текст сверху у «${it.name || "позиции"}»`}
            title="Мелкий текст сверху справа от названия, как «сверху» у «Корица, какао»"
            placeholder="текст сверху"
            value={it.note ?? ""}
            onChange={(e) => setItem((x) => (x.note = e.target.value || undefined))}
          />
          <CatalogButton
            entries={productEntries(catalog, addons)}
            link={it.link}
            linkedTo={linkedName(catalog, it.link)}
            onPick={(e) => {
              const p = catalog?.products.find((x) => x.id === e.id);
              if (p) setItem((x, gr) => ((x.name = p.name), linkToProduct(gr, x, p)));
            }}
          />
        </span>
        <AllergenCell on={!!it.allergen} onToggle={() => setItem((x) => (x.allergen = !x.allergen || undefined))} />
        {!addons && cols.map((_, i) => price(i))}
        <RowMenu label={`«${it.name || "Позиция"}»`}>
          {(close) => (
            <>
              {table && (
                <MenuItem icon="plus" onClick={() => (addVariation(), close())}>
                  Добавить вариацию
                </MenuItem>
              )}
              {it.link && (
                <MenuItem icon="catalog" onClick={() => (setItem((x) => unlink(x)), close())}>
                  Отвязать от базы
                </MenuItem>
              )}
              <label className="rm-field rm-note">
                <span>Текст сверху</span>
                <input className="text-input" value={it.note ?? ""} placeholder="напр. «сверху»" onChange={(e) => setItem((x) => (x.note = e.target.value || undefined))} />
              </label>
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
            <VariationRow key={v.id} group={g} item={it} v={v} index={vi} cols={cols} />
          ))}
        </SortableContext>
      )}
    </div>
  );
}

function VariationRow({ group: g, item: it, v, index, cols }: { group: Group; item: Item; v: Variation; index: number; cols: string[] }) {
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

  return (
    <div
      ref={setNodeRef}
      data-drag-id={v.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`gt-row gt-var ${shared ? "shared" : ""} ${grouped ? "in-group" : ""} ${isDragging ? "dragging" : ""}`}
      role="row"
      data-nav-row
      onKeyDown={(e) => {
        if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault();
        e.stopPropagation();
        const to = index + (e.key === "ArrowUp" ? -1 : 1);
        if (to < 0 || to >= it.variations.length) return;
        const focused = document.activeElement as HTMLElement | null;
        setV((_, item) => (item.variations = arrayMove(item.variations, index, to)));
        requestAnimationFrame(() => focused?.focus());
      }}
    >
      <button className="gt-grip small" ref={setActivatorNodeRef} {...attributes} {...listeners} tabIndex={-1} aria-label={`Перетащить «${v.name}»`}>
        <Icon name="grip" size={12} />
      </button>
      <span className="gt-name" role="cell">
        <input
          ref={nameRef}
          className="gt-input"
          data-nav={NAV.name}
          aria-label={`Вариация «${it.name}»`}
          placeholder="Вариация"
          value={v.name}
          onChange={(e) => setV((x) => (x.name = e.target.value))}
        />
        <CatalogButton
          entries={[
            ...(base?.milk ?? []).map((m) => ({ id: `m:${m.id}`, name: m.label, category: `Молоко для «${base!.name}»`, detail: m.surcharge ? `+${m.surcharge}` : "без доплаты" })),
            ...productEntries(catalog, false),
          ]}
          link={v.link}
          linkedTo={isMilkLink(v.link) ? base?.milk.find((m) => m.id === (v.link as MilkLink).milkId)?.label : linkedName(catalog, v.link)}
          onPick={(e) => {
            const milk = e.id.startsWith("m:") ? base?.milk.find((m) => `m:${m.id}` === e.id) : undefined;
            if (milk) return setV((x, item) => ((x.name = milk.label), linkToMilk(x, milk, item)));
            const p = catalog?.products.find((x) => x.id === e.id);
            if (p) setV((x) => ((x.name = p.name), linkToProduct(g, x, p))); // «Раф» + «Раф халва» печатается как «Раф халва»
          }}
        />
      </span>
      <AllergenCell on={!!v.allergen} onToggle={() => setV((x) => (x.allergen = !x.allergen || undefined))} />
      {shared ? (
        <button
          className="gt-shared"
          data-nav={NAV.price}
          tabIndex={-1}
          title="Та же цена, что у вариации выше: на листе они стоят одним блоком с одной ценой. Нажмите, чтобы задать свою."
          aria-label={`Цена общая с вариацией выше: ${cols.map((_, i) => blockPrices[i] ?? "—").join(", ")}. Задать свою цену`}
          onClick={() => setV((x) => (x.sharePrice = undefined))}
        >
          {cols.map((_, i) => (
            <span key={i}>{blockPrices[i] ?? "—"}</span>
          ))}
        </button>
      ) : (
        cols.map((c, i) => (
          <PriceInput key={i} className="gt-price" nav={NAV.price + i} label={`${v.name || "Вариация"} ${c}`} value={v.prices[i] ?? null} locked={v.link ? DB_PRICE : undefined} onChange={(val) => setV((x) => (x.prices[i] = val))} />
        ))
      )}
      <RowMenu label={`Вариация «${v.name || ""}»`}>
        {(close) => (
          <>
            {index > 0 && (
              <>
                <MenuItem checked={!!shared} onClick={() => (setV((x) => (x.sharePrice = !x.sharePrice || undefined)), close())}>
                  Цена общая с вариацией выше
                </MenuItem>
                <div className="rm-sep" role="separator" />
              </>
            )}
            {v.link && (
              <>
                <MenuItem icon="catalog" onClick={() => (setV((x) => unlink(x)), close())}>
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

function AllergenCell({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button className={`gt-allergen ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label="Аллерген" title="Метка «А» — аллерген" data-nav={NAV.allergen} tabIndex={-1} onClick={onToggle}>
      А
    </button>
  );
}

/**
 * Пункт меню «⋯»: слева слот 16 px под иконку, справа текст — у всех пунктов текст начинается с одной линии.
 * С checked пункт — переключатель: в слоте галочка, когда включён, и пусто, когда нет.
 */
function MenuItem({ icon, checked, danger, disabled, onClick, children }: {
  icon?: string; checked?: boolean; danger?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode;
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
        {toggle ? checked && <Icon name="check" size={16} /> : icon && <Icon name={icon} size={16} />}
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
  useKeepOnScreen(open, box);
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
      {open && (
        <div
          ref={box}
          className="rm-menu"
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
        </div>
      )}
    </span>
  );
}

const DB_PRICE = "Цена из базы sixth-cup — меняется в админке, в «Каталог и касса»";

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

function CatalogButton({ entries, link, linkedTo, onPick }: {
  entries: CatalogEntry[];
  link?: CatalogLink | MilkLink;
  linkedTo?: string; // с чем связана строка
  onPick: (e: CatalogEntry) => void;
}) {
  const { catalog, error } = useCatalog();
  const taken = useContext(MenuNames);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [act, setAct] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  const found = useMemo(() => {
    const k = nameKey(q);
    return entries.filter((p) => nameKey(p.name).includes(k));
  }, [q, entries]);
  useKeepOnScreen(open, box, [found.length]);
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
    btn.current?.closest(".gt-name")?.querySelector<HTMLInputElement>(".gt-input")?.focus();
  };

  return (
    <>
      <button
        ref={btn}
        className={`gt-cat${link ? (link.missing ? " missing" : " linked") : ""}`}
        tabIndex={-1}
        aria-label={link ? `Связано с базой${linkedTo ? `: ${linkedTo}` : ""}. Выбрать другой товар` : "Выбрать из базы товаров"}
        title={
          link?.missing
            ? "Товара или размера больше нет в базе — печатается последняя известная цена. Выберите товар заново или отвяжите строку"
            : link
              ? `Цена из базы${linkedTo ? `: ${linkedTo}` : ""}. Нажмите, чтобы выбрать другой товар`
              : "Выбрать из базы товаров"
        }
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setQ("");
          setAct(0);
          setOpen(!open);
        }}
      >
        <Icon name="catalog" size={16} />
      </button>
      {open && (
        <div
          ref={box}
          className="cat"
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
              <li key={p.id} role="presentation">
                {(i === 0 || found[i - 1].category !== p.category) && <div className="cat-cat">{p.category}</div>}
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
                  <span className="cat-check">
                    {taken.has(nameKey(p.name)) && (
                      <>
                        <Icon name="check" size={16} />
                        <span className="sr-only">есть в меню</span>
                      </>
                    )}
                  </span>
                  <span className="cat-name">{p.name}</span>
                  {p.detail && <span className="cat-price">{p.detail}</span>}
                </div>
              </li>
            ))}
            {!found.length && <li className="cat-empty">{!catalog && !error ? "Загружаю базу товаров…" : "В базе такого нет"}</li>}
          </ul>
          <p className="cat-foot">{error ? `Не удалось загрузить: ${error}` : "Цены приходят из базы и меняются в админке, в «Каталог и касса»"}</p>
        </div>
      )}
    </>
  );
}
