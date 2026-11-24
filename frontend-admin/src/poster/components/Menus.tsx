
import { useKeepOnScreen } from "./keepOnScreen";
import { usePresence } from "./presence";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { docDue, printCount, printCountLabel, printStatus, type PrintStatus } from "@/lib/fingerprint";
import { useCatalog } from "@/lib/client/catalog";
import { createFromTemplate, menuTemplates, templatePreview, type MenuTemplate } from "@/lib/templates";
import { SIZE_PRESETS, cafeLabel, cafeMenus, deepCopyMenu, menuFamily, removeFormat, removeMenu, sizeLabel, uid, type MenuDoc, type Size } from "@/lib/model";
import { ALL, CafeTitle, useCafe } from "./cafe";
import { MenuCanvas } from "./MenuCanvas";
import { MenuTables } from "./MenuTable";
import { Select } from "./Select";
import { layoutDoc } from "@/lib/client/export";
import { usePdfDownload } from "./TagEditor";
import { tilt } from "./tilt";
import { DocPreview, DocStatus, Icon, Sheet, Status, useClosing } from "./ui";
import { useWs } from "./WorkspaceProvider";

// Меню кафе: список → просмотр (изменить, копия, удалить) → редактирование таблицами.

export type Go = (path: string) => void;

const worst = (s: PrintStatus[]): PrintStatus => (s.includes("pending") ? "pending" : s.includes("ordered") ? "ordered" : "ok");

export function Menus({ route, go }: { route: string[]; go: Go }) {
  const { ws } = useWs();
  const [, id, mode] = route;
  const doc = ws.documents.find((d): d is MenuDoc => d.id === id && d.kind === "menu");
  if (doc && mode === "edit") return <MenuEdit key={doc.id} doc={doc} go={go} />;
  // меню открывается окном поверх списка; адрес #menu/<id> остаётся — на окно можно дать ссылку, «назад» его закрывает
  return (
    <>
      <MenuList go={go} />
      {doc && <MenuModal key={doc.id} doc={doc} go={go} />}
    </>
  );
}

