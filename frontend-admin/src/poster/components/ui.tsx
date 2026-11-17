
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { layoutDoc } from "@/lib/client/export";
import { ICONS, type IconName } from "@/lib/icons";
import type { FontBook } from "@/lib/fonts";
import { STATUS_LABEL, docDue, printStatus, type Due, type PrintStatus } from "@/lib/fingerprint";
import type { Doc, Price, Workspace } from "@/lib/model";
export { Logo } from "./Logo";
import { useWs } from "./WorkspaceProvider";
import { FONT_FACE_CSS, previewHeight, sceneToSvg } from "@/lib/render/svg";

/** Поле цены: цифровая клавиатура на телефоне, пусто — «нет такого объёма». */
export function PriceInput({
  value, onChange, label, className, nav, locked,
}: {
  value: Price; onChange: (v: Price) => void; label: string; className?: string; nav?: number;
  /** Цена из базы: поле только для чтения, в подсказке — откуда цена и где её менять. */
  locked?: string;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value == null ? "" : String(value));
  }, [value]);
  return (
    <input
      className={`${className ?? "price-input"}${locked ? " from-db" : ""}`}
      readOnly={!!locked}
      title={locked}
      data-nav={nav}
      data-nav-free={nav === undefined ? undefined : ""}
      inputMode="numeric"
      pattern="[0-9]*"
      enterKeyHint="next"
      aria-label={label}
      placeholder="—"
      value={text}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        setText(value == null ? "" : String(value));
      }}
      onChange={(e) => {
        if (locked) return;
        const t = e.target.value.replace(/[^\d]/g, "").slice(0, 6);
        setText(t);
        onChange(t === "" ? null : Number(t));
      }}
    />
  );
}

