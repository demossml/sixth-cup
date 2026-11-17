
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { usePresence } from "./presence";
import { createPortal } from "react-dom";
import { Icon } from "./ui";

// Выпадающий список в стиле конструктора: белый лист с тенью, пункт под курсором — синий.
// Заменяет системный <select> везде. С клавиатуры: Enter/пробел/↓ открывают, ↑↓ Home End ходят,
// Enter выбирает, Esc закрывает, буква — прыжок к пункту.

export type SelectOption =
  | { value: string; label: string; sub?: string; hint?: string; disabled?: boolean; indent?: boolean; action?: boolean }
  | { group: string }
  | { sep: true };

type Item = Extract<SelectOption, { value: string }>;
const isItem = (o: SelectOption): o is Item => "value" in o;

export function Select({
  value, onChange, options, label, variant = "field", align = "left", className, display, nav, arrowsOpen = true,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Название для экранного диктора, если рядом нет видимой подписи. */
  label?: string;
  /** field — как поле ввода; quiet — текст со стрелкой; title — крупнее, для шапки. */
  variant?: "field" | "quiet" | "title";
  align?: "left" | "right";
  className?: string;
  /** Что показать на кнопке вместо названия выбранного пункта. */
  display?: ReactNode;
  /** Номер колонки для навигации стрелками по таблице. */
  nav?: number;
  /** false — в закрытом виде стрелки не открывают список (в таблице они ходят по строкам). */
  arrowsOpen?: boolean;
}) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { mounted, closing } = usePresence(open);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const selectable = options.map((o, i) => (isItem(o) && !o.disabled ? i : -1)).filter((i) => i >= 0);
  const current = options.find((o): o is Item => isItem(o) && !o.action && o.value === value);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 200 && above > below;
    setPos({
      minWidth: Math.max(r.width, 160),
      maxHeight: Math.max(120, Math.min(420, up ? above : below)),
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      ...(align === "right" ? { right: Math.max(12, window.innerWidth - r.right) } : { left: Math.max(12, r.left) }),
    });
  };
  const show = () => {
    place();
    const at = options.findIndex((o) => isItem(o) && !o.action && o.value === value);
    setActive(at >= 0 ? at : (selectable[0] ?? -1));
    setOpen(true);
    btn.current?.focus(); // Safari не фокусирует кнопку по клику, а клавиши списка слушает она
  };
  const close = () => setOpen(false);
  const choose = (i: number) => {
    const o = options[i];
    if (!o || !isItem(o) || o.disabled) return;
    close();
    btn.current?.focus();
    if (o.action || o.value !== value) onChange(o.value);
  };

  // список не должен вылезать за правый край экрана
  useLayoutEffect(() => {
    if (!open || !list.current) return;
    const r = list.current.getBoundingClientRect();
    if (r.right > window.innerWidth - 12 && pos.left !== undefined) setPos((p) => ({ ...p, left: Math.max(12, window.innerWidth - 12 - r.width) }));
  }, [open, pos.left]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) close();
    };
    const scrolled = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) close();
    };
    // Esc закрывает список, даже если фокус ушёл с кнопки; переход на другую страницу — тоже
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc, true);
    window.addEventListener("resize", close);
    window.addEventListener("hashchange", close);
    window.addEventListener("scroll", scrolled, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("hashchange", close);
      window.removeEventListener("scroll", scrolled, true);
    };
  }, [open]);
  useEffect(() => {
    if (open) list.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const move = (dir: 1 | -1) => {
    const at = selectable.indexOf(active);
    setActive(selectable[Math.max(0, Math.min(selectable.length - 1, at < 0 ? 0 : at + dir))] ?? -1);
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      const arrow = e.key === "ArrowDown" || e.key === "ArrowUp";
      if (e.key === "Enter" || e.key === " " || (arrow && (arrowsOpen || e.altKey))) {
        e.preventDefault();
        e.stopPropagation();
        show();
      }
      return;
    }
    e.stopPropagation(); // открытый список сам обрабатывает клавиши: ни таблица, ни шторка их не получают
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        move(e.key === "ArrowDown" ? 1 : -1);
        break;
      case "Home":
      case "End":
        e.preventDefault();
        setActive(selectable[e.key === "Home" ? 0 : selectable.length - 1] ?? -1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(active);
        break;
      case "Tab":
        close();
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          const ch = e.key.toLocaleLowerCase("ru-RU");
          const from = selectable.indexOf(active);
          const order = [...selectable.slice(from + 1), ...selectable.slice(0, from + 1)];
          const hit = order.find((i) => (options[i] as Item).label.trim().toLocaleLowerCase("ru-RU").startsWith(ch));
          if (hit !== undefined) setActive(hit);
        }
    }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`dd-btn dd-${variant} ${open ? "open" : ""} ${className ?? ""}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        aria-label={label}
        data-nav={nav}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKey}
      >
        <span className="dd-value">{display ?? current?.label ?? "—"}</span>
        <Icon name="chevron" size={variant === "field" ? 20 : 16} />
      </button>
      {mounted &&
        createPortal(
          <div ref={list} id={`${id}-list`} className="dd" role="listbox" aria-label={label} style={pos} data-closing={closing || undefined}>
            {options.map((o, i) =>
              "sep" in o ? (
                <div key={i} className="dd-sep" role="presentation" />
              ) : "group" in o ? (
                <div key={i} className="dd-group" role="presentation">
                  {o.group}
                </div>
              ) : (
                <div
                  key={i}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={!o.action && o.value === value}
                  aria-disabled={o.disabled || undefined}
                  className={`dd-opt ${i === active ? "active" : ""} ${o.indent ? "indent" : ""} ${o.action ? "action" : ""}`}
                  onPointerMove={() => !o.disabled && i !== active && setActive(i)}
                  onPointerDown={(e) => e.preventDefault()} // фокус остаётся на кнопке
                  onClick={() => choose(i)}
                >
                  <span className="dd-label">
                    {o.label}
                    {o.sub && <small>{o.sub}</small>}
                  </span>
                  {o.hint && <span className="dd-hint">{o.hint}</span>}
                  {!o.action && o.value === value && <Icon name="check" size={16} />}
                </div>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
