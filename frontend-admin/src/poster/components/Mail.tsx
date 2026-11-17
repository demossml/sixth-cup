import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { posterFetch } from "@/lib/client/api";
import { layoutDoc } from "@/lib/client/export";
import { disconnectMail, saveMail, testMail, useMail, type MailForm, type MailState } from "@/lib/client/mail";
import { priceChangesFull, priceChangesText, type DocChanges } from "@/lib/changes";
import { cafeLabel, sizeLabel, type SendRecord, type Workspace } from "@/lib/model";
import { previewHeight, sceneToSvg } from "@/lib/render/svg";
import type { SendDetails, SendPreview, SentDoc } from "@/lib/sends";
import { useSendPreview } from "@/lib/client/sendPreviews";
import { changedTexts, layoutSnap } from "@/lib/snapshot";
import { useCafe } from "./cafe";
import { ContactTag, Contacts } from "./Contacts";
import { BackButton, Stat, Stats, Tab, TabPanel, Tabs, useTabsId } from "./kit";
import { Icon, useClosing } from "./ui";
import { useWs } from "./WorkspaceProvider";

// Раздел «Почта»: подробная история отправок в типографию и настройки ящика, с которого они уходят.
// Адреса: #mail — отправка (история), #mail/send/<id>[/log|/letter] — одна отправка и её вкладка,
// #mail/contacts[/<id>] — контакты (с открытой правкой контакта), #mail/settings — настройки.

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 10;
  const b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};
