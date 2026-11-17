import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cafeLabel, uid, type Cafe, type Contact } from "@/lib/model";
import { HoverCard, HoverCardAction, HoverCardActions, HoverCardContent, HoverCardFact, HoverCardFacts, HoverCardHead, HoverCardTrigger } from "./kit";
import { Icon, Sheet } from "./ui";
import { useWs } from "./WorkspaceProvider";

// «Почта» → «Контакты»: кому уходят макеты. У контакта имя, адрес и кафе, для которых он печатает:
// можно отметить несколько (например, все кафе одного города) или «Все кафе» — тогда и новые тоже.
// Новый контакт: на широком экране — карточка справа, как блок отправки на главной, раскрывается по заголовку;
// на телефоне — кнопка над списком, форма открывается шторкой.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const short = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

type Draft = { name: string; email: string; cafeIds: string[] | null }; // null — все кафе

const WIDE = "(min-width: 960px)";
const useWide = () =>
  useSyncExternalStore(
    (cb) => {
      const m = matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matchMedia(WIDE).matches,
    () => true,
  );

// раскрыта ли карточка «Новый контакт» — помнится на устройстве и читается до первой отрисовки, без мигания
const OPEN_KEY = "m67.contactNewOpen";
const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
};

/** edit — id контакта из адреса #mail/contacts/<id>: он открыт на правку (переход из карточки адресата). */
export function Contacts({ edit }: { edit?: string }) {
  const { ws, update, offerUndo } = useWs();
  const wide = useWide();
  const [editing, setEditing] = useState<string | null>(() => (edit && ws.contacts.some((c) => c.id === edit) ? edit : null));
  useEffect(() => {
    // id в адресе нужен один раз: после закрытия правки обновление страницы её не откроет снова
    if (edit) history.replaceState(null, "", "#mail/contacts");
  }, [edit]);
  const editingContact = ws.contacts.find((c) => c.id === editing);
  /** Закрыть окно правки и вернуть фокус на строку контакта, с которой его открыли. */
  const closeEdit = () => {
    const id = editing;
    setEditing(null);
    if (id) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`#ct-${id} .ct-row`)?.focus());
  };
  const [sheet, setSheet] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const lastSend = useMemo(() => {
    const m = new Map<string, { id: string; at: string }>();
    for (const s of ws.sends) m.set(s.to.toLowerCase(), { id: s.id, at: s.at });
    return m;
  }, [ws.sends]);

  const save = (id: string | null, d: Draft) => {
    const contact: Contact = { id: id ?? uid("c"), name: d.name.trim() || d.email.trim(), email: d.email.trim(), ...(d.cafeIds ? { cafeIds: d.cafeIds } : {}) };
    update((w) => {
      const i = w.contacts.findIndex((c) => c.id === id);
      if (i >= 0) w.contacts[i] = contact;
      else w.contacts.push(contact);
    });
    closeEdit();
  };
  const closeSheet = () => {
    setSheet(false);
    opener.current?.focus();
  };

  return (
    <div className="ct-layout">
      <div className="ct-main">
        <p className="muted ct-intro">Кому уходят макеты. Письмо получает каждый контакт со своими кафе — каждому свой архив.</p>
        {!wide && (
          <button ref={opener} className="btn plain block ct-open" onClick={() => setSheet(true)} aria-haspopup="dialog">
            <Icon name="plus" size={16} /> Новый контакт
          </button>
        )}
        {ws.contacts.length === 0 ? (
          <div className="ct-empty">
            <b>Контактов пока нет</b>
            <p className="muted">Добавьте типографию — её адрес появится в блоке отправки на главной.</p>
          </div>
        ) : (
          <ul className="ct-list">
            {ws.contacts.map((c) => (
                <li key={c.id} id={`ct-${c.id}`} className="ct-item">
                  <button className="ct-row" onClick={() => setEditing(c.id)} aria-label={`Изменить контакт «${c.name}»`} aria-haspopup="dialog">
                    <span className="ct-who">
                      <b>{c.name}</b>
                      <span className="muted">{c.email}</span>
                    </span>
                    <span className="ct-cafes">{cafesText(ws.cafes, c)}</span>
                    <span className="ct-last muted">{lastSend.has(c.email.toLowerCase()) ? `Отправка ${short(lastSend.get(c.email.toLowerCase())!.at)}` : "Ещё не отправляли"}</span>
                    <Icon name="edit" size={16} />
                  </button>
                </li>
            ))}
          </ul>
        )}
      </div>

      {wide && (
        <aside className="ct-side">
          <NewContactCard cafes={ws.cafes} contacts={ws.contacts} onSave={(d) => save(null, d)} />
        </aside>
      )}

      {/* правка контакта — в окне: белом, узком, поля одной колонкой (почта под именем) */}
      {editingContact && (
        <Sheet size="form" title="Изменить контакт" onClose={closeEdit}>
          <ContactForm
            variant="plain"
            cafes={ws.cafes}
            contacts={ws.contacts}
            initial={editingContact}
            onSave={(d) => save(editingContact.id, d)}
            onCancel={closeEdit}
            onDelete={() => {
              offerUndo(`Контакт «${editingContact.name}» удалён`, ws);
              update((w) => void (w.contacts = w.contacts.filter((k) => k.id !== editingContact.id)));
              setEditing(null);
            }}
          />
        </Sheet>
      )}

      {!wide && sheet && (
        <Sheet title="Новый контакт" onClose={closeSheet}>
          <ContactForm
            variant="plain"
            autoFocus
            cafes={ws.cafes}
            contacts={ws.contacts}
            onSave={(d) => {
              save(null, d);
              closeSheet();
            }}
            onCancel={closeSheet}
          />
        </Sheet>
      )}
    </div>
  );
}

