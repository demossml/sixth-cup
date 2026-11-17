
import { useState } from "react";
import { buildPdfs, downloadBytes } from "@/lib/client/export";
import {
  TAG_DESIGNS, cafeGroups, resolveTag, sameTemplate, sizeLabel, tagTemplates, uid, variationTitle,
  type Doc, type Size, type TagDesign, type TagDoc, type TagTemplate, type Workspace,
} from "@/lib/model";
import { Select } from "./Select";
import { DocPreview, DocStatus, Icon, Sheet, TextInput } from "./ui";
import { useWs } from "./WorkspaceProvider";

export const today = () => new Date().toISOString().slice(0, 10);

/** Новый ценник кафе, привязанный к первой позиции меню (или без привязки). */
export function newTag(ws: Workspace, cafeId: string): TagDoc {
  const g = cafeGroups(ws, cafeId).find((x) => x.items.length && x.style !== "addons");
  const it = g?.items[0];
  return {
    id: uid("d"), kind: "tag", cafeId, name: it?.name || "Новый ценник", size: { w: 90, h: 45 }, showInfo: true, date: today(),
    createdAt: new Date().toISOString(), ref: g && it ? { groupId: g.id, itemId: it.id, column: Math.max(0, it.prices.findIndex((p) => p != null)) } : undefined,
  };
}

/** Скачать PDF документа: для просмотра или для печати (с вылетами и метками реза). */
export function usePdfDownload() {
  const { ws, fb } = useWs();
  const [busy, setBusy] = useState(false);
  const download = async (doc: Doc, print: boolean) => {
    if (!fb) return;
    setBusy(true);
    try {
      const [pdf] = await buildPdfs(ws, [doc], fb, print);
      downloadBytes(pdf.bytes, print ? pdf.file : pdf.file.replace(/\.pdf$/, " (просмотр).pdf"), "application/pdf");
    } finally {
      setBusy(false);
    }
  };
  return { download, busy: busy || !fb };
}

export function TagEditor({ doc, onClose, onOpen }: { doc: TagDoc; onClose: () => void; onOpen: (id: string) => void }) {
  const { ws, update, fb, offerUndo } = useWs();
  const { download, busy } = usePdfDownload();
  const [copyFor, setCopyFor] = useState(false);
  const [newSize, setNewSize] = useState(false);
  const set = (fn: (d: TagDoc) => void) => update((w) => fn(w.documents.find((x) => x.id === doc.id) as TagDoc));
  const copies = ws.documents.filter((d) => d.copyOf === doc.id);
  const original = doc.copyOf ? ws.documents.find((d) => d.id === doc.copyOf) : undefined;
  const templates = tagTemplates(ws);
  const apply = (t: { size: Size; design: TagDesign }) => set((d) => ((d.size = { ...t.size }), (d.design = t.design === "classic" ? undefined : t.design)));

  const makeCopy = (t: TagTemplate) => {
    const id = uid("d");
    update((w) => {
      const src = w.documents.find((x) => x.id === doc.id)!;
      w.documents.push({
        ...structuredClone(src), id, size: { ...t.size }, design: t.design === "classic" ? undefined : t.design,
        copyOf: src.copyOf ?? src.id, lastSent: undefined, createdAt: new Date().toISOString(),
      } as Doc);
    });
    setCopyFor(false);
    onOpen(id);
  };

  return (
    <>
      <Sheet
        title="Ценник"
        // пока открыто окно нового размера, Esc закрывает его, а не ценник
        onClose={() => !newSize && onClose()}
        footer={
          <>
            <button className="btn" disabled={busy} onClick={() => download(doc, false)}>
              PDF для просмотра
            </button>
            <button className="btn dark" disabled={busy} onClick={() => download(doc, true)}>
              PDF для типографии
            </button>
          </>
        }
      >
        <div className="te">
          {/* картинка сверху, серое поле от края до края окна */}
          <div className="te-stage">
            <DocPreview ws={ws} doc={doc} fb={fb} showWarnings className="doc-preview big" />
            <DocStatus doc={doc} />
          </div>
          <div className="te-form">
            <TemplatePicker doc={doc} templates={templates} onPick={apply} onNew={() => setNewSize(true)} />
            <TagFields doc={doc} />
            <div className="field">
              <span>Копии под другие размеры</span>
              {original && (
                <button className="link" onClick={() => onOpen(original.id)}>
                  Это копия ценника {sizeLabel(original.size)} — открыть оригинал
                </button>
              )}
              {copies.length > 0 && (
                <div className="chips">
                  {copies.map((c) => (
                    <button key={c.id} className="chip" onClick={() => onOpen(c.id)}>
                      {sizeLabel(c.size)}
                    </button>
                  ))}
                </div>
              )}
              {copyFor ? (
                <div className="chips">
                  {templates
                    .filter((t) => !sameTemplate(t, doc))
                    .map((t) => (
                      <button key={t.id} className="chip" onClick={() => makeCopy(t)}>
                        {sizeLabel(t.size)}
                      </button>
                    ))}
                </div>
              ) : (
                <button className="link" onClick={() => setCopyFor(true)}>
                  + Копия под другой размер
                </button>
              )}
            </div>
            <button
              className="link danger"
              onClick={() => {
                offerUndo(`Ценник «${resolveTag(ws, doc).name}» удалён`, ws);
                update((w) => {
                  w.documents = w.documents.filter((x) => x.id !== doc.id).map((x) => (x.copyOf === doc.id ? { ...x, copyOf: undefined } : x));
                });
                onClose();
              }}
            >
              Удалить ценник
            </button>
          </div>
        </div>
      </Sheet>
      {newSize && (
        <NewSizeSheet
          doc={doc}
          onClose={() => setNewSize(false)}
          onAdd={(t) => {
            update((w) => {
              if (!tagTemplates(w).some((x) => sameTemplate(x, t))) (w.tagTemplates ??= []).push(t);
            });
            apply(t);
            setNewSize(false);
          }}
        />
      )}
    </>
  );
}

