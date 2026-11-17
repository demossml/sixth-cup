import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useKeepOnScreen } from "./keepOnScreen";
import { Select } from "./Select";
import { Icon } from "./ui";

// Набор повторяющихся частей интерфейса: кнопка «назад», вкладки, сводка цифр, карточка по наведению.
// Вид — в globals.css, раздел «Набор компонентов». Где и как применять — docs/POSTER-DESIGN-DECISIONS.md.

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- «Назад» ----------

/**
 * Возврат со вложенной страницы. Всегда кнопка (серая, маленькая), всегда первая на странице;
 * заголовок раздела над ней не показываем — его заменяет заголовок самой страницы.
 */
export function BackButton({ href, children, className, ...rest }: ComponentPropsWithoutRef<"a"> & { href: string }) {
  return (
    <a {...rest} href={href} className={cx("btn small back-btn", className)}>
      <Icon name="back" size={16} />
      {children}
    </a>
  );
}

// ---------- Вкладки ----------

type TabsCtx = { value: string; onValueChange?: (v: string) => void; mode: "tabs" | "filter"; id: string };
const TabsContext = createContext<TabsCtx | null>(null);
const useTabs = () => {
  const c = useContext(TabsContext);
  if (!c) throw new Error("Tab — только внутри Tabs");
  return c;
};

/**
 * Вкладки с подчёркиванием (.seg). mode="tabs" — переключают панели (role=tablist, стрелки ←/→);
 * mode="filter" — сужают один список (кнопки-переключатели, aria-pressed).
 * Вкладка со ссылкой (href) меняет адрес; без неё — вызывает onValueChange.
 */