/** Карточка справа, как «Отправить в печать» на главной: заголовок раскрывает и сворачивает форму. */
function NewContactCard({ cafes, contacts, onSave }: { cafes: Cafe[]; contacts: Contact[]; onSave: (d: Draft) => void }) {
  const [open, setOpen] = useState(readOpen);
  const [round, setRound] = useState(0); // новая форма после добавления — пустые поля
  const [focus, setFocus] = useState(false); // фокус в имя — только когда раскрыли сами, не при загрузке
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      /* приватный режим: запомнится до перезагрузки */
    }
  }, [open]);
  return (
    <section className={`ct-card ${open ? "open" : ""}`} aria-labelledby="ct-new-title">
      <h2 className="ct-card-title">
        <button
          id="ct-new-title"
          className="ct-card-toggle"
          aria-expanded={open}
          aria-controls="ct-new-body"
          onClick={() => {
            setOpen(!open);
            // раскрыли сами — курсор сразу в «Имя» (форма уже в DOM, autoFocus не сработает повторно)
            if (!open) requestAnimationFrame(() => document.querySelector<HTMLInputElement>("#ct-new-body input")?.focus({ preventScroll: true }));
          }}
        >
          Новый контакт
          <Icon name="chevron" size={16} />
        </button>
      </h2>
      <div id="ct-new-body" className="ct-card-body" inert={open ? undefined : ""}>
        <div className="ct-card-inner">
          <ContactForm
            key={round}
            variant="plain"
            autoFocus={focus}
            cafes={cafes}
            contacts={contacts}
            onSave={(d) => {
              onSave(d);
              setFocus(true);
              setRound((r) => r + 1);
            }}
            onCancel={() => {
              setRound((r) => r + 1);
              setOpen(false);
            }}
          />
        </div>
      </div>
    </section>
  );
}