/** Текстовое поле, которое не теряет курсор при автосохранении. */
export function TextInput({
  value, onChange, className, placeholder, label, autoFocus,
}: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; label: string; autoFocus?: boolean }) {
  return (
    <input
      className={className ?? "text-input"}
      aria-label={label}
      placeholder={placeholder}
      value={value}
      autoFocus={autoFocus}
      enterKeyHint="done"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Закрыть окно с анимацией: сначала класс closing (окно уходит, ~160 мс), потом onClose — окно размонтируется.
 * При «уменьшить движение» — сразу. Возвращает [идёт закрытие, закрыть].
 */
export function useClosing(onClose: () => void, ms = 160): [boolean, () => void] {
  const [closing, setClosing] = useState(false);
  const latest = useRef(onClose);
  latest.current = onClose;
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const close = useCallback(() => {
    if (timer.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return latest.current();
    setClosing(true);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      setClosing(false);
      latest.current();
    }, ms);
  }, [ms]);
  return [closing, close];
}

/** size: "ask" — короткий вопрос с двумя кнопками (490 px), "form" — небольшая форма (520 px); без size — до 980 px. Только на компьютере. */
export function Sheet({ title, onClose, children, footer, size }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: "ask" | "form" }) {
  const [closing, close] = useClosing(onClose);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", h);
    document.body.classList.add("sheet-open");
    return () => {
      window.removeEventListener("keydown", h);
      document.body.classList.remove("sheet-open");
    };
  }, [close]);
  return (
    <div className={`sheet-backdrop${closing ? " closing" : ""}`} onClick={close}>
      <div className={`sheet${size ? ` sheet-${size}` : ""}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={close} aria-label="Закрыть">
            <Icon name="close" />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/**
 * Иконка из набора «Icons by Bair Galsanov» (Sharp · 1px). Список имён и соответствие иконкам набора —
 * в scripts/icons.mjs; других иконок в интерфейсе нет.
 */
export function Icon({ name, size = 20 }: { name: IconName | (string & {}); size?: number }) {
  // линии в наборе толщиной 1px на сетке 24: мельче 16px они расплываются, поэтому меньше не рисуем
  size = Math.max(16, size);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const html: string = (ICONS as Record<string, string>)[name] ?? "";
  // у залитых иконок внутри маска — её id должен быть своим у каждого экземпляра на странице
  const __html = html.includes("__ID__") ? html.split("__ID__").join(`i${id}`) : html;
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden dangerouslySetInnerHTML={{ __html }} />;
}

let fontCssInjected = false;
function useFontCss() {
  useEffect(() => {
    if (fontCssInjected) return;
    fontCssInjected = true;
    const s = document.createElement("style");
    s.textContent = FONT_FACE_CSS;
    document.head.appendChild(s);
  }, []);
}

// «Показать поля принтера» — личная настройка просмотра: помнится в браузере, в документ не попадает.
const MARGINS_KEY = "mp.printerMargins";
const marginSubs = new Set<() => void>();
let marginsOn: boolean | null = null;
const readMargins = () => {
  if (marginsOn === null) {
    try {
      marginsOn = localStorage.getItem(MARGINS_KEY) === "1";
    } catch {
      marginsOn = false;
    }
  }
  return marginsOn;
};
function setMargins(on: boolean) {
  marginsOn = on;
  try {
    localStorage.setItem(MARGINS_KEY, on ? "1" : "0");
  } catch {
    /* частный режим: настройка проживёт до перезагрузки */
  }
  marginSubs.forEach((f) => f());
}
const subscribeMargins = (f: () => void) => {
  marginSubs.add(f);
  return () => void marginSubs.delete(f);
};

/** Переключатель «Поля принтера»: включён ли и как его поменять. */
export function usePrinterMargins(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribeMargins, readMargins, () => false), setMargins];
}

/**
 * Превью документа — та же сцена, из которой собирается PDF.
 * С showWarnings это рабочее превью: показывает, что вылезло за лист, поля принтера и предупреждения.
 */
export function DocPreview({
  ws, doc, fb, className, showWarnings, plain, noMargins,
}: {
  ws: Workspace; doc: Doc; fb: FontBook | null; className?: string; showWarnings?: boolean;
  /** только лист: без переключателя и предупреждений под ним */ plain?: boolean;
  /** не закрашивать поля принтера — это инструмент редактора, а не просмотра */ noMargins?: boolean;
}) {
  useFontCss();
  const tools = !!showWarnings && doc.kind === "menu";
  const margins = useSyncExternalStore(subscribeMargins, readMargins, () => false) && tools && !noMargins;
  const scene = useMemo(() => (fb ? layoutDoc(ws, doc, fb) : null), [ws, doc, fb]);
  const svg = useMemo(() => (scene ? sceneToSvg(scene, { title: doc.name, margins, overflow: showWarnings }) : ""), [scene, doc.name, margins, showWarnings]);
  // лист всегда своего размера и пропорций; при переполнении превью продолжается ниже его края
  const ext = scene && showWarnings ? previewHeight(scene) / scene.h : 1;
  const fit = scene?.fit ?? 1;
  return (
    <div className={className ?? "doc-preview"}>
      <div
        className={`paper ${ext > 1 ? "over" : ""}`}
        style={{ aspectRatio: `${doc.size.w} / ${doc.size.h * ext}`, ["--ar" as string]: doc.size.w / doc.size.h, ["--mm-w" as string]: doc.size.w }}
      >
        {scene ? <div className="paper-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="paper-loading">Загружаю шрифты…</div>}
      </div>
      {tools && !plain && (
        <div className="preview-tools">
          <label className="switch">
            <input type="checkbox" className="toggle" checked={margins} onChange={(e) => setMargins(e.target.checked)} />
            Поля принтера
          </label>
          {scene && fit < 1 && (
            <span className="fit-note" role="status">
              Текст уменьшен до {Math.round(fit * 100)} %
            </span>
          )}
        </div>
      )}
      {margins && !plain && scene?.margin && <p className="hint preview-hint">Закрашено {scene.margin} мм от края: там обычный принтер не печатает. Печатайте в масштабе 100 %.</p>}
      {showWarnings && !plain && scene && scene.warnings.length > 0 && (
        <ul className="warnings" role="status">
          {scene.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Статус печати: точка и подпись, без плашки. */
export function Status({ s, updated, due }: { s: PrintStatus; updated?: boolean; due?: Due | null }) {
  // «обновлено» — документ уже печатали, и с тех пор он изменился; срок — если цена пришла из базы.
  // У каждого состояния свой цвет точки: срочно — красный, к дате и новый — жёлтый, обновлён — фиолетовый,
  // заказ отправлен — синий, без изменений — зелёный.
  if (s === "pending" && due)
    return <span className={`status ${due.urgent ? "st-urgent" : "st-due"}`}>{due.urgent ? "Срочно, ожидает печати" : `К ${dueDate(due.date)}, ожидает печати`}</span>;
  if (s === "pending") return <span className={`status ${updated ? "st-updated" : "st-pending"}`}>{updated ? "Обновлено, ожидает печати" : STATUS_LABEL[s]}</span>;
  return <span className={`status st-${s}`}>{STATUS_LABEL[s]}</span>;
}

/** «25 ноября» из yyyy-mm-dd. */
export function dueDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/** Статус печати одного документа — со сроком, если он есть. */
export function DocStatus({ doc }: { doc: Doc }) {
  const { ws } = useWs();
  return <Status s={printStatus(ws, doc)} updated={!!doc.lastSent} due={docDue(ws, doc)} />;
}

export function Toast({ children }: { children: ReactNode }) {
  return <div className="toast" role="status">{children}</div>;
}
