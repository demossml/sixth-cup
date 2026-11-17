import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MutableRefObject, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { PriceOrigin } from "@/lib/catalog";
import type { Price } from "@/lib/model";
import { Icon, PriceInput } from "./ui";

/*
  Цена в таблице меню. Три вида:
    своя (строка не связана с базой) — обычное поле, правится сразу;
    из базы — кнопка: наведение показывает карточку с датой изменения цены, клик закрепляет карточку;
      товар в админке открывается из карточки.
      Изменить: начать вводить цифры на цене, F2 или кнопка «Изменить» в карточке;
    своя в связанной строке («только для меню») — поле с синей меткой, в карточке — цена в базе и «Вернуть».
  У связанной строки новая цена не применяется молча: над ценой всплывает выбор
  «Только для меню» / «Обновить в базе тоже».
*/

const parse = (t: string): Price => (t === "" ? null : Number(t));
const show = (p: Price | undefined) => (p == null ? "—" : String(p));
const digits = (t: string) => t.replace(/[^\d]/g, "").slice(0, 6);
const when = (ms: number) =>
  new Date(ms).toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const touchOnly = () => typeof matchMedia !== "undefined" && matchMedia("(hover: none)").matches;
/** Адрес раздела админки (она на том же сервере, у неё hash-маршруты). */
export const adminHref = (path: string) => `${location.origin}/#${path}`;

export interface PriceCellProps {
  value: Price;
  label: string;
  className: string;
  nav?: number;
  origin: PriceOrigin;
  /** Строка без связи с базой: цена меняется сразу, на каждую цифру. */
  onManual: (v: Price) => void;
  /** «Только для меню»: цена ставится в строку, колонка перестаёт сверяться с базой. */
  onMenuOnly: (v: Price) => void;
  /** «Обновить в базе тоже»: записать в базу, потом поставить в строку. Ошибка — текстом в окне выбора. */
  onUpdateDb: (v: number) => Promise<void>;
  /** Своя цена связанной строки → снова из базы. */
  onRestore: () => void;
}

export function PriceCell(props: PriceCellProps) {
  if (props.origin.kind === "manual")
    return <PriceInput className={props.className} nav={props.nav} label={props.label} value={props.value} onChange={props.onManual} />;
  return <LinkedPrice {...props} />;
}

/** Открыта одна карточка на всю таблицу: новая закрывает предыдущую. */
let closeOpenCard: (() => void) | null = null;
/** Когда закрылась последняя карточка: курсор переходит на соседнюю цену — её карточка почти без задержки. */
let lastCardAt = 0;
/** Карточка — как подсказка: открывается, когда курсор остановился на цене и подержался, а не когда пролетает мимо. */
const DWELL = 700;
const DWELL_WARM = 150; // сразу после соседней карточки
const WARM_WINDOW = 500;

type Mode = { k: "view" } | { k: "edit"; text: string } | { k: "ask"; text: string; busy: boolean; error: string | null };