export function cafesText(cafes: Cafe[], c: Contact): string {
  if (!c.cafeIds) return cafes.length > 1 ? "Все кафе" : cafeLabel(cafes[0]);
  if (!c.cafeIds.length) return "Кафе не выбраны";
  const names = c.cafeIds.map((id) => cafes.find((k) => k.id === id)).filter((k): k is Cafe => !!k).map(cafeLabel);
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} и ещё ${names.length - 2}` : names.join(", ");
}

function ContactForm({
  cafes,
  contacts,
  initial,
  variant = "inline",
  autoFocus = false,
  onSave,
  onCancel,
  onDelete,
}: {
  cafes: Cafe[];
  contacts: Contact[];
  initial?: Contact;
  /** inline — правка в списке (на сером); plain — в карточке и шторке (на белом, в одну колонку) */
  variant?: "inline" | "plain";
  autoFocus?: boolean;
  onSave: (d: Draft) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [d, setD] = useState<Draft>({ name: initial?.name ?? "", email: initial?.email ?? "", cafeIds: initial?.cafeIds ? [...initial.cafeIds] : null });
  // ошибка показывается под тем полем, к которому относится; появляется по «Добавить», исчезает, как только поле поправили
  const [error, setError] = useState<{ field: "email" | "cafes"; text: string } | null>(null);
  const fid = useId();
  const emailErrId = `${fid}-email-err`;
  const cafesErrId = `${fid}-cafes-err`;
  const all = d.cafeIds === null;
  const has = (id: string) => all || d.cafeIds!.includes(id);
  const clearCafesErr = () => error?.field === "cafes" && setError(null);
  const toggle = (id: string) => {
    clearCafesErr();
    setD((x) => {
      const cur = x.cafeIds ?? cafes.map((c) => c.id);
      const next = cur.includes(id) ? cur.filter((k) => k !== id) : [...cur, id];
      return { ...x, cafeIds: cafes.filter((c) => next.includes(c.id)).map((c) => c.id) };
    });
  };

  const submit = () => {
    const email = d.email.trim();
    if (!email) return setError({ field: "email", text: "Введите адрес почты" });
    if (!EMAIL.test(email)) return setError({ field: "email", text: "Проверьте адрес почты — например, print@example.ru" });
    if (contacts.some((c) => c.id !== initial?.id && c.email.toLowerCase() === email.toLowerCase()))
      return setError({ field: "email", text: "Такой адрес уже есть в контактах" });
    if (d.cafeIds && !d.cafeIds.length && cafes.length > 1) return setError({ field: "cafes", text: "Отметьте хотя бы одно кафе" });
    onSave(d);
  };
  const emailErr = error?.field === "email";

  return (
    // noValidate: проверяем сами и пишем ошибку под полем, а не всплывающей подсказкой браузера
    <form
      className={`ct-form ${variant}`}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="ct-fields">
        <label className="field">
          <span>Имя или название</span>
          <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Типография «…»" autoComplete="organization" autoFocus={autoFocus} />
        </label>
        <div className="field">
          <label htmlFor={`${fid}-email`}>Почта</label>
          <input
            id={`${fid}-email`}
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            value={d.email}
            onChange={(e) => {
              setD({ ...d, email: e.target.value });
              if (emailErr) setError(null);
            }}
            placeholder="print@example.ru"
            required
            aria-invalid={emailErr || undefined}
            aria-describedby={emailErr ? emailErrId : undefined}
          />
          {emailErr && (
            <p id={emailErrId} className="field-error" role="alert">
              {error.text}
            </p>
          )}
        </div>
      </div>
      {cafes.length > 1 && (
        <fieldset className="ct-cafe-picker" aria-invalid={error?.field === "cafes" || undefined} aria-describedby={error?.field === "cafes" ? cafesErrId : undefined}>
          <legend>Для каких кафе печатает</legend>
          <label className="ct-check ct-check-all">
            <input
              type="checkbox"
              checked={all || d.cafeIds!.length === cafes.length}
              ref={(el) => {
                if (el) el.indeterminate = !all && d.cafeIds!.length > 0 && d.cafeIds!.length < cafes.length;
              }}
              onChange={() => {
                clearCafesErr();
                setD({ ...d, cafeIds: all || d.cafeIds!.length === cafes.length ? [] : null });
              }}
            />
            <span>Все кафе</span>
            <span className="muted">и те, что добавят потом</span>
          </label>
          <ul className="ct-check-list">
            {cafes.map((c) => (
              <li key={c.id}>
                <label className="ct-check">
                  <input type="checkbox" checked={has(c.id)} onChange={() => toggle(c.id)} />
                  <span>{cafeLabel(c)}</span>
                </label>
              </li>
            ))}
          </ul>
          {error?.field === "cafes" ? (
            <p id={cafesErrId} className="field-error ct-cafes-err" role="alert">
              {error.text}
            </p>
          ) : (
            <small className="hint">Можно отметить несколько — например, все кафе одного города.</small>
          )}
        </fieldset>
      )}
      <div className="ct-actions">
        <button className="btn primary small" type="submit">
          {initial ? "Сохранить" : "Добавить"}
        </button>
        <button className="btn small" type="button" onClick={onCancel}>
          Отмена
        </button>
        {onDelete && (
          <button className="link danger ct-delete" type="button" onClick={onDelete}>
            Удалить контакт
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Адресат — тег с карточкой контакта (по наведению или нажатию): адрес, кафе, сколько отправок ушло,
 * и действия — скопировать адрес, написать, изменить или добавить в контакты.
 * cafeIds — кафе, для которых добавить контакт, если его ещё нет (кафе отправки).
 */
export function ContactTag({ email, name, cafeIds = [] }: { email: string; name: string; cafeIds?: string[] }) {
  const { ws, update, offerUndo } = useWs();
  const key = email.toLowerCase();
  const contact = ws.contacts.find((c) => c.email.toLowerCase() === key);
  const sent = ws.sends.filter((s) => s.to.toLowerCase() === key);
  const last = sent.at(-1);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
    } catch {
      /* без доступа к буферу — адрес виден в карточке, его можно выделить */
    }
  };
  const add = () => {
    offerUndo(`Контакт «${name}» добавлен`, ws);
    const some = ws.cafes.length > 1 && cafeIds.length > 0;
    update((w) => void w.contacts.push({ id: uid("c"), name: name || email, email, ...(some ? { cafeIds } : {}) }));
  };
  return (
    <HoverCard label={`Контакт ${name}`} onOpenChange={(o) => !o && setCopied(false)}>
      <HoverCardTrigger>{name}</HoverCardTrigger>
      <HoverCardContent>
        <HoverCardHead title={contact?.name ?? name} sub={email} />
        <HoverCardFacts>
          {ws.cafes.length > 1 && <HoverCardFact term="Кафе">{contact ? cafesText(ws.cafes, contact) : "—"}</HoverCardFact>}
          <HoverCardFact term="Отправок">
            {sent.length}
            {last && <span className="muted"> · последняя {short(last.at)}</span>}
          </HoverCardFact>
          {!contact && <HoverCardFact term="Контакт">Нет в контактах</HoverCardFact>}
        </HoverCardFacts>
        <HoverCardActions>
          <HoverCardAction icon={copied ? "check" : "copy"} onClick={() => void copy()}>
            {copied ? "Адрес скопирован" : "Скопировать адрес"}
          </HoverCardAction>
          <HoverCardAction icon="send" href={`mailto:${email}`}>
            Написать письмо
          </HoverCardAction>
          {contact ? (
            <HoverCardAction icon="edit" href={`#mail/contacts/${contact.id}`}>
              Изменить контакт
            </HoverCardAction>
          ) : (
            <HoverCardAction icon="plus" onClick={add}>
              Добавить в контакты
            </HoverCardAction>
          )}
        </HoverCardActions>
      </HoverCardContent>
    </HoverCard>
  );
}