const files = (n: number) => `${n} ${plural(n, "файл", "файла", "файлов")}`;
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`);
const day = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const when = (iso: string) => `${new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}, ${clock(iso)}`;
const isManual = (s: SendRecord) => !s.bytes; // письмом уходит архив; отметка вручную — без него

export function Mail({ route }: { route: string[] }) {
  const { ws } = useWs();
  const mail = useMail();
  const detail = route[1] === "send" ? route[2] : null;
  const tab = route[1] === "settings" ? "settings" : route[1] === "contacts" ? "contacts" : "sends";
  const tabsId = useTabsId();
  const tabs = [
    { id: "sends", label: "Отправка", href: "#mail", count: ws.sends.length },
    { id: "contacts", label: "Контакты", href: "#mail/contacts", count: ws.contacts.length },
    { id: "settings", label: "Настройки", href: "#mail/settings", count: null },
  ] as const;
  return (
    <div className="mailbox">
      {/* вложенная страница: вместо заголовка раздела — кнопка назад и свой заголовок */}
      {detail ? (
        <SendDetail key={detail} id={detail} tab={route[3]} />
      ) : (
        <>
          <header className="home-head mailbox-head">
            <h1 className="home-big">Почта</h1>
            <MailStatus mail={mail} />
          </header>
          <Tabs id={tabsId} label="Почта" value={tab}>
            {tabs.map((t) => (
              <Tab key={t.id} value={t.id} href={t.href} count={t.count}>
                {t.label}
              </Tab>
            ))}
          </Tabs>
          <TabPanel tabs={tabsId} value={tab} className="mailbox-pane">
            {tab === "sends" && <SendsList />}
            {tab === "contacts" && <Contacts edit={route[2]} />}
            {tab === "settings" && <MailSettings mail={mail} />}
          </TabPanel>
        </>
      )}
    </div>
  );
}

/** Точка и строка состояния: подключена ли почта и с какого адреса уходят письма. */
export function MailStatus({ mail }: { mail: MailState | null }) {
  const state = mail === null ? "wait" : mail.configured ? "on" : "off";
  const text = state === "wait" ? "Проверяю почту…" : state === "on" ? `Письма уходят с ${mail!.from}` : "Почта не подключена";
  return (
    <p className={`mail-state ${state}`} role="status">
      <span className="mail-dot" aria-hidden />
      {text}
    </p>
  );
}

/** Блок на главной над отправкой: состояние почты и переход в раздел. */
export function MailLink() {
  const mail = useMail();
  const on = !!mail?.configured;
  return (
    <a className={`mail-link ${mail === null ? "wait" : on ? "on" : "off"}`} href={on || mail === null ? "#mail" : "#mail/settings"}>
      <span className="mail-dot" aria-hidden />
      <span className="mail-link-text">
        <b>Почта</b>
        <span className="muted">{mail === null ? "Проверяю…" : on ? `Письма уходят с ${mail.from}. История отправок` : "Не подключена — подключите, чтобы отправлять письмом"}</span>
      </span>
      <Icon name="right" size={16} />
    </a>
  );
}

// ---------- отправки ----------

function SendsList() {
  const { ws } = useWs();
  const { cafes } = useCafe();
  const inScope = useMemo(() => new Set(cafes.map((c) => c.id)), [cafes]);
  const sends = useMemo(() => ws.sends.filter((s) => !s.cafeIds || s.cafeIds.some((id) => inScope.has(id))).slice().reverse(), [ws.sends, inScope]);
  if (!sends.length) return <p className="hint">В типографию ещё ничего не отправляли. Отправки появятся здесь — с тем, что ушло и что в нём изменилось.</p>;
  const byDay = new Map<string, SendRecord[]>();
  for (const s of sends) byDay.set(day(s.at), [...(byDay.get(day(s.at)) ?? []), s]);
  return (
    <div className="sends">
      {[...byDay].map(([d, list]) => (
        <section key={d} className="sends-day">
          <h2 className="sends-date">{d}</h2>
          <ul className="sends-list">
            {list.map((s) => (
              <SendRow key={s.id} s={s} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Строка отправки: слева время; в середине — вид отправки над получателем, адрес, файлы и две строки
 * письма; справа — превью ушедших листов в ряд. Что не влезло по ширине, считает «+N» перед шевроном.
 * Превью и письмо догружаются, когда строка появляется на экране.
 */
function SendRow({ s }: { s: SendRecord }) {
  const { ws } = useWs();
  const row = useRef<HTMLAnchorElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = row.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  const preview = useSendPreview(s.id, visible);
  const manual = isManual(s);
  return (
    <li>
      <a ref={row} className="sends-row" href={`#mail/send/${s.id}`}>
        <time className="sends-time">{clock(s.at)}</time>
        <span className="sends-main">
          <span className={`sends-kind ${manual ? "manual" : ""}`}>{manual ? "Вручную" : "Письмо"}</span>
          <b className="sends-name">{recipientName(ws, s)}</b>
          <span className="sends-addr muted">
            {manual ? "Отмечено вручную" : s.to}
            {ws.cafes.length > 1 && s.cafeIds?.length ? ` · ${s.cafeIds.map((id) => cafeLabel(ws.cafes.find((c) => c.id === id))).join(", ")}` : ""}
          </span>
          <span className="sends-meta">
            {files(s.files.length)}
            {s.bytes ? `, ${kb(s.bytes)}` : ""}
            {s.changes ? <span className="muted"> · {s.changes} {plural(s.changes, "правка", "правки", "правок")}</span> : null}
          </span>
          {/* у письма место под две строки текста есть сразу — строка не подпрыгивает, когда текст догрузится */}
          {(!manual || preview?.snippet) && <span className={`sends-snippet${preview ? "" : " wait"}`}>{preview?.snippet ?? ""}</span>}
        </span>
        <SendThumbs preview={preview} total={s.files.length} />
        <Icon name="right" size={16} />
      </a>
    </li>
  );
}

const THUMB_H = 52; // высота превью в строке, px
const THUMB_GAP = 6;
const COUNTER_W = 40; // место под «+N»

/** Превью ушедших листов в ряд по правому краю; сколько не влезло — «+N». */
function SendThumbs({ preview, total }: { preview: SendPreview | undefined; total: number }) {
  const box = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const docs = preview?.docs ?? [];
  const widthOf = (d: SendPreview["docs"][number]) => Math.round(Math.min(96, Math.max(28, THUMB_H * (d.size.w && d.size.h ? d.size.w / d.size.h : 0.75))));
  // сколько превью влезает; если влезают не все — оставить место под счётчик
  let fit = 0;
  let used = 0;
  for (const d of docs) {
    const next = used + (fit ? THUMB_GAP : 0) + widthOf(d);
    const rest = total - (fit + 1);
    if (next + (rest > 0 ? THUMB_GAP + COUNTER_W : 0) > width) break;
    used = next;
    fit++;
  }
  const hidden = preview ? total - fit : 0;
  return (
    <span ref={box} className="sends-thumbs" aria-hidden>
      {docs.slice(0, fit).map((d) => (
        <SentMini key={d.id} doc={d} w={widthOf(d)} />
      ))}
      {hidden > 0 && <span className="sends-more">+{hidden}</span>}
    </span>
  );
}