function LinkedPrice({ value, label, className, nav, origin, onMenuOnly, onUpdateDb, onRestore }: PriceCellProps) {
  const [mode, setMode] = useState<Mode>({ k: "view" });
  const [card, setCard] = useState<false | "hover" | "pinned">(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const floating = useRef<HTMLDivElement | null>(null); // карточка или окно выбора — в портале, вне wrap
  const inside = (n: Node | null) => !!n && (!!wrap.current?.contains(n) || !!floating.current?.contains(n));
  const cell = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const timer = useRef<number>();
  const cardId = useId();
  const own = origin.kind === "own";
  const href = origin.adminPath ? adminHref(origin.adminPath) : undefined;
  const editing = mode.k !== "view";
  const text = mode.k === "view" ? (value == null ? "" : String(value)) : mode.text;

  const refocus = () => requestAnimationFrame(() => cell.current?.focus());
  const startEdit = (t: string) => {
    setCard(false);
    setMode({ k: "edit", text: t });
  };
  const commit = () => {
    if (mode.k !== "edit") return;
    if (parse(mode.text) === value) return setMode({ k: "view" });
    setMode({ k: "ask", text: mode.text, busy: false, error: null });
  };
  const cancel = () => {
    setMode({ k: "view" });
    refocus();
  };
  const menuOnly = () => {
    if (mode.k !== "ask") return;
    onMenuOnly(parse(mode.text));
    setMode({ k: "view" });
    refocus();
  };
  const toDb = async () => {
    if (mode.k !== "ask" || mode.busy) return;
    const v = parse(mode.text);
    if (v == null) return;
    setMode({ ...mode, busy: true, error: null });
    try {
      await onUpdateDb(v);
      setMode({ k: "view" });
      refocus();
    } catch (e) {
      setMode({ k: "ask", text: mode.text, busy: false, error: (e as Error).message || "Не получилось" });
    }
  };

  // поле правки получает фокус, курсор — в конец (первая цифра уже набрана)
  useEffect(() => {
    if (mode.k !== "edit" || own) return;
    const el = input.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [mode.k, own]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!card) return;
    const close = () => setCard(false);
    if (closeOpenCard && closeOpenCard !== close) closeOpenCard();
    closeOpenCard = close;
    return () => {
      if (closeOpenCard === close) closeOpenCard = null;
      lastCardAt = Date.now();
    };
  }, [card]);

  // карточка по наведению: таймер идёт, пока курсор стоит на цене, и начинается заново при каждом движении —
  // так она не всплывает, пока курсор едет по таблице. По фокусу и клику — сразу; уходит, когда курсор и фокус ушли
  const hoverIn = () => {
    window.clearTimeout(timer.current); // курсор вернулся на цену или на карточку — не закрывать
    if (touchOnly() || editing || card) return;
    const warm = !!closeOpenCard || Date.now() - lastCardAt < WARM_WINDOW;
    timer.current = window.setTimeout(() => setCard((c) => c || "hover"), warm ? DWELL_WARM : DWELL);
  };
  const hoverOut = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCard((c) => (c === "hover" && !inside(document.activeElement) ? false : c)), 150);
  };
  const blurOut = (e: FocusEvent) => {
    if (!inside(e.relatedTarget as Node | null)) setCard(false);
  };

  // нажатие вне — закрыть закреплённую карточку (телефон); вне окна выбора — отменить правку
  useEffect(() => {
    if (card !== "pinned" && mode.k !== "ask") return;
    const down = (e: PointerEvent) => {
      if (inside(e.target as Node)) return;
      if (mode.k === "ask" && !mode.busy) setMode({ k: "view" });
      setCard(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [card, mode]);

  const keysOnLink = (e: KeyboardEvent) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      startEdit(e.key);
    } else if (e.key === "F2") {
      e.preventDefault();
      startEdit(value == null ? "" : String(value));
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      startEdit("");
    } else if (e.key === "Escape" && card) {
      e.stopPropagation();
      setCard(false);
    }
  };
  const keysOnInput = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation(); // не уходить на строку ниже — сначала выбор
      commit();
    } else if (e.key === "Escape" && mode.k === "edit") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };

  const field = editing || own ? (
    <input
      ref={(el) => {
        input.current = el;
        cell.current = el;
      }}
      className={`${className} ${own ? "pc-own" : "pc-edit"}`}
      data-nav={nav}
      data-nav-free=""
      inputMode="numeric"
      pattern="[0-9]*"
      enterKeyHint="done"
      aria-label={own ? `${label}: своя цена только для меню` : label}
      aria-describedby={own ? cardId : undefined}
      placeholder="—"
      readOnly={mode.k === "ask"}
      value={text}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => {
        commit();
        blurOut(e);
      }}
      onKeyDown={keysOnInput}
      onChange={(e) => {
        setCard(false);
        setMode({ k: "edit", text: digits(e.target.value) });
      }}
    />
  ) : (
    // цена из базы — кнопка: наведение показывает карточку, клик закрепляет её (переход в админку — из карточки)
    <button
      ref={(el) => {
        cell.current = el;
      }}
      type="button"
      className={`${className} pc-link${origin.missing ? " missing" : ""}`}
      data-nav={nav}
      aria-label={`${label}: ${show(value)}, цена из базы`}
      aria-describedby={cardId}
      aria-expanded={card === "pinned"}
      onClick={() => setCard((c) => (c === "pinned" ? false : "pinned"))}
      onFocus={() => setCard((c) => c || "hover")}
      onBlur={blurOut}
      onKeyDown={keysOnLink}
    >
      {show(value)}
    </button>
  );

  return (
    <span ref={wrap} className="pc" onMouseEnter={hoverIn} onMouseMove={hoverIn} onMouseLeave={hoverOut}>
      {field}
      {card && !editing && (
        <Floating anchor={cell} box={floating} className="pc-card" onMouseEnter={hoverIn} onMouseLeave={hoverOut} onBlur={blurOut}>
          <div id={cardId} role="tooltip">
            <CardText origin={origin} value={value} />
          </div>
          <div className="pc-card-actions">
            {own ? (
              <button type="button" className="pc-act" onClick={() => (setCard(false), onRestore(), refocus())}>
                <Icon name="undo" size={16} />
                <span>Вернуть цену из базы</span>
                {origin.dbPrice != null && <span className="pc-act-hint">{origin.dbPrice}</span>}
              </button>
            ) : (
              <button type="button" className="pc-act" onClick={() => startEdit(value == null ? "" : String(value))}>
                <Icon name="edit" size={16} />
                <span>Изменить цену</span>
              </button>
            )}
            {href && (
              <a className="pc-act" href={href} target="_blank" rel="noopener" onClick={() => setCard(false)}>
                <Icon name="external" size={16} />
                <span>{origin.via === "milk" ? "Открыть схему молока" : "Открыть в админке"}</span>
              </a>
            )}
          </div>
        </Floating>
      )}
      {mode.k === "ask" && (
        <Floating anchor={cell} box={floating} className="pc-ask" role="dialog" label={`Новая цена ${label}`}>
          <AskBody
            from={value}
            to={parse(mode.text)}
            origin={origin}
            busy={mode.busy}
            error={mode.error}
            onMenuOnly={menuOnly}
            onDb={() => void toDb()}
            onCancel={cancel}
          />
        </Floating>
      )}
    </span>
  );
}