export function Tabs({
  id: given,
  value,
  onValueChange,
  mode = "tabs",
  label,
  className,
  children,
}: {
  /** общий id с TabPanel (useTabsId); без панели можно не задавать */
  id?: string;
  value: string;
  onValueChange?: (v: string) => void;
  mode?: "tabs" | "filter";
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const own = useId();
  const id = given ?? own;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (mode !== "tabs" || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=tab]")];
    const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.click();
  };
  return (
    <TabsContext.Provider value={{ value, onValueChange, mode, id }}>
      <div className={cx("seg", className)} role={mode === "tabs" ? "tablist" : "group"} aria-label={label} onKeyDown={onKeyDown}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

/** Одна вкладка. count — число справа от подписи (серым, цифры одной ширины). */
export function Tab({ value, href, count, children }: { value: string; href?: string; count?: number | null; children: ReactNode }) {
  const { value: current, onValueChange, mode, id } = useTabs();
  const on = current === value;
  const body = (
    <>
      {children}
      {count != null && <span className="count">{count}</span>}
    </>
  );
  const common = { className: on ? "active" : undefined, onClick: () => onValueChange?.(value) };
  if (mode === "filter")
    return (
      <button type="button" aria-pressed={on} {...common}>
        {body}
      </button>
    );
  const tab = { role: "tab", id: `${id}-tab-${value}`, "aria-selected": on, "aria-controls": `${id}-panel`, tabIndex: on ? 0 : -1, ...common } as const;
  return href ? (
    <a href={href} {...tab}>
      {body}
    </a>
  ) : (
    <button type="button" {...tab}>
      {body}
    </button>
  );
}

/** Панель выбранной вкладки; Tabs и TabPanel — соседи, связь — через общий id. */
export function TabPanel({ tabs, value, className, children }: { tabs: string; value: string; className?: string; children: ReactNode }) {
  return (
    <div key={value} id={`${tabs}-panel`} role="tabpanel" aria-labelledby={`${tabs}-tab-${value}`} className={cx("section-in", className)}>
      {children}
    </div>
  );
}

/** id группы вкладок для TabPanel: Tabs и TabPanel должны получить одинаковый. */
export function useTabsId() {
  return useId();
}

// ---------- Сводка цифр ----------

/** Строка крупных чисел с подписями, между пунктами — тонкая черта. Всегда в одну строку. */
export function Stats({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cx("stats", className)}>{children}</ul>;
}

/** Пункт сводки: число (unit — мельче и серым), под ним подпись в одно-два слова. */
export function Stat({ value, unit, label }: { value: ReactNode; unit?: string; label: string }) {
  return (
    <li>
      <b>
        {value}
        {unit && <small> {unit}</small>}
      </b>
      <span>{label}</span>
    </li>
  );
}

// ---------- Карточка по наведению ----------

type HoverCtx = {
  open: boolean;
  set: (v: boolean, ms?: number) => void;
  pin: () => void;
  pinned: { current: boolean };
  trigger: { current: HTMLButtonElement | null };
  id: string;
  label: string;
};
const HoverContext = createContext<HoverCtx | null>(null);
const useHover = () => {
  const c = useContext(HoverContext);
  if (!c) throw new Error("HoverCardTrigger и HoverCardContent — только внутри HoverCard");
  return c;
};

/** Задержки карточки: открыть через 300 мс наведения, закрыть через 200 мс после ухода мыши. */
const OPEN_MS = 300;
const CLOSE_MS = 200;

/**
 * Карточка по наведению: мышью — открывается через паузу, закрывается, когда мышь ушла;
 * нажатием (и на телефоне) — открывается и остаётся, пока не нажмут мимо, ещё раз или Esc.
 * Состояние своё (defaultOpen) или снаружи (open + onOpenChange).
 */
export function HoverCard({
  label,
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
}: {
  /** подпись карточки для чтения с экрана */
  label: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const pinned = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const latest = useRef({ controlled, onOpenChange });
  latest.current = { controlled, onOpenChange };

  const apply = (v: boolean) => {
    if (latest.current.controlled === undefined) setOwn(v);
    latest.current.onOpenChange?.(v);
  };
  const set = (v: boolean, ms = 0) => {
    window.clearTimeout(timer.current);
    if (!v) pinned.current = false;
    timer.current = window.setTimeout(() => apply(v), ms);
  };
  const pin = () => {
    pinned.current = true;
    set(true);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && set(false);
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      set(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
    // set стабилен по смыслу: читает только ref-ы
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <HoverContext.Provider value={{ open, set, pin, pinned, trigger, id, label }}>
      <span
        ref={wrap}
        className={cx("hovercard", className)}
        onPointerEnter={(e) => e.pointerType === "mouse" && set(true, open ? 0 : OPEN_MS)}
        onPointerLeave={(e) => e.pointerType === "mouse" && !pinned.current && set(false, CLOSE_MS)}
      >
        {children}
      </span>
    </HoverContext.Provider>
  );
}

/** Тег-кнопка, открывающая карточку: подпись и шеврон, который переворачивается, пока карточка открыта. */
export function HoverCardTrigger({ children, className }: { children: ReactNode; className?: string }) {
  const { open, set, pin, pinned, trigger, id } = useHover();
  return (
    <button
      ref={trigger}
      type="button"
      className={cx("tag-btn", open && "open", className)}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      // открыта наведением — нажатие закрепляет; закреплена — закрывает
      onClick={() => (open && pinned.current ? set(false) : pin())}
    >
      <span className="tag-btn-text">{children}</span>
      <Icon name="chevron" size={16} />
    </button>
  );
}

/** Содержимое карточки; держится в пределах экрана (переворачивается вверх, сдвигается от края). */
export function HoverCardContent({ children, className }: { children: ReactNode; className?: string }) {
  const { open, id, label } = useHover();
  const box = useRef<HTMLDivElement>(null);
  useKeepOnScreen(open, box);
  if (!open) return null;
  return (
    <div ref={box} id={id} role="dialog" aria-label={label} className={cx("hovercard-pop", className)}>
      {children}
    </div>
  );
}

/** Шапка карточки: имя и строка под ним (адрес — выделяется целиком одним нажатием). */
export function HoverCardHead({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="hc-head">
      <b>{title}</b>
      {sub && <span>{sub}</span>}
    </div>
  );
}

/** Сведения в карточке: подпись слева, значение справа. */
export function HoverCardFacts({ children }: { children: ReactNode }) {
  return <dl className="hc-facts">{children}</dl>;
}
export function HoverCardFact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Действия карточки списком: значок и подпись; ссылка — если есть href, иначе кнопка. */
export function HoverCardActions({ children }: { children: ReactNode }) {
  return <div className="hc-actions">{children}</div>;
}
export function HoverCardAction({ icon, href, onClick, children }: { icon: string; href?: string; onClick?: () => void; children: ReactNode }) {
  const body = (
    <>
      <Icon name={icon} size={16} />
      {children}
    </>
  );
  return href ? (
    <a href={href} onClick={onClick}>
      {body}
    </a>
  ) : (
    <button type="button" onClick={onClick}>
      {body}
    </button>
  );
}

// ---------- Панель выбора ----------

/**
 * Панель действий с отмеченными строками таблицы — тёмная, как в редакторе меню (.gt-pickbar), но не над
 * строкой, а по центру внизу экрана, в 4 px от нижнего края (на телефоне — над нижними вкладками).
 * Слева — число отмеченных в кружке, справа — ✕. Esc тоже снимает выбор.
 * Действия — дети: SelectionAction или своя кнопка (например, выпадающий список).
 */
export function SelectionBar({ count, label, onClear, children }: { count: number; label: string; onClear: () => void; children: ReactNode }) {
  const latest = useRef(onClear);
  latest.current = onClear;
  useEffect(() => {
    const esc = (e: globalThis.KeyboardEvent) => {
      // Esc сначала закрывает открытый список или окно — они перехватывают его раньше
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector(".sheet-backdrop, .dd")) latest.current();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);
  return (
    <div className="gt-pickbar selbar" role="toolbar" aria-label={label}>
      <span className="gt-pickbar-count" aria-live="polite" title={`Выбрано ${count}`}>
        <span className="gt-pickbar-badge" aria-hidden="true">
          {count}
        </span>
        <span className="sr-only">Выбрано {count}</span>
      </span>
      {children}
      <button type="button" className="gt-pickbar-x" onClick={onClear} aria-label="Снять выбор" title="Снять выбор (Esc)">
        <Icon name="close-2" size={16} />
      </button>
    </div>
  );
}

/** Действие панели выбора. danger — удаление: квадратная кнопка с корзиной, подпись — в подсказке и для диктора. */
export function SelectionAction({ icon, danger, onClick, children }: { icon?: string; danger?: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" className={danger ? "danger" : undefined} title={children} aria-label={danger ? children : undefined} onClick={onClick}>
      {danger ? <Icon name="trash-2" size={16} /> : icon && <Icon name={icon} size={16} />}
      {!danger && <span className="gt-pickbar-label">{children}</span>}
    </button>
  );
}

// ---------- Сортировка по колонкам ----------

export type SortDir = "asc" | "desc";
export type Sort<K extends string> = { key: K; dir: SortDir } | null;

/**
 * Сортировка таблицы по колонке. Нажатие на заголовок: по возрастанию → по убыванию → как было.
 * Выбор помнится на устройстве (storageKey) и читается до первой отрисовки — после обновления без мигания.
 */
export function useSort<K extends string>(storageKey: string, keys: readonly K[]): [Sort<K>, (key: K) => void, (next: Sort<K>) => void] {
  const store = `m67.sort.${storageKey}`;
  const [sort, setSort] = useState<Sort<K>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(store) ?? "null");
      return v && keys.includes(v.key) && (v.dir === "asc" || v.dir === "desc") ? v : null;
    } catch {
      return null;
    }
  });
  const save = (next: Sort<K>) => {
    try {
      localStorage.setItem(store, JSON.stringify(next));
    } catch {
      /* приватный режим: запомнится до перезагрузки */
    }
    return next;
  };
  const toggle = (key: K) => setSort((s) => save(s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));
  // прямо задать сортировку — для списка «Сортировка» там, где заголовков колонок нет (телефон)
  const set = (next: Sort<K>) => setSort(save(next));
  return [sort, toggle, set];
}

const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

/**
 * Отсортировать строки по значению колонки. Пустые значения (null, undefined, "") — всегда в конце,
 * в какую сторону ни сортируй; при равных значениях остаётся прежний порядок.
 */
export function sortRows<T, K extends string>(rows: T[], sort: Sort<K>, by: Record<K, (row: T) => string | number | null | undefined>): T[] {
  if (!sort) return rows;
  const get = by[sort.key];
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((a, b) => {
      const ea = a.v == null || a.v === "";
      const eb = b.v == null || b.v === "";
      if (ea || eb) return ea === eb ? a.i - b.i : ea ? 1 : -1;
      const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : collator.compare(String(a.v), String(b.v));
      return c * sign || a.i - b.i;
    })
    .map((x) => x.row);
}

/** aria-sort для ячейки-заголовка колонки. */
export const ariaSort = <K extends string>(sort: Sort<K>, key: K) => (sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none");

/**
 * Заголовок колонки, по которому сортируют: подпись и стрелка. Стрелка видна у выбранной колонки,
 * у остальных — бледная при наведении; место под неё есть всегда, подпись не сдвигается.
 * align="end" — для колонок с числами: стрелка слева, подпись остаётся у правого края.
 */
export function SortHeader<K extends string>({ column, sort, onSort, align, hint, children }: { column: K; sort: Sort<K>; onSort: (key: K) => void; align?: "end"; hint?: string; children: ReactNode }) {
  const on = sort?.key === column;
  const what = typeof children === "string" ? children : "колонке";
  const state = on ? (sort!.dir === "asc" ? "по возрастанию" : "по убыванию") : "не сортировано";
  return (
    <button
      type="button"
      className={cx("sort-h", on && "on", on && sort!.dir === "desc" && "desc", align === "end" && "end")}
      onClick={() => onSort(column)}
      title={hint ?? `Сортировать по «${what}»`}
      aria-label={`${what}: ${state}. Нажмите, чтобы ${!on ? "сортировать по возрастанию" : sort!.dir === "asc" ? "сортировать по убыванию" : "вернуть исходный порядок"}`}
    >
      <span>{children}</span>
      <Icon name="up" size={16} />
    </button>
  );
}

/**
 * Сортировка списком — где заголовков колонок нет (таблица на телефоне). Те же колонки и то же состояние,
 * что у SortHeader: выбор в одном месте виден в другом. У каждой колонки — два пункта, по возрастанию и по убыванию.
 */
export function SortSelect<K extends string>({
  sort,
  onChange,
  columns,
  original,
  className,
}: {
  sort: Sort<K>;
  onChange: (next: Sort<K>) => void;
  /** подписи колонок и направлений: { key: "price", label: "Цена", asc: "сначала дешёвые", desc: "сначала дорогие" } */
  columns: { key: K; label: string; asc: string; desc: string }[];
  /** как называется исходный порядок, например «По порядку меню» */
  original: string;
  className?: string;
}) {
  const value = sort ? `${sort.key}:${sort.dir}` : "";
  const col = sort && columns.find((c) => c.key === sort.key);
  return (
    <Select
      variant="quiet"
      className={cx("sort-select", className)}
      label="Сортировка"
      value={value}
      display={
        <>
          <span className="sort-select-k">Сортировка:</span> {col ? `${col.label.toLowerCase()}, ${sort!.dir === "asc" ? col.asc : col.desc}` : original.toLowerCase()}
        </>
      }
      onChange={(v) => {
        const [key, dir] = v.split(":") as [K, SortDir];
        onChange(v ? { key, dir } : null);
      }}
      options={[
        { value: "", label: original },
        ...columns.flatMap((c) => [
          { group: c.label },
          { value: `${c.key}:asc`, label: c.asc, indent: true },
          { value: `${c.key}:desc`, label: c.desc, indent: true },
        ]),
      ]}
    />
  );
}