const MINI_MM = 1.15; // пикселей на миллиметр в миниатюрах: у всех шаблонов один масштаб — видно, какой больше

/**
 * Выбор шаблона ценника — размера вместе с дизайном. Ячейки с миниатюрами в одном масштабе:
 * выбранная обведена чёрным, остальные светло-серым. Последняя ячейка открывает окно нового размера.
 */
function TemplatePicker({ doc, templates, onPick, onNew }: { doc: TagDoc; templates: TagTemplate[]; onPick: (t: TagTemplate) => void; onNew: () => void }) {
  const { ws, fb } = useWs();
  // у ценника может быть размер, которого нет среди шаблонов (задан раньше вручную) — показываем и его
  const list = templates.some((t) => sameTemplate(t, doc)) ? templates : [...templates, { id: "own", size: doc.size, design: doc.design ?? "classic" } as TagTemplate];
  const tallest = Math.max(...list.map((t) => t.size.h));
  return (
    <div className="field">
      <span>Шаблон: размер и дизайн</span>
      <div className="tp" role="radiogroup" aria-label="Шаблон ценника">
        {list.map((t) => {
          const on = sameTemplate(t, doc);
          const design = TAG_DESIGNS[t.design];
          return (
            <button key={t.id} className={`tp-cell ${on ? "on" : ""}`} role="radio" aria-checked={on} onClick={() => onPick(t)}>
              <span className="tp-stage" style={{ height: tallest * MINI_MM }}>
                <span className="tp-mini" style={{ width: t.size.w * MINI_MM }}>
                  <DocPreview ws={ws} doc={{ ...doc, size: t.size, design: t.design === "classic" ? undefined : t.design }} fb={fb} className="tp-paper" />
                </span>
              </span>
              <span className="tp-size">
                {t.size.w}×{t.size.h}
              </span>
              {t.design !== "classic" && <span className="tp-design">{design.label}</span>}
            </button>
          );
        })}
        <button className="tp-cell tp-new" onClick={onNew}>
          <span className="tp-stage" style={{ height: tallest * MINI_MM }}>
            <Icon name="plus" size={22} />
          </span>
          <span className="tp-size">Свой размер</span>
        </button>
      </div>
    </div>
  );
}