function CardText({ origin, value }: { origin: PriceOrigin; value: Price }) {
  const date = origin.size?.updatedAt;
  const stamp = date ? `Изменена в базе ${when(date)}` : origin.size ? "Дата изменения в базе неизвестна" : null;
  if (origin.kind === "own")
    return (
      <>
        <b>Своя цена, только для меню</b>
        <span>
          {value == null ? "В меню без цены" : `В меню ${value}`}, в базе {origin.dbPrice == null ? "цены нет" : origin.dbPrice}. Изменения из базы сюда не приходят.
        </span>
      </>
    );
  return (
    <>
      <b>
        Цена из базы{origin.size ? ` · ${origin.size.label}` : ""}
        {origin.via === "milk" && origin.surcharge != null ? ` + молоко ${origin.surcharge}` : ""}
      </b>
      {origin.missing ? (
        <span className="pc-warn">Товара или размера в базе больше нет — печатается последняя цена.</span>
      ) : origin.size == null && origin.via === "product" ? (
        <span>У товара в базе нет такого размера.</span>
      ) : (
        stamp && <span>{stamp}</span>
      )}
    </>
  );
}

function AskBody({ from, to, origin, busy, error, onMenuOnly, onDb, onCancel }: {
  from: Price;
  to: Price;
  origin: PriceOrigin;
  busy: boolean;
  error: string | null;
  onMenuOnly: () => void;
  onDb: () => void;
  onCancel: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const why =
    origin.via === "milk"
      ? "Доплата за молоко меняется в схеме молока — отсюда в базу не записать."
      : origin.missing || !origin.dbKey
        ? "Этого размера нет в базе — цена будет только в меню."
        : to == null
          ? "Пустую цену в базу не записать."
          : null;
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <p className="pc-ask-title">
        <span className="pc-old">{show(from)}</span> → <b>{show(to)}</b>
      </p>
      <div className="pc-ask-actions">
        <button ref={first} type="button" className="btn small" disabled={busy} onClick={onMenuOnly}>
          Только для меню
        </button>
        {!why && (
          <button type="button" className="btn small primary" disabled={busy} aria-busy={busy} onClick={onDb}>
            {busy ? "Записываю…" : "Обновить в базе тоже"}
          </button>
        )}
      </div>
      {why && <p className="pc-ask-note">{why}</p>}
      {error && (
        <p className="pc-ask-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Всплывающий блок над ячейкой (под ней, если сверху не хватает места). В портале на body и fixed:
 * таблица лежит в контейнере с container-type и прокруткой — внутри них fixed не работает и обрезается.
 */
function Floating({ anchor, box, className, role, label, children, onMouseEnter, onMouseLeave, onBlur }: {
  anchor: RefObject<HTMLElement | null>;
  box: MutableRefObject<HTMLDivElement | null>;
  className: string;
  role?: string;
  label?: string;
  children: ReactNode;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onBlur?: (e: FocusEvent) => void;
}) {
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = box.current;
      if (!a || !el) return;
      const gap = 6;
      const edge = 8;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const above = a.top - h - gap >= edge;
      const top = above ? a.top - h - gap : a.bottom + gap;
      const left = Math.max(edge, Math.min(a.left + a.width / 2 - w / 2, window.innerWidth - w - edge)); // по центру над ценой
      el.style.top = `${Math.round(top)}px`;
      el.style.left = `${Math.round(left)}px`;
      el.dataset.side = above ? "above" : "below";
      el.style.visibility = a.bottom < 0 || a.top > window.innerHeight ? "hidden" : "";
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  });
  return createPortal(
    <div
      ref={(el) => void (box.current = el)}
      className={`pc-float ${className}`}
      role={role}
      aria-label={label}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onBlur={onBlur}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Откуда цена — строкой под полем (редактор ценника): цена из базы — ссылкой на товар, с датой изменения. */
export function PriceSourceLine({ origin, value }: { origin: PriceOrigin; value: Price }) {
  const href = origin.adminPath ? adminHref(origin.adminPath) : undefined;
  const date = origin.size?.updatedAt;
  if (origin.kind === "manual")
    return (
      <p className="pc-line">
        <b>{show(value)}</b> <span className="muted">— своя цена строки меню, меняется в таблице меню</span>
      </p>
    );
  if (origin.kind === "own")
    return (
      <p className="pc-line">
        <b>{show(value)}</b>{" "}
        <span className="muted">
          — своя цена только для меню, в базе {origin.dbPrice == null ? "цены нет" : origin.dbPrice}
        </span>
      </p>
    );
  return (
    <p className="pc-line">
      {href ? (
        <a className="pc-line-link" href={href} target="_blank" rel="noopener" title="Открыть в админке">
          {show(value)}
        </a>
      ) : (
        <b>{show(value)}</b>
      )}{" "}
      <span className="muted">
        — из базы{origin.via === "milk" ? " (напиток + молоко)" : ""}
        {origin.missing ? ", товара в базе больше нет" : date ? `, изменена ${when(date)}` : ""}
      </span>
    </p>
  );
}
