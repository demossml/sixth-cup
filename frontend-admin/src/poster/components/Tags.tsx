
import { useEffect, useMemo, useRef, useState } from "react";
import { printStatus, type PrintStatus } from "@/lib/fingerprint";
import { cafeGroups, findItem, resolveTag, sameTemplate, sizeLabel, tagTemplates, type TagDoc, type TagTemplate, type Workspace } from "@/lib/model";
import { CafeTitle, useCafe } from "./cafe";
import { gridKeyDown } from "./gridNav";
import { Select } from "./Select";
import { TagEditor, newTag } from "./TagEditor";
import { useSweep, type Sweep } from "./sweep";
import { DocPreview, DocStatus, Icon } from "./ui";
import { useWs } from "./WorkspaceProvider";

// Ценники кафе одной таблицей. Цена берётся из меню (одна база цен), размер меняется прямо в строке.
// Кафе выбирается в шапке; при «Все кафе» — по таблице на каждое кафе.

const NAV = { pick: 0, open: 1, size: 5, more: 30 };
const tplLabel = (t: TagTemplate) => sizeLabel(t.size);

type Filter = PrintStatus | "all";

/** Ценники кафе в порядке позиций меню; копии других размеров — сразу за оригиналом; без привязки — в конце. */
function cafeTags(ws: Workspace, cafeId: string): TagDoc[] {
  const order = new Map<string, number>();
  cafeGroups(ws, cafeId).forEach((g, gi) => g.items.forEach((it, ii) => order.set(it.id, gi * 1000 + ii)));
  const tags = ws.documents.filter((d): d is TagDoc => d.kind === "tag" && d.cafeId === cafeId);
  const rootOf = (t: TagDoc) => (t.copyOf && tags.find((x) => x.id === t.copyOf)) || t;
  const rank = (t: TagDoc) => {
    const r = rootOf(t);
    return [r.ref ? (order.get(r.ref.itemId) ?? 1e6) : 1e7, r.createdAt, t.copyOf ? 1 : 0, t.createdAt] as const;
  };
  return tags
    .map((t) => ({ t, k: rank(t) }))
    .sort((a, b) => (a.k[0] - b.k[0]) || a.k[1].localeCompare(b.k[1]) || (a.k[2] - b.k[2]) || a.k[3].localeCompare(b.k[3]))
    .map((x) => x.t);
}