/** Окно нового размера: пример ценника этого размера, ширина и высота, «Добавить размер». */
function NewSizeSheet({ doc, onClose, onAdd }: { doc: TagDoc; onClose: () => void; onAdd: (t: TagTemplate) => void }) {
  const { ws, fb } = useWs();
  const [w, setW] = useState(String(doc.size.w));
  const [h, setH] = useState(String(doc.size.h));
  const num = (v: string) => Math.round((Number(v.replace(",", ".")) || 0) * 10) / 10;
  const size = { w: num(w), h: num(h) };
  const ok = size.w >= 30 && size.w <= 1000 && size.h >= 20 && size.h <= 1000;
  const exists = tagTemplates(ws).some((t) => sameTemplate(t, { size, design: doc.design }));
  const add = () => ok && onAdd({ id: uid("t"), size, design: doc.design ?? "classic" });
  return (
    <Sheet
      title="Новый размер ценника"
      onClose={onClose}
      footer={
        <button className="btn primary" disabled={!ok} onClick={add}>
          {exists ? "Выбрать этот размер" : "Добавить размер"}
        </button>
      }
    >
      <form
        className="te"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="te-stage">
          {ok ? <DocPreview ws={ws} doc={{ ...doc, size }} fb={fb} showWarnings className="doc-preview big" /> : <p className="hint">Ширина от 30 мм, высота от 20 мм.</p>}
        </div>
        <div className="size-inputs">
          <label className="field">
            <span>Ширина, мм</span>
            <input className="text-input" inputMode="decimal" autoFocus value={w} onChange={(e) => setW(e.target.value)} />
          </label>
          <span className="size-x" aria-hidden>
            ×
          </span>
          <label className="field">
            <span>Высота, мм</span>
            <input className="text-input" inputMode="decimal" value={h} onChange={(e) => setH(e.target.value)} />
          </label>
        </div>
        <p className="hint">Размер появится среди шаблонов у всех ценников.</p>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

function TagFields({ doc }: { doc: TagDoc }) {
  const { ws, update } = useWs();
  const set = (fn: (d: TagDoc) => void) => update((w) => fn(w.documents.find((x) => x.id === doc.id) as TagDoc));
  const groups = cafeGroups(ws, doc.cafeId).filter((g) => g.items.length);
  const group = ws.groups.find((g) => g.id === doc.ref?.groupId);
  const item = group?.items.find((i) => i.id === doc.ref?.itemId);
  const r = resolveTag(ws, doc);

  return (
    <>
      <div className="field">
        <span>Позиция из меню — цена подставится сама</span>
        <Select
          label="Позиция из меню"
          value={doc.ref ? `${doc.ref.groupId}|${doc.ref.itemId}|${doc.ref.variationId ?? ""}` : ""}
          onChange={(value) =>
            set((d) => {
              if (!value) {
                d.ref = undefined;
                d.customName = d.customName || r.name;
                d.customPrice = d.customPrice ?? r.price;
                return;
              }
              const [groupId, itemId, variationId] = value.split("|");
              const it = ws.groups.find((g) => g.id === groupId)?.items.find((i) => i.id === itemId);
              d.ref = { groupId, itemId, variationId: variationId || undefined, column: 0 };
              const prices = variationId ? it?.variations.find((v) => v.id === variationId)?.prices : it?.prices;
              const first = prices?.findIndex((p) => p != null) ?? 0;
              d.ref.column = Math.max(0, first);
              const v = variationId ? it?.variations.find((x) => x.id === variationId) : undefined;
              if (it && (!d.name || d.name === r.name)) d.name = v ? variationTitle(it.name, v.name) : it.name;
            })
          }
          options={[
            { value: "", label: "Без привязки — своё название и цена" },
            ...groups.flatMap((g) => [
              { group: g.title },
              ...g.items.flatMap((it) => [
                { value: `${g.id}|${it.id}|`, label: it.name || "Без названия" },
                ...it.variations.map((v) => ({ value: `${g.id}|${it.id}|${v.id}`, label: `${it.name} · ${v.name || "вариация"}`, indent: true })),
              ]),
            ]),
          ]}
        />
        {r.broken && <p className="error">Позиция удалена из меню — выберите другую.</p>}
      </div>

      {doc.ref && group && item && group.columns.length > 1 && (
        <div className="field">
          <span>Объём на ценнике</span>
          <div className="chips">
            {group.columns.map((c, i) => {
              const prices = doc.ref!.variationId ? item.variations.find((v) => v.id === doc.ref!.variationId)?.prices : item.prices;
              const p = prices?.[i];
              return (
                <button key={i} className={`chip ${doc.ref!.column === i ? "on" : ""}`} disabled={p == null} onClick={() => set((d) => (d.ref!.column = i))}>
                  {c} · {p ?? "—"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <label className="field">
        <span>{doc.ref ? "Своё название (если нужно иначе, чем в меню)" : "Название"}</span>
        <TextInput label="Название на ценнике" placeholder={doc.ref ? r.name : "Название"} value={doc.customName ?? ""} onChange={(v) => set((d) => (d.customName = v || undefined))} />
      </label>
      {!doc.ref && (
        <label className="field">
          <span>Цена</span>
          <input
            className="text-input"
            inputMode="numeric"
            value={doc.customPrice ?? ""}
            onChange={(e) => set((d) => (d.customPrice = e.target.value.replace(/\D/g, "") ? Number(e.target.value.replace(/\D/g, "")) : null))}
          />
        </label>
      )}

      <label className="switch">
        <input type="checkbox" className="toggle" checked={doc.showInfo} onChange={(e) => set((d) => (d.showInfo = e.target.checked))} />
        <span>Блок «Изготовлено…» справа внизу</span>
      </label>
      {doc.showInfo && (
        <div className="row-wrap">
          <label className="field inline">
            <span>Дата изготовления</span>
            <input className="text-input" type="date" value={doc.date ?? ""} onChange={(e) => set((d) => (d.date = e.target.value || undefined))} />
          </label>
          <label className="field inline grow">
            <span>Производитель</span>
            <TextInput label="Производитель" placeholder={ws.brand.maker} value={doc.maker ?? ""} onChange={(v) => set((d) => (d.maker = v || undefined))} />
          </label>
        </div>
      )}
    </>
  );
}