/** Маленькое превью отправленной версии; копии нет — текущий документ, его нет — пустой лист. */
function SentMini({ doc, w }: { doc: SendPreview["docs"][number]; w: number }) {
  const { ws, fb } = useWs();
  const svg = useMemo(() => {
    if (!fb) return "";
    const scene = doc.snap ? layoutSnap(doc.snap, doc.name, fb) : null;
    return scene ? sceneToSvg(scene, { title: doc.name }) : "";
  }, [fb, doc]);
  const current = !doc.snap ? ws.documents.find((d) => d.id === doc.id) : undefined;
  return (
    <span className="sends-thumb" style={{ width: w, height: THUMB_H }} title={doc.name}>
      <span className="paper" style={{ aspectRatio: doc.size.w && doc.size.h ? `${doc.size.w} / ${doc.size.h}` : "3 / 4" }}>
        {svg ? <span className="paper-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : current && fb ? <CurrentSvg id={current.id} /> : null}
      </span>
    </span>
  );
}

function CurrentSvg({ id }: { id: string }) {
  const { ws, fb } = useWs();
  const doc = ws.documents.find((d) => d.id === id);
  const svg = useMemo(() => (doc && fb ? sceneToSvg(layoutDoc(ws, doc, fb), { title: doc.name }) : ""), [ws, doc, fb]);
  return <span className="paper-svg" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function recipientName(ws: Workspace, s: SendRecord): string {
  if (isManual(s)) return s.to === "передано вручную" ? "Передано вручную" : s.to;
  return ws.contacts.find((c) => c.email.toLowerCase() === s.to.toLowerCase())?.name ?? s.to;
}

function changesLine(c: DocChanges) {
  if (c.state === "new") return <span>Новый, раньше не печатали</span>;
  if (c.state === "same") return <span className="muted">Без изменений — отправлен повторно</span>;
  if (c.state === "unknown") return <span className="muted">Что изменилось, не записано</span>;
  return (
    <>
      {c.prices.length > 0 && (
        <span className="chg-price" title={priceChangesFull(c)}>
          {priceChangesText(c)}
        </span>
      )}
      {c.other.length > 0 && <span className="muted">{c.other.join(", ")}</span>}
    </>
  );
}

type SdTab = "docs" | "log" | "letter";
const SD_TABS: SdTab[] = ["docs", "log", "letter"];
const SD_LABEL: Record<SdTab, string> = { docs: "Что ушло", log: "Изменения", letter: "Письмо" };
/** С этой ширины вкладки отправки встают тремя колонками рядом. */
const SD_WIDE = "(min-width: 1200px)";
const useMedia = (q: string) =>
  useSyncExternalStore(
    (cb) => {
      const m = matchMedia(q);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matchMedia(q).matches,
    () => false,
  );

/** Размер архива: число и единица отдельно — единица мельче числа. */
const sizeParts = (n: number): [string, string] => (n < 1024 * 1024 ? [String(Math.max(1, Math.round(n / 1024))), "КБ"] : [(n / 1024 / 1024).toFixed(1).replace(".", ","), "МБ"]);

/**
 * Одна отправка. Сверху — «назад», дата, адресат и сводка; ниже — «Что ушло / Изменения / Письмо»:
 * на узком экране вкладками, на широком — колонками рядом. Числа — только в сводке, во вкладках их не повторяем.
 */
function SendDetail({ id, tab: routeTab }: { id: string; tab?: string }) {
  const { ws } = useWs();
  const wide = useMedia(SD_WIDE);
  const tabsId = useTabsId();
  const [data, setData] = useState<SendDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  // вкладка — в адресе (#mail/send/<id>/log): после обновления страницы открыта та же, без мигания
  const [tab, setTab] = useState<SdTab>(() => (SD_TABS.includes(routeTab as SdTab) ? (routeTab as SdTab) : "docs"));
  useEffect(() => {
    setData(null);
    setError(null);
    posterFetch(`/sends/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || "Не удалось загрузить");
        setData(body as SendDetails);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const rec = ws.sends.find((s) => s.id === id);
  const manual = data ? data.method === "manual" : rec ? isManual(rec) : false;
  const name = rec ? recipientName(ws, rec) : (data?.toName ?? data?.to ?? "");
  const cafeIds = [...new Set((data?.docs ?? []).map((d) => d.cafeId).filter((c): c is string => !!c))];
  const cafes = cafeIds.map((c) => cafeLabel(ws.cafes.find((x) => x.id === c)));
  const batch = data?.batch ? ws.sends.filter((s) => s.batch === data.batch && s.id !== id) : [];
  const panes = SD_TABS.filter((t) => t !== "letter" || !!data?.text);
  const current = panes.includes(tab) ? tab : "docs";
  const pick = (t: string) => {
    setTab(t as SdTab);
    // replaceState не вызывает hashchange: страница не перерисовывается и не прыгает наверх
    history.replaceState(null, "", `#mail/send/${id}${t === "docs" ? "" : `/${t}`}`);
  };

  const body = (t: SdTab) => {
    if (!data) return null;
    if (t === "docs")
      return (
        <ul className="sd-docs">
          {data.docs.map((d, i) => (
            <SentDocRow key={d.id + i} doc={d} onOpen={() => setViewing(i)} />
          ))}
        </ul>
      );
    if (t === "log")
      return data.log.length === 0 ? (
        <p className="hint">Правок с прошлой отправки не было — документы отправлены повторно или впервые.</p>
      ) : (
        <>
          <p className="sd-caption">С прошлой отправки, новые сверху</p>
          <ol className="log">
            {data.log
              .slice()
              .reverse()
              .map((c, i) => (
                <li key={i}>
                  <time>{new Date(c.at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
                  <span>{c.text}</span>
                </li>
              ))}
          </ol>
        </>
      );
    return (
      <div className="sd-letter">
        <dl>
          <div>
            <dt>Тема</dt>
            <dd>{data.subject}</dd>
          </div>
          <div>
            <dt>Кому</dt>
            <dd>{data.to}</dd>
          </div>
        </dl>
        <pre>{data.text}</pre>
      </div>
    );
  };

  const [size, unit] = sizeParts(data?.bytes ?? 0);

  return (
    <div className={`send-detail${wide ? " wide" : ""}`}>
      <BackButton href="#mail">Все отправки</BackButton>
      {error && <p className="banner danger">{error}</p>}
      {!data && !error && <p className="hint">Загружаю…</p>}
      {data && (
        <>
          <header className="sd-head">
            <h1 className="sd-title">{when(data.at)}</h1>
            <div className="sd-to">
              {manual ? (
                <span>Отмечено отправленным вручную — архив скачали и передали сами</span>
              ) : (
                <>
                  <span>Кому</span>
                  <ContactTag email={data.to} name={name} cafeIds={cafeIds} />
                </>
              )}
              {ws.cafes.length > 1 && cafes.length > 0 && <span className="sd-to-cafes">{cafes.join(", ")}</span>}
            </div>
            {batch.length > 0 && (
              <p className="sd-to">
                <span>
                  В той же рассылке:{" "}
                  {batch.map((s, i) => (
                    <span key={s.id}>
                      {i > 0 && ", "}
                      <a className="link inline" href={`#mail/send/${s.id}`}>
                        {recipientName(ws, s)}
                      </a>
                    </span>
                  ))}
                </span>
              </p>
            )}
          </header>

          <Stats>
            <Stat value={data.docs.length} label={plural(data.docs.length, "документ", "документа", "документов")} />
            {data.bytes > 0 && <Stat value={size} unit={unit} label="архив" />}
            <Stat value={data.log.length} label={plural(data.log.length, "правка", "правки", "правок")} />
          </Stats>

          {data.legacy && <p className="banner">Отправка сделана до того, как начали хранить подробности: показано то, что сохранилось.</p>}

          {wide ? (
            // широкий экран: все вкладки видны сразу, колонками; «Что ушло» шире — в нём превью
            <div className="sd-cols" style={{ gridTemplateColumns: panes.map((p) => (p === "docs" ? "minmax(0, 1.25fr)" : "minmax(0, 1fr)")).join(" ") }}>
              {panes.map((p) => (
                <section key={p} className="sd-col" aria-labelledby={`sd-${p}`}>
                  <h2 id={`sd-${p}`} className="sd-col-title">
                    {SD_LABEL[p]}
                  </h2>
                  {body(p)}
                </section>
              ))}
            </div>
          ) : (
            <div className="sd-tabbed">
              <Tabs id={tabsId} label="Отправка" value={current} onValueChange={pick} className="sd-tabs">
                {panes.map((p) => (
                  <Tab key={p} value={p}>
                    {SD_LABEL[p]}
                  </Tab>
                ))}
              </Tabs>
              <TabPanel tabs={tabsId} value={current}>
                {body(current)}
              </TabPanel>
            </div>
          )}
        </>
      )}
      {data && viewing !== null && <SnapViewer docs={data.docs} index={viewing} sentAt={data.at} onIndex={setViewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/**
 * Документ в отправке: превью в рамке одного размера (лист любой формы вписан по центру — строки ровные),
 * справа три строки — название, вид и размер, что изменилось. Имя файла в архиве — в подсказке у названия.
 */
function SentDocRow({ doc, onOpen }: { doc: SentDoc; onOpen: () => void }) {
  const { ws } = useWs();
  return (
    <li className="sd-doc">
      <button className="sd-thumb" onClick={onOpen} aria-label={`Открыть отправленную версию «${doc.name}»`} title="Открыть на весь экран">
        <SnapThumb doc={doc} />
      </button>
      <div className="sd-doc-text">
        <b title={doc.file || undefined}>{doc.name}</b>
        <span className="muted">
          {doc.kind === "menu" ? "Меню" : "Ценник"} {doc.size.w ? sizeLabel(doc.size) : ""}
          {ws.cafes.length > 1 && doc.cafeId ? ` · ${cafeLabel(ws.cafes.find((c) => c.id === doc.cafeId))}` : ""}
        </span>
        <span className="sd-chg">{changesLine(doc.changes)}</span>
      </div>
    </li>
  );
}

/** Превью отправленной версии документа (из копии на момент отправки). */
function SnapThumb({ doc }: { doc: SentDoc }) {
  const { fb } = useWs();
  const scene = useMemo(() => (fb && doc.snap ? layoutSnap(doc.snap, doc.name, fb) : null), [fb, doc]);
  const svg = useMemo(() => (scene ? sceneToSvg(scene, { title: doc.name }) : ""), [scene, doc.name]);
  const ar = doc.size.w && doc.size.h ? `${doc.size.w} / ${doc.size.h}` : "3 / 4";
  return (
    <div className="mini" style={{ "--ar": doc.size.w && doc.size.h ? doc.size.w / doc.size.h : 0.75 } as CSSProperties}>
      <div className="paper" style={{ aspectRatio: ar }}>
        {scene ? <div className="paper-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="paper-loading">{doc.snap ? "…" : "Копия не сохранилась"}</div>}
      </div>
    </div>
  );
}

/** Отправленная версия на весь экран; если есть прошлая отправка — «Было / Отправлено» с подсветкой разницы. */
function SnapViewer({ docs, index, sentAt, onIndex, onClose }: { docs: SentDoc[]; index: number; sentAt: string; onIndex: (i: number) => void; onClose: () => void }) {
  const { fb } = useWs();
  const doc = docs[index];
  const [side, setSide] = useState<"old" | "new">("new");
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [closing, close] = useClosing(onClose);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    document.body.classList.add("sheet-open");
    return () => {
      document.body.classList.remove("sheet-open");
      back?.focus();
    };
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      else if (e.key === "ArrowRight" && index < docs.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  useEffect(() => setSide("new"), [index]);

  const now = useMemo(() => (fb && doc?.snap ? layoutSnap(doc.snap, doc.name, fb) : null), [fb, doc]);
  const was = useMemo(() => (fb && doc?.prev?.snap ? layoutSnap(doc.prev.snap, doc.name, fb) : null), [fb, doc]);
  const scene = side === "old" && was ? was : now;
  const svg = useMemo(() => {
    if (!scene || !fb) return "";
    const other = scene === now ? was : now;
    return sceneToSvg(scene, { title: doc.name, overflow: true, highlight: other ? changedTexts(scene, other) : undefined, measure: fb.measure });
  }, [scene, now, was, fb, doc]);
  if (!doc) return null;
  const ext = scene ? previewHeight(scene) / scene.h : 1;
  const size = scene ?? (doc.size.w ? doc.size : { w: 3, h: 4 });

  return (
    <div className={`viewer dv${closing ? " closing" : ""}`} role="dialog" aria-modal="true" aria-label="Отправленная версия">
      <header className="viewer-head">
        <div className="viewer-title">
          <b>{doc.name}</b>
          <span className="muted">
            {doc.kind === "menu" ? "Меню" : "Ценник"} {doc.size.w ? sizeLabel(doc.size) : ""} · отправлено {when(sentAt)}
          </span>
        </div>
        <div className="viewer-compare">
          {was ? (
            <>
              <div className="scale" role="group" aria-label="Что показать">
                <button aria-pressed={side === "old"} className={side === "old" ? "on" : ""} onClick={() => setSide("old")}>
                  Было
                </button>
                <button aria-pressed={side === "new"} className={side === "new" ? "on" : ""} onClick={() => setSide("new")}>
                  Отправлено
                </button>
              </div>
              <span className="muted viewer-legend">
                <i className="hl" aria-hidden /> {side === "old" ? `прошлая отправка ${when(doc.prev!.at)}, подсвечено то, что изменилось` : "подсвечено то, что изменилось с прошлой отправки"}
              </span>
            </>
          ) : (
            <span className="muted">{doc.changes.state === "new" ? "Отправлен впервые" : "Прошлая версия не сохранилась"}</span>
          )}
        </div>
        <div className="viewer-nav">
          <button className="icon-btn" disabled={index <= 0} onClick={() => onIndex(index - 1)} aria-label="Предыдущий документ">
            <Icon name="left" />
          </button>
          <span className="viewer-count">
            {index + 1} из {docs.length}
          </span>
          <button className="icon-btn" disabled={index >= docs.length - 1} onClick={() => onIndex(index + 1)} aria-label="Следующий документ">
            <Icon name="right" />
          </button>
        </div>
        <button ref={closeBtn} className="icon-btn" onClick={close} aria-label="Закрыть просмотр">
          <Icon name="close" />
        </button>
      </header>
      <div className="viewer-stage" onClick={(e) => e.target === e.currentTarget && close()}>
        <div className={`paper ${ext > 1 ? "over" : ""}`} style={{ aspectRatio: `${size.w} / ${size.h * ext}`, ["--ar" as string]: size.w / size.h }}>
          {scene ? (
            <div className="paper-svg" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="paper-loading">{doc.snap ? "Загружаю шрифты…" : "Копия этой версии не сохранилась"}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- настройки ----------

const PROVIDERS: { id: string; label: string; host: string; port: number; domains: string[]; help: string }[] = [
  { id: "yandex", label: "Яндекс", host: "smtp.yandex.ru", port: 465, domains: ["yandex.ru", "ya.ru", "yandex.com"], help: "id.yandex.ru → Безопасность → Пароли приложений → Почта" },
  { id: "mailru", label: "Mail.ru", host: "smtp.mail.ru", port: 465, domains: ["mail.ru", "bk.ru", "inbox.ru", "list.ru", "internet.ru"], help: "Настройки → Безопасность → Пароли для внешних приложений" },
  { id: "gmail", label: "Gmail", host: "smtp.gmail.com", port: 465, domains: ["gmail.com"], help: "myaccount.google.com → Безопасность → Пароли приложений (нужна двухэтапная проверка)" },
];

const emptyForm = (m: MailState | null): MailForm => ({
  host: m?.source === "settings" || m?.source === "env" ? m.host : "",
  port: m?.port || 465,
  user: m?.user ?? "",
  pass: "",
  from: m?.from && m.from !== m.user ? m.from : "",
  fromName: m?.fromName ?? "",
});

function MailSettings({ mail }: { mail: MailState | null }) {
  const [form, setForm] = useState<MailForm>(() => emptyForm(mail));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testTo, setTestTo] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  // форма заполняется сохранёнными настройками, когда они пришли (и пока пользователь ничего не правил)
  useEffect(() => {
    if (mail && !touched) setForm(emptyForm(mail));
  }, [mail, touched]);

  const provider = PROVIDERS.find((p) => p.host === form.host.trim().toLowerCase());
  const set = (patch: Partial<MailForm>) => {
    setTouched(true);
    setResult(null);
    setForm((f) => ({ ...f, ...patch }));
  };
  const onUser = (user: string) => {
    const domain = user.split("@")[1]?.toLowerCase();
    const guess = PROVIDERS.find((p) => domain && p.domains.includes(domain));
    // адрес подсказывает сервер: yandex.ru → smtp.yandex.ru, если сервер ещё не выбран руками
    set({ user, ...(guess && (!form.host || PROVIDERS.some((p) => p.host === form.host)) ? { host: guess.host, port: guess.port } : {}) });
  };
  const savedPass = !!mail?.hasPassword && mail.source === "settings";
  const canSubmit = !!form.host.trim() && !!form.user.trim() && (!!form.pass || savedPass);

  const run = async (label: string, fn: () => Promise<{ ok: boolean; text: string }>) => {
    setBusy(label);
    setResult(null);
    try {
      setResult(await fn());
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const onSave = () =>
    run("Сохраняю…", async () => {
      const check = await testMail(form);
      if (!check.ok) return { ok: false, text: `Не сохранено: ${check.error}` };
      const next = await saveMail(form);
      setTouched(false);
      setForm(emptyForm(next));
      return { ok: true, text: `Почта подключена: письма будут уходить с ${next.from}.` };
    });
  const onTest = () =>
    run("Проверяю…", async () => {
      const r = await testMail(form);
      return r.ok ? { ok: true, text: "Подключение работает: сервер принял логин и пароль." } : { ok: false, text: r.error ?? "Не получилось" };
    });
  const onTestLetter = () =>
    run("Отправляю…", async () => {
      const to = testTo.trim() || form.user.trim();
      const r = await testMail(form, to);
      return r.ok ? { ok: true, text: `Тестовое письмо отправлено на ${to}. Проверьте ящик (и «Спам»).` } : { ok: false, text: r.error ?? "Не получилось" };
    });
  const onDisconnect = () =>
    run("Отключаю…", async () => {
      const next = await disconnectMail();
      setConfirmOff(false);
      setTouched(false);
      setForm(emptyForm(next));
      return { ok: true, text: next.configured ? "Настройки из конструктора удалены — работают переменные окружения сервера." : "Почта отключена. Архив по-прежнему можно скачать и передать вручную." };
    });

  return (
    <div className="mail-settings">
      <form
        className="ms-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !busy) void onSave();
        }}
      >
        {mail?.source === "env" && (
          <p className="banner">Сейчас письма уходят по настройкам сервера (переменные SMTP_*). Сохранённые здесь настройки их заменят.</p>
        )}
        <div className="field">
          <span id="ms-provider">Почтовый сервис</span>
          <div className="chips" role="group" aria-labelledby="ms-provider">
            {PROVIDERS.map((p) => (
              <button key={p.id} type="button" className={`chip ${provider?.id === p.id ? "on" : ""}`} aria-pressed={provider?.id === p.id} onClick={() => set({ host: p.host, port: p.port })}>
                {p.label}
              </button>
            ))}
            <button type="button" className={`chip ${form.host && !provider ? "on" : ""}`} aria-pressed={!!form.host && !provider} onClick={() => set({ host: provider ? "" : form.host })}>
              Другой
            </button>
          </div>
        </div>
        {/* логин и пароль чужого ящика, а не входа в конструктор: менеджеру паролей тут нечего сохранять и предлагать */}
        <label className="field">
          <span>Адрес ящика (логин)</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            spellCheck={false}
            required
            value={form.user}
            onChange={(e) => onUser(e.target.value)}
            placeholder="cafe67@yandex.ru"
          />
        </label>
        <div className="field">
          <label htmlFor="ms-pass">Пароль приложения</label>
          <input
            id="ms-pass"
            type="password"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            aria-describedby="ms-pass-hint"
            value={form.pass}
            onChange={(e) => set({ pass: e.target.value })}
            placeholder={savedPass ? "Сохранён — можно не вводить" : "Не основной пароль ящика"}
          />
          <small id="ms-pass-hint" className="hint">
            {provider ? `Где взять: ${provider.help}.` : "Создаётся в настройках безопасности ящика — основной пароль сервер не примет."}
          </small>
        </div>
        <div className="ms-row">
          <label className="field grow">
            <span>Сервер SMTP</span>
            <input value={form.host} onChange={(e) => set({ host: e.target.value.trim() })} placeholder="smtp.yandex.ru" autoCapitalize="off" autoComplete="off" spellCheck={false} required />
          </label>
          <label className="field ms-port">
            <span>Порт</span>
            <input inputMode="numeric" autoComplete="off" value={String(form.port)} onChange={(e) => set({ port: Number(e.target.value.replace(/\D/g, "").slice(0, 5)) || 0 })} />
          </label>
        </div>
        <details className="ms-more">
          <summary>
            Отправитель <Icon name="chevron" size={16} />
          </summary>
          <label className="field">
            <span>Имя отправителя (необязательно)</span>
            <input value={form.fromName} onChange={(e) => set({ fromName: e.target.value })} placeholder="Кафе 6.7" />
          </label>
          <label className="field">
            <span>Адрес отправителя (необязательно)</span>
            <input type="email" value={form.from} onChange={(e) => set({ from: e.target.value })} placeholder={form.user || "по умолчанию — адрес ящика"} />
          </label>
        </details>
        <div className="ms-actions">
          <button className="btn primary" type="submit" disabled={!canSubmit || !!busy} aria-busy={busy === "Сохраняю…"}>
            {busy === "Сохраняю…" ? busy : "Проверить и сохранить"}
          </button>
          <button className="btn" type="button" disabled={!canSubmit || !!busy} aria-busy={busy === "Проверяю…"} onClick={() => void onTest()}>
            {busy === "Проверяю…" ? busy : "Только проверить"}
          </button>
        </div>
        {result && (
          <p className={`banner ${result.ok ? "ok" : "danger"}`} role="status">
            {result.text}
          </p>
        )}
      </form>

      <aside className="ms-side">
        <section className="ms-card" aria-labelledby="ms-test">
          <h2 id="ms-test" className="label">
            Тестовое письмо
          </h2>
          <p className="muted">Пришлём короткое письмо, чтобы убедиться, что всё доходит.</p>
          <label className="field">
            <span>Куда прислать</span>
            <input type="email" inputMode="email" autoComplete="email" spellCheck={false} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={form.user || "адрес почты"} />
          </label>
          <button className="btn" type="button" disabled={!canSubmit || !!busy} aria-busy={busy === "Отправляю…"} onClick={() => void onTestLetter()}>
            {busy === "Отправляю…" ? busy : "Отправить тестовое письмо"}
          </button>
        </section>
        <section className="ms-card" aria-labelledby="ms-how">
          <h2 id="ms-how" className="label">
            Как подключить
          </h2>
          <ol className="mail-steps">
            <li>
              <b>Создайте пароль приложения</b> в ящике, с которого будут уходить письма. Основной пароль сервер не примет.
            </li>
            <li>
              <b>Введите адрес и пароль</b> — сервер подставится сам для Яндекса, Mail.ru и Gmail.
            </li>
            <li>
              <b>Нажмите «Проверить и сохранить».</b> Пароль хранится на сервере зашифрованным и сюда не возвращается.
            </li>
          </ol>
        </section>
        {mail?.source === "settings" && (
          <section className="ms-card" aria-label="Отключить почту">
            {confirmOff ? (
              <div className="ms-off">
                <span>Письма перестанут уходить. Отключить?</span>
                <button className="btn small danger" type="button" disabled={!!busy} aria-busy={busy === "Отключаю…"} onClick={() => void onDisconnect()}>
                  Отключить
                </button>
                <button className="link" type="button" onClick={() => setConfirmOff(false)}>
                  Отмена
                </button>
              </div>
            ) : (
              <button className="link quiet ms-off-link" type="button" onClick={() => setConfirmOff(true)}>
                Отключить почту
              </button>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}
