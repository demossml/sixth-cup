import { posterFetch } from "@/lib/client/api";
import { useMail } from "@/lib/client/mail";
import { useEffect, useMemo, useState } from "react";
import { archiveName, buildPdfs, downloadBytes, zipPdfs, type BuiltPdf } from "@/lib/client/export";
import { docChanges, priceChangesFull, priceChangesText } from "@/lib/changes";
import { STATUS_LABEL, changesSinceLastSend, docDue, dueRank, isChanged, printStatus } from "@/lib/fingerprint";
import { cafeLabel, contactServes, resolveTag, sizeLabel, uid, type Contact, type Doc, type Workspace } from "@/lib/model";
import { ALL, useCafe } from "./cafe";
import { DocViewer } from "./DocViewer";
import { SortHeader, Tab, Tabs, ariaSort, sortRows, useSort } from "./kit";
import { MailLink } from "./Mail";
import { DocPreview, Icon, dueDate } from "./ui";
import { useWs } from "./WorkspaceProvider";

// Отправка в типографию. Три вкладки: что отправить, что изменилось, история.
// Получателей может быть несколько — у каждого свои кафе: города печатаются в разных типографиях,
// каждому уходит своё письмо со своим архивом.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIPPING = "Собираю архив…";
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`);
const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 10;
  const b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};
const files = (n: number) => `${n} ${plural(n, "файл", "файла", "файлов")}`;
const letters = (n: number) => `${n} ${plural(n, "письмо", "письма", "писем")}`;

type Tab = "send" | "changes" | "history";

export function SendPanel() {
  const { ws, fb, replace, update, offerUndo, saveState } = useWs();
  const { scope, cafes } = useCafe();
  const many = cafes.length > 1;
  const inScope = useMemo(() => new Set(cafes.map((c) => c.id)), [cafes]);
  const address = (id: string) => cafeLabel(ws.cafes.find((c) => c.id === id));
  const title = (d: Doc) => (d.kind === "tag" ? resolveTag(ws, d).name : d.name);

  const [tab, setTab] = useState<Tab>("send");
  const [cafeFilter, setCafeFilter] = useState<string>(ALL);
  const filter = many && inScope.has(cafeFilter) ? cafeFilter : ALL;

  const scoped = useMemo(() => ws.documents.filter((d) => inScope.has(d.cafeId)), [ws, inScope]);
  // сначала срочные (цена из базы уже действует), потом по дате активации цены, потом остальные
  const changed = useMemo(
    () =>
      scoped
        .filter((d) => isChanged(ws, d))
        .map((d, i) => ({ d, i, r: dueRank(docDue(ws, d)) }))
        .sort((a, b) => a.r.localeCompare(b.r) || a.i - b.i)
        .map((x) => x.d),
    [ws, scoped],
  );
  const unchanged = useMemo(() => scoped.filter((d) => !isChanged(ws, d)), [ws, scoped]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(ws.documents.filter((d) => isChanged(ws, d)).map((d) => d.id)));
  const [showAll, setShowAll] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const [sel, setSel] = useState<Set<string>>(() => {
    const own = ws.contacts.filter((c) => c.cafeIds?.length);
    return new Set((own.length ? own : ws.contacts.slice(0, 1)).map((c) => c.id));
  });
  const [adding, setAdding] = useState(ws.contacts.length === 0);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [message, setMessage] = useState("");
  const [print, setPrint] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const sending = !!busy?.startsWith("Отправляю");
  const [newErr, setNewErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastBuilt, setLastBuilt] = useState<BuiltPdf[] | null>(null);
  const mail = useMail();
  const log = useMemo(() => changesSinceLastSend(ws), [ws]);
  const history = useMemo(() => ws.sends.filter((s) => !s.cafeIds || s.cafeIds.some((id) => inScope.has(id))).reverse(), [ws.sends, inScope]);
  // строка под заголовком блока отправки: когда и кому ушёл последний заказ
  const lastSend = useMemo(() => {
    const last = history[0];
    const pending = scoped.some((d) => printStatus(ws, d) === "pending");
    if (!last) return "В типографию ещё ничего не отправляли.";
    const ordered = scoped.filter((d) => printStatus(ws, d) === "ordered").length;
    const day = new Date(last.at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    const work = ordered ? `, в работе ${ordered} ${plural(ordered, "документ", "документа", "документов")}` : "";
    return `Последний заказ ${day} → ${last.to}${work}.${pending ? "" : " Всё актуальное у типографии."}`;
  }, [ws, history, scoped]);

  // новые изменённые документы — сразу отмечены; удалённые — сняты
  const allChanged = useMemo(() => ws.documents.filter((d) => isChanged(ws, d)), [ws]);
  useEffect(() => {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const d of allChanged) next.add(d.id);
      for (const id of prev) if (!ws.documents.some((d) => d.id === id)) next.delete(id);
      return next.size === prev.size && [...next].every((id) => prev.has(id)) ? prev : next;
    });
  }, [allChanged, ws.documents]);

  // что видно в списке и что уйдёт: только выбранные кафе
  // что изменилось в каждом документе с прошлой отправки — для колонки и для сортировки по ней
  const changesOf = useMemo(() => new Map(scoped.map((d) => [d.id, docChanges(ws, d)])), [ws, scoped]);
  // сортировка по колонкам: «Документ» — по названию; «Что изменилось» — по возрастанию сначала с изменившейся ценой.
  // «Как было» — по срочности
  const [sort, setSort] = useSort<"name" | "chg">("send", ["name", "chg"]);
  const listed = [...changed, ...(showAll ? unchanged : [])].filter((d) => filter === ALL || d.cafeId === filter);
  const visible = sortRows(listed, sort, {
    name: (d: Doc) => title(d),
    chg: (d: Doc) => (changesOf.get(d.id)?.prices.length ? 0 : 1),
  });
  const docs = scoped.filter((d) => picked.has(d.id));
  const groups =
    many && filter === ALL
      ? cafes.map((c) => ({ cafe: c, docs: visible.filter((d) => d.cafeId === c.id) })).filter((g) => g.docs.length)
      : [{ cafe: null, docs: visible }];
  // общая галочка: отметить или снять сразу все строки (всего списка или одного кафе)
  const setMany = (list: Doc[], on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      for (const d of list)
        if (on) n.add(d.id);
        else n.delete(d.id);
      return n;
    });
  const master = (list: Doc[], label: string) => {
    const on = list.filter((d) => picked.has(d.id)).length;
    return (
      <input
        type="checkbox"
        checked={list.length > 0 && on === list.length}
        ref={(el) => {
          if (el) el.indeterminate = on > 0 && on < list.length;
        }}
        onChange={() => setMany(list, on !== list.length)}
        aria-label={label}
      />
    );
  };
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // кому что: у каждого получателя документы его кафе
  const recipients = ws.contacts.filter((c) => sel.has(c.id));
  const routes = recipients.map((c) => ({ contact: c, docs: docs.filter((d) => contactServes(c, d.cafeId)) })).filter((r) => r.docs.length);
  const routed = new Set(routes.flatMap((r) => r.docs.map((d) => d.id)));
  const orphanCafes = [...new Set(docs.filter((d) => !routed.has(d.id)).map((d) => d.cafeId))];

  const setCafes = (c: Contact, cafeId: string, on: boolean) =>
    update((w) => {
      const x = w.contacts.find((k) => k.id === c.id);
      if (!x) return;
      const cur = new Set(x.cafeIds ?? w.cafes.map((k) => k.id));
      if (on) cur.add(cafeId);
      else cur.delete(cafeId);
      x.cafeIds = w.cafes.map((k) => k.id).filter((id) => cur.has(id));
    });
  const addContact = () => {
    const email = newEmail.trim();
    if (!EMAIL.test(email)) return setNewErr("Проверьте адрес почты — например, print@example.ru");
    const known = ws.contacts.find((c) => c.email.toLowerCase() === email.toLowerCase());
    const id = known?.id ?? uid("c");
    if (!known)
      update((w) => void w.contacts.push({ id, name: newName.trim() || email, email, ...(scope !== ALL && ws.cafes.length > 1 ? { cafeIds: [scope] } : {}) }));
    setSel((s) => new Set(s).add(id));
    setNewName("");
    setNewEmail("");
    setAdding(false);
    setResult(null);
  };

  const onDownload = async () => {
    if (!fb) return;
    setBusy(ZIPPING);
    setResult(null);
    try {
      const pdfs = await buildPdfs(ws, docs, fb, print);
      const zip = zipPdfs(pdfs);
      setLastBuilt(pdfs);
      downloadBytes(zip, archiveName(), "application/zip");
      setResult({ ok: true, text: `Архив скачан: ${files(pdfs.length)}, ${kb(zip.byteLength)}.` });
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const markSent = async () => {
    if (!lastBuilt) return;
    setBusy("Отмечаю…");
    const res = await posterFetch("/mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docs: lastBuilt.map((p) => ({ id: p.doc.id, hash: p.hash, file: p.file })) }),
    });
    const data = await res.json();
    setBusy(null);
    if (res.ok) {
      replace(data.ws as Workspace);
      setLastBuilt(null);
      setResult({ ok: true, text: "Отмечено как отправленное." });
    } else setResult({ ok: false, text: data.error });
  };

  const onSend = async () => {
    if (!fb) return;
    if (saveState === "pending" || saveState === "saving") return setResult({ ok: false, text: "Подождите секунду — сохраняю последние правки." });
    setResult(null);
    setLastBuilt(null);
    const batch = uid("b");
    const done: string[] = [];
    try {
      for (const r of routes) {
        setBusy(routes.length > 1 ? `Отправляю: ${r.contact.name}…` : "Отправляю…");
        const pdfs = await buildPdfs(ws, r.docs, fb, print);
        const zip = zipPdfs(pdfs);
        if (zip.byteLength > 20 * 1024 * 1024)
          throw new Error(`${r.contact.name}: архив ${kb(zip.byteLength)} — больше 20 МБ. Отправьте частями или скачайте архив.`);
        const form = new FormData();
        form.set("zip", new File([zip as BlobPart], archiveName(), { type: "application/zip" }));
        form.set("to", r.contact.email);
        form.set("name", r.contact.name === r.contact.email ? "" : r.contact.name);
        form.set("message", message);
        form.set("batch", batch);
        if (ws.cafes.length > 1) form.set("cafes", [...new Set(r.docs.map((d) => address(d.cafeId)))].join(", "));
        form.set("docs", JSON.stringify(pdfs.map((p) => ({ id: p.doc.id, hash: p.hash, file: p.file }))));
        const res = await posterFetch("/send", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(`${r.contact.name}: ${data.error || "не отправилось"}`);
        replace(data.ws as Workspace);
        done.push(`${r.contact.email} — ${files(pdfs.length)}, ${kb(zip.byteLength)}`);
      }
      setResult({ ok: true, text: `Отправлено: ${done.join("; ")}.` });
    } catch (e) {
      setResult({ ok: false, text: `${done.length ? `Отправлено: ${done.join("; ")}. Дальше не получилось — ` : ""}${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const time = (iso: string, year = false) =>
    new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", ...(year ? { year: "2-digit" } : {}), hour: "2-digit", minute: "2-digit" });

  const row = (d: Doc) => {
    const due = docDue(ws, d);
    const c = changesOf.get(d.id)!;
    return (
      <li key={d.id} className="send-item">
        <input id={`pick-${d.id}`} type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)} aria-label={`Отправить «${title(d)}»`} />
        <button className="send-thumb" onClick={() => setViewing(d.id)} aria-label={`Открыть «${title(d)}» на весь экран`} title="Открыть на весь экран">
          <DocPreview ws={ws} doc={d} fb={fb} className="mini" />
        </button>
        <label className="send-item-text" htmlFor={`pick-${d.id}`}>
          <b>{title(d)}</b>
          <span className="muted">
            {d.kind === "menu" ? "Меню" : "Ценник"} {sizeLabel(d.size)}
            {due && <span className={due.urgent ? "due urgent" : "due"}> · {due.urgent ? "срочно" : `к ${dueDate(due.date)}`}</span>}
          </span>
        </label>
        <span className="send-chg">
          {c.state === "new" ? (
            "Новый, ещё не печатали"
          ) : c.state === "same" ? (
            <span className="muted">Без изменений · {STATUS_LABEL[printStatus(ws, d)].toLowerCase()}</span>
          ) : c.state === "unknown" ? (
            <span title="Копия прошлой отправки не сохранилась: что именно изменилось, будет видно после следующей отправки">Изменён</span>
          ) : (
            <>
              {c.prices.length > 0 && (
                <span className="chg-price" title={priceChangesFull(c)}>
                  {priceChangesText(c)}
                </span>
              )}
              {c.other.length > 0 && <span className="muted">{c.other.join(", ")}</span>}
            </>
          )}
        </span>
      </li>
    );
  };

  return (
    <div className="send" data-tab={tab}>
      <div className="send-main">
        <Tabs id="send" label="Отправка" value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          {(
            [
              ["send", "Что отправить", docs.length],
              ["changes", "Изменения", log.length],
              ["history", "История", history.length],
            ] as const
          ).map(([k, l, n]) => (
            <Tab key={k} value={k} count={n}>
              {l}
            </Tab>
          ))}
        </Tabs>

        <div id="send-panel" role="tabpanel" aria-labelledby={`send-tab-${tab}`} className="send-pane">
          {tab === "send" && (
            <>
              {many && (
                <div className="chips" role="group" aria-label="Кафе">
                  <button className={`chip ${filter === ALL ? "on" : ""}`} aria-pressed={filter === ALL} onClick={() => setCafeFilter(ALL)}>
                    Все кафе
                  </button>
                  {cafes.map((c) => (
                    <button key={c.id} className={`chip ${filter === c.id ? "on" : ""}`} aria-pressed={filter === c.id} onClick={() => setCafeFilter(c.id)}>
                      {cafeLabel(c)} <span className="chip-n">{changed.filter((d) => d.cafeId === c.id).length}</span>
                    </button>
                  ))}
                </div>
              )}
              {visible.length === 0 && (
                <p className="hint">
                  Ожидающих печати нет.{unchanged.length > 0 && !showAll ? " Можно отправить документ и без изменений — откройте список ниже." : ""}
                </p>
              )}
              {visible.length > 0 && (
                <div className="send-item send-head">
                  {master(visible, "Отметить все документы в списке")}
                  <span />
                  <span role="columnheader" aria-sort={ariaSort(sort, "name")}>
                    <SortHeader column="name" sort={sort} onSort={setSort}>
                      Документ
                    </SortHeader>
                  </span>
                  <span role="columnheader" aria-sort={ariaSort(sort, "chg")}>
                    <SortHeader column="chg" sort={sort} onSort={setSort} hint="Сортировать: сначала с изменившейся ценой, потом без неё, потом по срочности">
                      Что изменилось
                    </SortHeader>
                  </span>
                </div>
              )}
              {groups.map((g) => (
                <section key={g.cafe?.id ?? "one"} className="send-group">
                  {g.cafe && (
                    <h3 className="send-cafe">
                      {master(g.docs, `Отметить все документы кафе ${cafeLabel(g.cafe)}`)}
                      {cafeLabel(g.cafe)}{" "}
                      <span className="count">
                        {g.docs.filter((d) => picked.has(d.id)).length} из {g.docs.length}
                      </span>
                    </h3>
                  )}
                  <ul className="send-list">{g.docs.map(row)}</ul>
                </section>
              ))}
              {unchanged.length > 0 && (
                <button className="link" onClick={() => setShowAll(!showAll)}>
                  {showAll ? "Скрыть неизменённые" : `Показать неизменённые (${unchanged.length})`}
                </button>
              )}
            </>
          )}

          {tab === "changes" &&
            (log.length === 0 ? (
              <p className="hint">С прошлой отправки ничего не менялось.</p>
            ) : (
              <ol className="log">
                {log
                  .slice()
                  .reverse()
                  .slice(0, 200)
                  .map((c, i) => (
                    <li key={i}>
                      <time>{time(c.at)}</time> {c.text}
                    </li>
                  ))}
              </ol>
            ))}

          {tab === "history" &&
            (history.length === 0 ? (
              <p className="hint">В типографию ещё ничего не отправляли.</p>
            ) : (
              <>
                <ol className="log">
                  {history.map((s) => (
                    <li key={s.id}>
                      <a className="log-link" href={`#mail/send/${s.id}`} title="Подробно: что ушло и что изменилось">
                        <time>{time(s.at, true)}</time> {s.to} — {files(s.files.length)}
                        {s.bytes ? `, ${kb(s.bytes)}` : ""}
                        {ws.cafes.length > 1 && s.cafeIds?.length ? <span className="muted"> · {s.cafeIds.map(address).filter(Boolean).join(", ")}</span> : null}
                      </a>
                    </li>
                  ))}
                </ol>
                <a className="link" href="#mail">
                  Подробная история — в разделе «Почта»
                </a>
              </>
            ))}
        </div>
      </div>

      <aside className="send-side">
        <MailLink />
        <section className="send-card" aria-labelledby="send-title">
          <header className="send-side-head" aria-live="polite">
            <h2 id="send-title" className="label">
              {docs.length ? `Отправить ${docs.length} в печать` : "Отправить в печать"}
            </h2>
            <p className="muted">{lastSend}</p>
          </header>
          <section className="block" aria-label="Кому">
            <ul className="contacts">
              {ws.contacts.map((c) => {
                const on = sel.has(c.id);
                const n = routes.find((r) => r.contact.id === c.id)?.docs.length ?? 0;
                return (
                  <li key={c.id} className={`contact ${on ? "on" : ""}`}>
                    <label className="contact-main">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setSel((s) => {
                            const x = new Set(s);
                            if (on) x.delete(c.id);
                            else x.add(c.id);
                            return x;
                          })
                        }
                      />
                      <span>
                        <b>{c.name}</b>
                        <span className="muted">{c.email}</span>
                      </span>
                      {on && <span className="count contact-n">{n}</span>}
                    </label>
                    {on && (
                      <div className="contact-more">
                        {ws.cafes.length > 1 && (
                          <div className="chips" role="group" aria-label={`Для каких кафе печатает ${c.name}`}>
                            {ws.cafes.map((k) => {
                              const serves = contactServes(c, k.id);
                              return (
                                <button
                                  key={k.id}
                                  className={`chip small ${serves ? "on" : ""}`}
                                  role="switch"
                                  aria-checked={serves}
                                  onClick={() => setCafes(c, k.id, !serves)}
                                >
                                  {cafeLabel(k)}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <button
                          className="link small quiet"
                          onClick={() => {
                            offerUndo(`Получатель «${c.name}» удалён`, ws);
                            update((w) => void (w.contacts = w.contacts.filter((k) => k.id !== c.id)));
                          }}
                        >
                          Удалить получателя
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {adding ? (
              <form
                className="contact-new"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  addContact();
                }}
              >
                <label className="field">
                  <span>Имя или название</span>
                  <input
                    className="text-input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Типография «…»"
                    autoComplete="organization"
                  />
                </label>
                <div className="field">
                  <label htmlFor="new-contact-email">Почта</label>
                  <input
                    id="new-contact-email"
                    className="text-input"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    spellCheck={false}
                    value={newEmail}
                    onChange={(e) => {
                      setNewEmail(e.target.value);
                      setNewErr(null);
                    }}
                    placeholder="print@example.ru"
                    aria-invalid={!!newErr || undefined}
                    aria-describedby={newErr ? "new-contact-email-err" : undefined}
                  />
                  {newErr && (
                    <p id="new-contact-email-err" className="field-error" role="alert">
                      {newErr}
                    </p>
                  )}
                </div>
                <div className="contact-new-actions">
                  <button className="btn small" type="submit" disabled={!newEmail.trim()}>
                    Добавить
                  </button>
                  {ws.contacts.length > 0 && (
                    <button
                      className="link"
                      type="button"
                      onClick={() => {
                        setAdding(false);
                        setNewErr(null);
                      }}
                    >
                      Отмена
                    </button>
                  )}
                </div>
              </form>
            ) : (
              <button className="btn plain small" onClick={() => setAdding(true)}>
                <Icon name="plus" size={16} /> Получатель
              </button>
            )}
            {orphanCafes.length > 0 && recipients.length > 0 && (
              <p className="error" role="status">
                Без получателя: {orphanCafes.map(address).join(", ")}. Отметьте кафе у получателя или добавьте ещё одного.
              </p>
            )}
            <label className="field send-note">
              <span>Комментарий в письме (необязательно)</span>
              <textarea
                className="text-input"
                rows={2}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Например: тираж 5 шт., ламинация"
              />
            </label>
            <label className="switch">
              <input type="checkbox" className="toggle" checked={print} onChange={(e) => setPrint(e.target.checked)} />
              <span>Вылеты 3 мм и метки реза</span>
            </label>
            {mail?.configured && <p className="hint">К письму приложится список изменений.</p>}
          </section>

          <div className="send-actions">
            {mail && !mail.configured && (
              <a className="hint send-nomail" href="#mail/settings">
                Чтобы отправлять письмом, подключите почту в разделе «Почта» → «Настройки».
              </a>
            )}
            <button className="btn primary" disabled={!routes.length || !!busy || !fb || !mail?.configured} aria-busy={sending} onClick={onSend}>
              {sending ? busy : `Отправить в типографию${routed.size ? ` · ${routed.size}` : ""}`}
            </button>
            {routes.length > 1 && !busy && (
              <p className="hint send-routes">
                {letters(routes.length)}: {routes.map((r) => `${r.contact.name} — ${r.docs.length}`).join(", ")}
              </p>
            )}
            <button className="btn" disabled={!docs.length || !!busy || !fb} aria-busy={busy === ZIPPING} onClick={onDownload}>
              {busy === ZIPPING ? busy : "Скачать архив"}
            </button>
          </div>
          {result && (
            <div className={`banner ${result.ok ? "ok" : "danger"}`} role="status">
              <span>{result.text}</span>
              {result.ok && lastBuilt && (
                <button className="btn small" onClick={markSent}>
                  Отметить отправленным
                </button>
              )}
            </div>
          )}
          {lastBuilt?.some((p) => p.warnings.length) && (
            <ul className="warnings">
              {lastBuilt.flatMap((p) =>
                p.warnings.map((w) => (
                  <li key={p.doc.id + w}>
                    {p.doc.name}: {w}
                  </li>
                )),
              )}
            </ul>
          )}
        </section>
      </aside>

      {viewing && <DocViewer docs={visible} id={viewing} onId={setViewing} onClose={() => setViewing(null)} picked={picked} onToggle={toggle} />}
    </div>
  );
}