function MenuList({ go }: { go: Go }) {
  const { ws, fb } = useWs();
  const { cafes } = useCafe();
  const many = cafes.length > 1;
  const [picking, setPicking] = useState(false);
  return (
    <div className="menus">
      <header className="page-head">
        <h1 className="page-title">Меню</h1>
        <div className="page-actions">
          <button className="btn dark" onClick={() => setPicking(true)}>
            <Icon name="plus" size={18} /> Создать меню
          </button>
        </div>
      </header>
      {cafes.map((cafe) => {
        const menus = cafeMenus(ws, cafe.id);
        return (
          <section key={cafe.id} className="cafe-block">
            {many && (
              <header className="cafe-head">
                <h2>
                  <CafeTitle cafe={cafe} />
                </h2>
              </header>
            )}
            {menus.length === 0 ? (
              <p className="hint">В этом кафе пока нет меню. Нажмите «Создать меню» и выберите шаблон.</p>
            ) : (
              <ul className="menu-grid">
                {menus.map((d) => {
                  const fam = menuFamily(ws, d);
                  const first = fam.find((x) => printStatus(ws, x) === "pending") ?? d;
                  return (
                    <li key={d.id}>
                      <a className="menu-card" href={`#menu/${d.id}`} {...tilt}>
                        <DocPreview ws={ws} doc={d} fb={fb} className="thumb" />
                        <span className="menu-card-name">{d.name}</span>
                        <span className="menu-card-meta">
                          <span className="muted">{fam.map((x) => sizeLabel(x.size)).join(" · ")}</span>
                          <Status
                            s={worst(fam.map((x) => printStatus(ws, x)))}
                            updated={fam.some((x) => !!x.lastSent && printStatus(ws, x) === "pending")}
                            due={docDue(ws, first)}
                          />
                        </span>
                        <span className="menu-card-meta muted">
                          {printCountLabel(
                            printCount(
                              ws,
                              fam.map((x) => x.id),
                            ),
                          )}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
      {picking && <TemplatePickerScreen go={go} onClose={() => setPicking(false)} />}
    </div>
  );
}

/** Окно на весь экран: с какого шаблона начать новое меню. У шаблонов нет названий — формат, размер и сколько раз печатали меню из него. */
function TemplatePickerScreen({ go, onClose }: { go: Go; onClose: () => void }) {
  const { ws, fb, update } = useWs();
  const { cafes } = useCafe();
  const { catalog } = useCatalog();
  const [target, setTarget] = useState(cafes[0]?.id ?? "");
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [closing, close] = useClosing(onClose);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    document.body.classList.add("sheet-open");
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => {
      document.body.classList.remove("sheet-open");
      window.removeEventListener("keydown", esc);
      back?.focus();
    };
  }, [close]);
  const create = (t: MenuTemplate) => {
    let id = "";
    update((w) => {
      id = createFromTemplate(w, t, target || cafes[0].id, catalog);
    });
    onClose();
    go(`menu/${id}/edit`);
  };
  return (
    // вокруг окна поля: клик мимо него закрывает
    <div className={`tpl-backdrop${closing ? " closing" : ""}`} onClick={close}>
      <div className="viewer tpl-screen" role="dialog" aria-modal="true" aria-label="Создать меню: выбор шаблона" onClick={(e) => e.stopPropagation()}>
        <header className="viewer-head">
          <div className="viewer-title">
            <b>Создать меню</b>
            <span className="muted">Выберите шаблон — откроется редактор</span>
          </div>
          {cafes.length > 1 && (
            <label className="tpl-cafe">
              <span className="muted">Для кафе</span>
              <Select variant="quiet" value={target || cafes[0].id} onChange={setTarget} options={cafes.map((c) => ({ value: c.id, label: cafeLabel(c) }))} />
            </label>
          )}
          <button ref={closeBtn} className="icon-btn" onClick={close} aria-label="Закрыть">
            <Icon name="close" />
          </button>
        </header>
        <div className="tpl-body">
          <ul className="menu-grid">
            {menuTemplates().map((t) => {
              const p = templatePreview(ws, t, catalog);
              const made = ws.documents.filter((d) => d.kind === "menu" && d.template === t.id).map((d) => d.id);
              return (
                <li key={t.id}>
                  <button
                    className="menu-card"
                    {...tilt}
                    onClick={() => create(t)}
                    aria-label={`Шаблон ${sizeLabel(t.size)}, ${t.groups.some((g) => g.items.length) ? "с таблицами" : "пустой лист"}`}
                  >
                    <DocPreview ws={p.ws} doc={p.doc} fb={fb} className="thumb" />
                    <span className="menu-card-meta">
                      <span className="tpl-size">{sizeLabel(t.size)}</span>
                      <span className="muted">
                        {t.size.w}×{t.size.h} мм
                      </span>
                    </span>
                    <span className="menu-card-meta muted">{printCountLabel(printCount(ws, made))}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * Окно меню, разложенное по смыслам: что это за меню → какой лист смотрим → что с меню сделать → удаление отдельно.
 * На компьютере — «Инспектор»: лист слева, справа колонка с подписанными разделами. На телефоне — «Полоса»:
 * лист во весь экран, внизу панель в три строки. Решение и отклонённые варианты — docs/ui-decisions.md.
 * Поля принтера здесь не показываются: это инструмент редактора.
 */
function MenuModal({ doc, go }: { doc: MenuDoc; go: Go }) {
  const { ws, fb, update, offerUndo } = useWs();
  const { download, busy } = usePdfDownload();
  const wide = useWide();
  const [copySheet, setCopySheet] = useState(false);
  const family = menuFamily(ws, doc);
  const root = family.find((d) => !d.copyOf) ?? doc;
  const freePresets = SIZE_PRESETS.filter((p) => p.kind === "menu" && !family.some((d) => d.size.w === p.size.w && d.size.h === p.size.h));
  const [closing, close] = useClosing(() => go("menu"));
  const edit = () => go(`menu/${doc.id}/edit`);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeBtn.current?.focus();
    document.body.classList.add("sheet-open");
    return () => document.body.classList.remove("sheet-open");
  }, [wide]);
  useEffect(() => {
    // пока открыто окно копии, Esc закрывает его, а не меню
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !copySheet && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [copySheet, close]);

  const addSize = (size: Size) => {
    const id = uid("d");
    update((w) => {
      const r = w.documents.find((x) => x.id === root.id) as MenuDoc;
      w.documents.push({ ...structuredClone(r), id, size: { ...size }, copyOf: r.id, lastSent: undefined, createdAt: new Date().toISOString() });
    });
    go(`menu/${id}`);
  };
  // убрать один формат — любой, и основной тоже: тогда основным становится следующий
  const dropFormat = (d: MenuDoc) => {
    offerUndo(`Формат ${sizeLabel(d.size)} убран`, ws);
    let next: MenuDoc | null = null;
    update((w) => {
      next = removeFormat(w, w.documents.find((x) => x.id === d.id) as MenuDoc);
    });
    if (next) go(`menu/${(next as MenuDoc).id}`);
  };
  // удалить меню целиком — со всеми форматами
  const removeAll = () => {
    offerUndo(`Меню «${root.name}» удалено`, ws);
    update((w) => removeMenu(w, w.documents.find((x) => x.id === root.id) as MenuDoc));
    go("menu");
  };

  const scene = useMemo(() => (fb ? layoutDoc(ws, doc, fb) : null), [ws, doc, fb]);
  const fitNote = scene?.fit && scene.fit < 1 ? `Текст уменьшен до ${Math.round(scene.fit * 100)} %` : "";
  const notes = scene?.warnings ?? [];
  const prints = printCountLabel(printCount(ws, family.map((x) => x.id)));
  // клик мимо панели и листа закрывает окно
  const outside = (e: React.MouseEvent) => e.target === e.currentTarget && close();

  const addFormat = (display: React.ReactNode, className: string) =>
    freePresets.length > 0 && (
      <Select
        variant="quiet"
        className={className}
        label="Добавить формат листа"
        value=""
        display={display}
        onChange={(v) => {
          const p = freePresets.find((x) => x.label === v);
          if (p) addSize(p.size);
        }}
        options={[{ group: "То же меню на другой бумаге" }, ...freePresets.map((p) => ({ value: p.label, label: p.label, hint: `${p.size.w}×${p.size.h} мм`, action: true }))]}
      />
    );
  const paper = (
    <div className="mm-paper" onClick={outside}>
      <DocPreview ws={ws} doc={doc} fb={fb} showWarnings plain noMargins className="doc-preview big" />
    </div>
  );
  const copySheetEl = copySheet && <CopySheet doc={root} go={go} onClose={() => setCopySheet(false)} />;

  if (wide)
    return (
      <>
        <div className={`mm-backdrop${closing ? " closing" : ""}`} onClick={outside}>
          <div className="mm-insp" role="dialog" aria-modal="true" aria-label={`Меню «${root.name}»`} onClick={outside}>
            {paper}
            <aside className="mm-side">
              <header className="mm-side-head">
                <div className="mm-side-id">
                  <h2 className="mm-side-title">{root.name}</h2>
                  <p className="mm-meta">
                    <DocStatus doc={doc} />
                    <span>{prints}</span>
                  </p>
                </div>
                <button ref={closeBtn} className="icon-btn" onClick={close} aria-label="Закрыть" title="Закрыть">
                  <Icon name="close" size={20} />
                </button>
              </header>

              <div className="mm-side-acts">
                <button className="btn dark block" onClick={edit}>
                  <Icon name="edit" size={18} /> Редактировать
                </button>
                <button className="btn block" onClick={() => setCopySheet(true)}>
                  <Icon name="copy" size={18} /> Копия и редактировать
                </button>
              </div>

              <section className="mm-sec" aria-label="Лист">
                <h3 className="label">Лист</h3>
                <ul className="mm-rows">
                  {family.map((d) => {
                    const on = d.id === doc.id;
                    return (
                      <li key={d.id} className={`mm-row ${on ? "on" : ""}`}>
                        <button className="mm-row-main" aria-pressed={on} onClick={() => go(`menu/${d.id}`)} title={`Показать это меню на листе ${sizeLabel(d.size)}`}>
                          {/* место под галочку есть у каждой строки — названия стоят на одной линии с «Добавить формат» */}
                          <span className="mm-row-mark">{on && <Icon name="check" size={16} />}</span>
                          <span className="mm-row-name">{sizeLabel(d.size)}</span>
                          <span className="mm-row-hint">
                            {d.size.w}×{d.size.h} мм
                          </span>
                        </button>
                        {family.length > 1 && (
                          <button className="mm-row-x" onClick={() => dropFormat(d)} aria-label={`Убрать формат ${sizeLabel(d.size)}`} title={`Убрать формат ${sizeLabel(d.size)}`}>
                            <Icon name="close" size={16} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {addFormat(
                  <>
                    <Icon name="plus" size={16} /> Добавить формат
                  </>,
                  "mm-row-add",
                )}
                {(fitNote || notes.length > 0) && (
                  <ul className="mm-warns" role="status">
                    {fitNote && <li>{fitNote}, чтобы меню поместилось на лист</li>}
                    {notes.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="mm-sec" aria-label="Скачать">
                <h3 className="label">Скачать</h3>
                <button className="mm-dl" disabled={busy} onClick={() => download(doc, false)}>
                  <Icon name="download" size={20} />
                  <span>
                    <b>Для принтера</b>
                    <span>Ровно в размер листа, без вылетов</span>
                  </span>
                </button>
                <button className="mm-dl" disabled={busy} onClick={() => download(doc, true)}>
                  <Icon name="download" size={20} />
                  <span>
                    <b>Для типографии</b>
                    <span>С вылетами 3 мм и метками реза</span>
                  </span>
                </button>
              </section>

              <footer className="mm-side-foot">
                <button className="link danger" onClick={removeAll}>
                  <Icon name="trash" size={16} /> Удалить меню
                </button>
              </footer>
            </aside>
          </div>
        </div>
        {copySheetEl}
      </>
    );

  return (
    <>
      <div className={`mm-backdrop${closing ? " closing" : ""}`} onClick={outside}>
        <div className="mm" role="dialog" aria-modal="true" aria-label={`Меню «${root.name}»`} onClick={outside}>
          <button ref={closeBtn} className="mm-x" onClick={close} aria-label="Закрыть">
            <Icon name="close" size={40} />
          </button>
          {paper}
          {(fitNote || notes.length > 0) && (
            <ul className="mm-notes" role="status">
              {fitNote && <li>{fitNote}</li>}
              {notes.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          <footer className="mm-dock">
            <div className="mm-dock-id">
              <h2 className="mm-dock-title">{root.name}</h2>
              <p className="mm-meta">
                <DocStatus doc={doc} />
                <span>{prints}</span>
              </p>
            </div>
            {/* форматы — только выбор; убрать формат и удалить меню — в «⋯» */}
            <div className="mm-seg" role="group" aria-label="Формат листа">
              {family.map((d) => (
                <button key={d.id} className={d.id === doc.id ? "on" : ""} aria-pressed={d.id === doc.id} onClick={() => go(`menu/${d.id}`)}>
                  {sizeLabel(d.size)}
                </button>
              ))}
              {addFormat(
                <>
                  <Icon name="plus" size={16} /> Формат
                </>,
                "mm-seg-add",
              )}
            </div>
            <div className="mm-dock-acts">
              <button className="btn dark mm-edit" onClick={edit}>
                <Icon name="edit" size={18} /> Редактировать
              </button>
              <button className="act" onClick={() => setCopySheet(true)} aria-label="Копия и редактировать" title="Копия и редактировать">
                <Icon name="copy" size={20} />
              </button>
              <PopMenu
                label="Скачать PDF"
                trigger={(open, toggle, ref) => (
                  <button ref={ref} className="act mm-pdf" aria-haspopup="menu" aria-expanded={open} onClick={toggle} aria-label="Скачать PDF" title="Скачать PDF">
                    <Icon name="download" size={20} /> <span className="mm-pdf-label">PDF</span>
                  </button>
                )}
              >
                {(shut) => (
                  <>
                    <button role="menuitem" disabled={busy} onClick={() => (download(doc, false), shut())}>
                      <b>Для принтера</b>
                      <span>Ровно в размер листа, без вылетов</span>
                    </button>
                    <button role="menuitem" disabled={busy} onClick={() => (download(doc, true), shut())}>
                      <b>Для типографии</b>
                      <span>С вылетами 3 мм и метками реза</span>
                    </button>
                  </>
                )}
              </PopMenu>
              <PopMenu
                label="Ещё"
                trigger={(open, toggle, ref) => (
                  <button ref={ref} className="act" aria-haspopup="menu" aria-expanded={open} onClick={toggle} aria-label="Ещё" title="Ещё">
                    <Icon name="more" size={20} />
                  </button>
                )}
              >
                {(shut) => (
                  <>
                    {family.length > 1 && (
                      <button role="menuitem" onClick={() => (shut(), dropFormat(doc))}>
                        <b>Убрать формат {sizeLabel(doc.size)}</b>
                        <span>Остальные форматы этого меню останутся</span>
                      </button>
                    )}
                    <button role="menuitem" className="danger" onClick={() => (shut(), removeAll())}>
                      <b>Удалить меню</b>
                      <span>{family.length > 1 ? `Со всеми форматами (${family.length}). ` : ""}Можно отменить</span>
                    </button>
                  </>
                )}
              </PopMenu>
            </div>
          </footer>
        </div>
      </div>
      {copySheetEl}
    </>
  );
}

/** Меню у кнопки, открывается вверх (кнопки стоят внизу экрана). Esc и клик мимо закрывают, фокус возвращается на кнопку. */
function PopMenu({ label, trigger, children }: {
  label: string;
  trigger: (open: boolean, toggle: () => void, ref: React.RefObject<HTMLButtonElement>) => React.ReactNode;
  children: (shut: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const { mounted, closing } = usePresence(open);
  useKeepOnScreen(open, box);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);
  const shut = () => {
    setOpen(false);
    btn.current?.focus();
  };
  return (
    <span className="mm-pop-wrap">
      {trigger(open, () => setOpen(!open), btn)}
      {mounted && (
        <div
          ref={box}
          className="mm-pop"
          data-closing={closing || undefined}
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              return shut();
            }
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const items = [...(box.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
            const i = items.indexOf(document.activeElement as HTMLElement);
            items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          }}
        >
          {children(shut)}
        </div>
      )}
    </span>
  );
}

function CopySheet({ doc, go, onClose }: { doc: MenuDoc; go: Go; onClose: () => void }) {
  const { ws, update } = useWs();
  const { scope, setScope } = useCafe();
  const [name, setName] = useState(`${doc.name} (копия)`);
  const [target, setTarget] = useState(doc.cafeId);
  const make = () => {
    let id = "";
    update((w) => {
      id = deepCopyMenu(w, doc, target, name.trim() || doc.name);
    });
    if (scope !== ALL && target !== scope) setScope(target);
    onClose();
    go(`menu/${id}/edit`);
  };
  return (
    <Sheet
      title="Копия меню"
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={make}>
          Создать и изменить
        </button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          make();
        }}
      >
        <label className="field">
          <span>Название</span>
          <input className="text-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {ws.cafes.length > 1 && (
          <label className="field">
            <span>Кафе</span>
            <Select value={target} onChange={setTarget} options={ws.cafes.map((c) => ({ value: c.id, label: cafeLabel(c) }))} />
          </label>
        )}
        <p className="hint">Копия независима от оригинала: цены и позиции в ней меняются отдельно, ценники остаются у оригинала.</p>
      </form>
    </Sheet>
  );
}

const SPLIT_KEY = "m67.editSplit";
const SPLIT_MIN = 340;
const PANEL_KEY = "m67.editPanel";

// широкий экран — панель слева рядом с холстом; узкий — та же панель шторкой снизу поверх листа
const WIDE = "(min-width: 960px)";
const subscribeWide = (cb: () => void) => {
  const m = matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const useWide = () =>
  useSyncExternalStore(
    subscribeWide,
    () => matchMedia(WIDE).matches,
    () => true,
  );

type Drag = { y0: number; base: number; max: number; y: number; t: number; v: number; moved: boolean };

/**
 * Редактор листа — во всё окно, без навигации приложения. Название, «Закрыть» и «Сохранить» живут в панели
 * с таблицами. На широком экране панель слева: её ширину можно менять, а саму панель — свернуть в плашку
 * на холсте. На телефоне лист занимает весь экран, а панель — шторка снизу: её вытягивают поверх листа,
 * правят таблицы и опускают обратно, чтобы посмотреть, что получилось.
 * Правки сохраняются по ходу, но это черновик: «Сохранить» оставляет их, «Закрыть» спрашивает и может вернуть
 * меню к тому виду, каким оно было при открытии.
 */
function MenuEdit({ doc, go }: { doc: MenuDoc; go: Go }) {
  const { ws, update } = useWs();
  const root = doc.copyOf ? ((ws.documents.find((d) => d.id === doc.copyOf) as MenuDoc | undefined) ?? doc) : doc;
  const cafe = ws.cafes.find((c) => c.id === doc.cafeId);
  const wide = useWide();

  // каким меню было при открытии — чтобы «Закрыть» могло не сохранять правки
  const snapshot = () => ({ groups: structuredClone(ws.groups), documents: structuredClone(ws.documents), key: JSON.stringify([ws.groups, ws.documents]) });
  const [entry, setEntry] = useState(snapshot);
  // «Сохранить» не закрывает редактор: текущий вид становится тем, к которому вернёт «Не сохранять»
  const keep = () => setEntry(snapshot());
  const dirty = useMemo(() => JSON.stringify([ws.groups, ws.documents]) !== entry.key, [ws.groups, ws.documents, entry.key]);
  // куда уйти из редактора: по «Закрыть» — к просмотру меню, из меню ☰ — в раздел приложения
  const [ask, setAsk] = useState<string | null>(null);
  const home = `menu/${doc.id}`;
  const leave = () => go(ask ?? home);
  const close = (to = home) => (dirty ? setAsk(to) : go(to));
  const discard = () => {
    update((w) => {
      w.groups = structuredClone(entry.groups);
      w.documents = structuredClone(entry.documents);
    });
    leave();
  };

  // широкий экран: панель свёрнута в плашку на холсте (запоминается)
  const [collapsed, setCollapsedState] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) === "collapsed";
    } catch {
      return false;
    }
  });
  // свернуть / выдвинуть: на время анимации панель держит свою ширину (колонка сжимается, панель не перестраивается)
  const [anim, setAnim] = useState(false);
  const [sideW, setSideW] = useState<number | null>(null);
  const animT = useRef<number>();
  useEffect(() => () => window.clearTimeout(animT.current), []);
  const setCollapsed = (v: boolean) => {
    const lw = layout.current?.clientWidth ?? 1200;
    setSideW(v ? (side.current?.getBoundingClientRect().width ?? null) : Math.min(split ?? Math.min(lw * 0.5, 720), lw - 320));
    setAnim(true);
    window.clearTimeout(animT.current);
    animT.current = window.setTimeout(() => setAnim(false), 340);
    setCollapsedState(v);
    try {
      if (v) localStorage.setItem(PANEL_KEY, "collapsed");
      else localStorage.removeItem(PANEL_KEY);
    } catch {}
  };
  const folded = wide && collapsed;

  // телефон: шторка вытянута или опущена
  const [open, setOpen] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const dragged = useRef(false);

  useEffect(() => {
    if (wide || !open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".sheet-backdrop") && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [wide, open]);

  // кнопки и поле в верхней строке шторки работают как обычно; тянуть можно за всё остальное
  const ownTarget = (t: EventTarget) => !!(t as HTMLElement).closest("button:not(.me-grab), input, a");
  const dragDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (wide || e.button !== 0 || ownTarget(e.target) || !side.current || !shell.current) return;
    // опущенная шторка выглядывает на высоту нижнего отступа редактора — столько же оставляет над ней лист
    const max = side.current.offsetHeight - parseFloat(getComputedStyle(shell.current).paddingBottom);
    const base = open ? 0 : max;
    drag.current = { y0: e.clientY, base, max, y: base, t: e.timeStamp, v: 0, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const dragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = side.current;
    if (!d || !el) return;
    const dy = e.clientY - d.y0;
    if (!d.moved) {
      if (Math.abs(dy) < 6) return;
      d.moved = true;
      el.classList.add("dragging");
      shade.current?.classList.add("dragging");
    }
    let y = d.base + dy;
    // за краями шторка тянется туго, как резинка
    if (y < 0) y = -Math.sqrt(-y) * 3;
    if (y > d.max) y = d.max + Math.sqrt(y - d.max) * 3;
    const dt = e.timeStamp - d.t;
    if (dt > 0) d.v = (y - d.y) / dt;
    d.y = y;
    d.t = e.timeStamp;
    el.style.transform = `translate3d(0, ${y}px, 0)`;
    if (shade.current) shade.current.style.opacity = String(Math.min(1, Math.max(0, 1 - y / d.max)));
  };
  const dragUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    dragged.current = true;
    side.current?.classList.remove("dragging");
    side.current?.style.removeProperty("transform");
    shade.current?.classList.remove("dragging");
    shade.current?.style.removeProperty("opacity");
    // быстрый взмах решает сам, иначе — к ближайшему положению
    setOpen(d.v < -0.35 ? true : d.v > 0.35 ? false : d.y < d.max / 2);
  };
  const dragClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (!wide && !ownTarget(e.target)) setOpen(!open);
  };

  const layout = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem(SPLIT_KEY));
      return v >= SPLIT_MIN ? v : null;
    } catch {
      return null;
    }
  });
  const saveSplit = (v: number | null) => {
    setSplit(v);
    try {
      if (v === null) localStorage.removeItem(SPLIT_KEY);
      else localStorage.setItem(SPLIT_KEY, String(Math.round(v)));
    } catch {}
  };
  const clampSplit = (v: number) => Math.max(SPLIT_MIN, Math.min(v, (layout.current?.clientWidth ?? 1200) - 320));
  const panelWidth = () => side.current?.getBoundingClientRect().width ?? 600;
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = panelWidth();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    const move = (ev: PointerEvent) => setSplit(clampSplit(w0 + ev.clientX - x0));
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      document.body.classList.remove("resizing");
      saveSplit(clampSplit(w0 + ev.clientX - x0));
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  // правки есть — синяя «Сохранить»; нет — тихая отметка «Сохранено» без кнопки (ширина та же, ничего не прыгает)
  const saveBtn = dirty ? (
    <button className="btn small primary me-save" onClick={keep}>
      Сохранить
    </button>
  ) : (
    <span className="me-save me-saved" role="status">
      <Icon name="check" size={16} />
      Сохранено
    </span>
  );

  return (
    <div ref={shell} className={`menu-edit ${open ? "open" : ""}`}>
      <div
        ref={layout}
        className={`me-layout ${folded ? "solo" : ""} ${anim ? "anim" : ""}`}
        style={{ ...(split ? { ["--tw" as string]: `${split}px` } : {}), ...(anim && sideW ? { ["--side-w" as string]: `${sideW}px` } : {}) }}
      >
        {/* панель в разметке всегда: свёрнутая — скрыта и inert, так она уезжает анимацией и сохраняет прокрутку */}
        {(
          <aside ref={side} className="me-side" aria-label="Панель меню" inert={folded ? "" : undefined}>
            <div className="me-top" onPointerDown={dragDown} onPointerMove={dragMove} onPointerUp={dragUp} onPointerCancel={dragUp} onClick={dragClick}>
              <button className="me-grab" aria-expanded={open} aria-label={open ? "Опустить панель" : "Вытянуть панель"} tabIndex={wide ? -1 : 0} />
              <div className="me-bar">
                {/* те же место и вид, что у плашки свёрнутой панели: ✕ и «свернуть» превращаются в ☰ и «выдвинуть» */}
                <span className="me-mini-btns me-btns">
                  <button className="icon-btn small me-close" onClick={() => close()} aria-label="Закрыть редактор" title="Закрыть редактор">
                    <Icon name="close" size={18} />
                  </button>
                  <button className="icon-btn small me-fold" onClick={() => setCollapsed(true)} aria-label="Свернуть панель" title="Свернуть панель">
                    <Icon name="hide" size={18} />
                  </button>
                </span>
                <span className="me-name" aria-hidden="true">
                  {root.name}
                </span>
                {saveBtn}
              </div>
              {wide && (
                <div
                  className="me-split"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Ширина панели"
                  tabIndex={0}
                  title="Потяните, чтобы сделать панель уже или шире. Двойной щелчок — как было."
                  onPointerDown={startResize}
                  onDoubleClick={() => saveSplit(null)}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                    e.preventDefault();
                    saveSplit(clampSplit(panelWidth() + (e.key === "ArrowRight" ? 32 : -32)));
                  }}
                />
              )}
            </div>
            <div className="me-body" inert={!wide && !open ? "" : undefined}>
              <header className="me-head">
                <input
                  className="page-title-input doc-title"
                  aria-label="Название меню"
                  value={root.name}
                  onChange={(e) =>
                    update((w) => {
                      for (const d of menuFamily(w, root)) d.name = e.target.value;
                    })
                  }
                />
                <p className="me-meta">
                  <span>Лист {sizeLabel(doc.size)}</span>
                  {ws.cafes.length > 1 && cafe && <span>{cafeLabel(cafe)}</span>}
                  <DocStatus doc={doc} />
                </p>
              </header>
              <section className="me-tables" aria-label="Таблицы меню">
                <MenuTables doc={doc} />
              </section>
            </div>
          </aside>
        )}
        <MenuCanvas
          doc={doc}
          lead={
            folded && (
              <div className="me-mini">
                <span className="me-mini-btns">
                  <BurgerMenu name={root.name} close={close} />
                  <button className="icon-btn small" onClick={() => setCollapsed(false)} aria-label="Выдвинуть панель" title="Выдвинуть панель">
                    <Icon name="show" size={18} />
                  </button>
                </span>
                {dirty && saveBtn}
              </div>
            )
          }
        />
      </div>
      {!wide && <div ref={shade} className="me-shade" onClick={() => setOpen(false)} aria-hidden="true" />}

      {ask && (
        <Sheet
          size="ask"
          title="Сохранить правки?"
          onClose={() => setAsk(null)}
          footer={
            <>
              <button className="btn" onClick={discard}>
                Не сохранять
              </button>
              <button className="btn primary" onClick={leave}>
                Сохранить
              </button>
            </>
          }
        >
          <p className="ask-text">Вы меняли меню после открытия. Если не сохранять, оно вернётся к тому виду, каким было, когда вы открыли редактор.</p>
        </Sheet>
      )}
    </div>
  );
}

const SECTIONS = [
  { href: "#home", label: "Главная" },
  { href: "#menu", label: "Меню" },
  { href: "#tags", label: "Ценники" },
];

/** ☰ свёрнутой панели: название меню, выход из редактора и разделы приложения (шапки в редакторе нет). */
function BurgerMenu({ name, close }: { name: string; close: (to?: string) => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const { mounted, closing } = usePresence(open);
  useKeepOnScreen(open, box);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>("button, a")?.focus();
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);
  const shut = () => {
    setOpen(false);
    btn.current?.focus();
  };
  return (
    <>
      <button ref={btn} className="icon-btn small" aria-label="Меню" title="Меню" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="burger" size={18} />
      </button>
      {mounted && (
        <div
          ref={box}
          className="rm-menu me-menu"
          data-closing={closing || undefined}
          role="menu"
          aria-label="Меню"
          onKeyDown={(e) => {
            if (e.key === "Escape") return shut();
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const items = [...(box.current?.querySelectorAll<HTMLElement>("button, a") ?? [])];
            const i = items.indexOf(document.activeElement as HTMLElement);
            items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          }}
        >
          <div className="me-menu-name">{name}</div>
          <button role="menuitem" onClick={() => (setOpen(false), close())}>
            Закрыть редактор
          </button>
          <div className="rm-sep" />
          {SECTIONS.map((x) => (
            <a
              key={x.href}
              role="menuitem"
              href={x.href}
              onClick={(e) => {
                e.preventDefault();
                setOpen(false);
                close(x.href.slice(1));
              }}
            >
              {x.label}
            </a>
          ))}
        </div>
      )}
    </>
  );
}