export function Tags() {
  const { ws, update, offerUndo } = useWs();
  const { cafes } = useCafe();
  const many = cafes.length > 1;
  const [open, setOpen] = useState<string | null>(null);
  const [only, setOnly] = useState<Filter>("all");
  // выбранные галочками строки — к ним применяются групповые действия
  const [selIds, setSelIds] = useState<string[]>([]);
  const dateInput = useRef<HTMLInputElement>(null);
  // кнопка «+ Ценник» в шапке ушла под верхнюю панель — её копия встаёт в прилипшую строку фильтра
  const [addEl, setAddEl] = useState<HTMLButtonElement | null>(null);
  const [addHidden, setAddHidden] = useState(false);
  useEffect(() => {
    const el = addEl;
    if (!el) return setAddHidden(false);
    const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--top")) || 56;
    const io = new IntersectionObserver(([e]) => setAddHidden(!e.isIntersecting && e.boundingClientRect.top < top), { rootMargin: `-${top}px 0px 0px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [addEl]);

  const byCafe = useMemo(() => cafes.map((c) => ({ cafe: c, rows: cafeTags(ws, c.id) })), [ws, cafes]);
  const all = byCafe.flatMap((x) => x.rows);
  const counts = useMemo(() => {
    const c = { pending: 0, ordered: 0, ok: 0 };
    for (const x of byCafe) for (const t of x.rows) c[printStatus(ws, t)]++;
    return c;
  }, [byCafe, ws]);
  const opened = ws.documents.find((d): d is TagDoc => d.id === open && d.kind === "tag");
  const visible = (rows: TagDoc[]) => (only === "all" ? rows : rows.filter((t) => printStatus(ws, t) === only));
  const shownIds = byCafe.flatMap((x) => visible(x.rows).map((t) => t.id));
  const sel = selIds.filter((id) => shownIds.includes(id));
  const setPick = (id: string, on: boolean) => setSelIds((p) => (on ? (p.includes(id) ? p : [...p, id]) : p.filter((x) => x !== id)));
  const sweep = useSweep((id) => sel.includes(id), setPick);
  const templates = tagTemplates(ws);

  const create = (cafeId: string) => {
    const t = newTag(ws, cafeId);
    update((w) => void w.documents.push(t));
    setOpen(t.id);
  };
  const each = (fn: (t: TagDoc) => void) =>
    update((w) => {
      for (const d of w.documents) if (d.kind === "tag" && sel.includes(d.id)) fn(d);
    });
  const n = sel.length;
  const tagsWord = n % 10 === 1 && n % 100 !== 11 ? "ценник" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "ценника" : "ценников";

  return (
    <div className="tags">
      <header className="page-head">
        <h1 className="page-title">Ценники</h1>
        {!many && cafes[0] && (
          <div className="page-actions">
            <button ref={setAddEl} className="btn dark" onClick={() => create(cafes[0].id)}>
              <Icon name="plus" size={18} /> Ценник
            </button>
          </div>
        )}
      </header>

      {n > 0 ? (
        <div className="bulk" role="toolbar" aria-label="Действия с выбранными ценниками">
          <span className="bulk-n">
            Выбрано {n} {tagsWord}
          </span>
          <Select
            className="btn small bulk-size"
            variant="quiet"
            label="Изменить размер выбранных"
            value=""
            display="Изменить размер"
            onChange={(id) => {
              const t = templates.find((x) => x.id === id);
              if (t) each((d) => ((d.size = { ...t.size }), (d.design = t.design === "classic" ? undefined : t.design)));
            }}
            options={templates.map((t) => ({ value: t.id, label: `${tplLabel(t)} мм`, action: true }))}
          />
          <button className="btn small" onClick={() => (dateInput.current?.showPicker ? dateInput.current.showPicker() : dateInput.current?.focus())}>
            Изменить дату
          </button>
          <input
            ref={dateInput}
            className="bulk-date"
            type="date"
            tabIndex={-1}
            aria-label="Новая дата изготовления для выбранных"
            onChange={(e) => {
              const v = e.target.value;
              if (v) each((d) => ((d.date = v), (d.showInfo = true)));
              e.target.value = "";
            }}
          />
          <button
            className="btn small danger"
            onClick={() => {
              offerUndo(`Удалено: ${n} ${tagsWord}`, ws);
              update((w) => {
                w.documents = w.documents.filter((x) => !sel.includes(x.id)).map((x) => (x.copyOf && sel.includes(x.copyOf) ? { ...x, copyOf: undefined } : x));
              });
              setSelIds([]);
            }}
          >
            Удалить
          </button>
          <button className="icon-btn small bulk-close" onClick={() => setSelIds([])} aria-label="Снять выбор">
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : (
        all.length > 0 && (
          <div className="tags-bar">
            <div className="seg" role="group" aria-label="Фильтр по статусу">
              {(
                [
                  ["all", "Все", all.length],
                  ["pending", "Ожидают печати", counts.pending],
                  ["ordered", "Заказ отправлен", counts.ordered],
                ] as const
              ).map(([k, l, c]) => (
                <button key={k} aria-pressed={only === k} className={only === k ? "active" : ""} onClick={() => setOnly(k)}>
                  {l} <span className="count">{c}</span>
                </button>
              ))}
            </div>
            {!many && cafes[0] && (
              <button
                className={`btn dark small tags-bar-add ${addHidden ? "on" : ""}`}
                inert={!addHidden ? "" : undefined}
                aria-label="Ценник"
                onClick={() => create(cafes[0].id)}
              >
                <Icon name="plus" size={16} />
                <span className="tags-bar-add-text">Ценник</span>
              </button>
            )}
          </div>
        )
      )}

      {byCafe.map(({ cafe, rows }) => {
        const shown = visible(rows);
        return (
          <section key={cafe.id} className="cafe-block">
            {many && (
              <header className="cafe-head">
                <h2>
                  <CafeTitle cafe={cafe} />
                </h2>
                <span className="cafe-head-actions">
                  <button className="btn plain small" onClick={() => create(cafe.id)}>
                    <Icon name="plus" size={16} /> Ценник
                  </button>
                </span>
              </header>
            )}
            {shown.length === 0 ? (
              <p className={many ? "hint" : "empty"}>{rows.length ? "Таких ценников нет." : "Ценников пока нет. Нажмите «+ Ценник», чтобы сделать первый."}</p>
            ) : (
              <TagTable
                rows={shown}
                onOpen={setOpen}
                sel={sel}
                sweep={sweep}
                onAll={(on) => setSelIds((p) => (on ? [...new Set([...p, ...shown.map((t) => t.id)])] : p.filter((id) => !shown.some((t) => t.id === id))))}
              />
            )}
          </section>
        );
      })}

      {opened && <TagEditor key={opened.id} doc={opened} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}

function TagTable({ rows: shown, onOpen: setOpen, sel, sweep, onAll }: { rows: TagDoc[]; onOpen: (id: string) => void; sel: string[]; sweep: Sweep; onAll: (on: boolean) => void }) {
  const { ws, update, fb } = useWs();
  const templates = tagTemplates(ws);
  const allOn = shown.every((t) => sel.includes(t.id));
  return (
    <div className="tt" role="table" aria-label="Ценники" onKeyDown={gridKeyDown}>
      <div className="tt-row tt-head" role="row">
        <span role="columnheader" className="tt-check">
          <input type="checkbox" checked={allOn} onChange={() => onAll(!allOn)} aria-label={allOn ? "Снять выбор со всех" : "Выбрать все"} />
        </span>
        <span role="columnheader" className="tt-thumb-h">
          <span className="sr-only">Превью</span>
        </span>
        <span role="columnheader" className="tt-name">Товар</span>
        <span role="columnheader" className="tt-num">Цена из меню</span>
        <span role="columnheader" className="tt-sizecell">Размер, мм</span>
        <span role="columnheader" className="tt-status">Статус</span>
      </div>
      {shown.map((t) => {
        const r = resolveTag(ws, t);
        const group = t.ref ? findItem(ws, t.ref.groupId, t.ref.itemId).group : undefined;
        const tpl = templates.find((x) => sameTemplate(x, t));
        const on = sel.includes(t.id);
        return (
          <div key={t.id} className={`tt-row ${t.copyOf ? "copy" : ""} ${on ? "picked" : ""}`} role="row" data-nav-row onPointerEnter={() => sweep.over(t.id)}>
            <span role="cell" className="tt-check" onPointerDown={(e) => sweep.start(t.id, e)} onClick={() => sweep.click(t.id)}>
              <input type="checkbox" data-nav={NAV.pick} tabIndex={-1} checked={on} readOnly aria-label={`Выбрать ценник «${r.name}»`} />
            </span>
            <button className="tt-thumb" tabIndex={-1} onClick={() => setOpen(t.id)} aria-label={`Открыть ценник «${r.name}»`}>
              <DocPreview ws={ws} doc={t} fb={fb} className="mini" />
            </button>
            <span role="cell" className="tt-name">
              <button className="tt-open" data-nav={NAV.open} onClick={() => setOpen(t.id)}>
                {r.name}
              </button>
              <span className="muted">
                {r.broken ? <span className="error-text">позиция удалена из меню</span> : group ? group.title : "своя цена"}
                {r.volume ? ` · ${r.volume}` : ""}
                {t.copyOf ? " · копия" : ""}
              </span>
            </span>
            <span role="cell" className="tt-num">
              {r.price ?? "—"}
            </span>
            <span role="cell" className="tt-sizecell">
              <Select
                variant="quiet"
                className="tt-size"
                nav={NAV.size}
                arrowsOpen={false}
                label={`Размер ценника «${r.name}»`}
                value={tpl?.id ?? "custom"}
                onChange={(v) => {
                  if (v === "custom") return setOpen(t.id);
                  const p = templates.find((x) => x.id === v);
                  if (p)
                    update((w) => {
                      const d = w.documents.find((x) => x.id === t.id) as TagDoc;
                      d.size = { ...p.size };
                      d.design = p.design === "classic" ? undefined : p.design;
                    });
                }}
                options={[
                  ...templates.map((p) => ({ value: p.id, label: tplLabel(p) })),
                  tpl ? { value: "custom", label: "Свой размер…", action: true } : { value: "custom", label: `${sizeLabel(t.size)} (свой)` },
                ]}
              />
            </span>
            <span role="cell" className="tt-status">
              <DocStatus doc={t} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
