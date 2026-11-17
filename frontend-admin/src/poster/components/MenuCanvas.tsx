
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { layoutDoc } from "@/lib/client/export";
import type { MenuDoc } from "@/lib/model";
import { previewHeight, sceneToSvg } from "@/lib/render/svg";
import { Icon, usePrinterMargins } from "./ui";
import { useWs } from "./WorkspaceProvider";

// Холст редактора: серое поле во всю правую часть, на нём белый лист. Лист можно приближать и отдалять —
// кнопками, а на тачпаде щипком (Ctrl/⌘ + колесо). «Вписать» возвращает лист целиком в окно.

const PX_MM = 96 / 25.4; // масштаб 100 % — лист в миллиметрах, как при печати без масштабирования
const STOPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const MIN = 0.1;
const MAX = 5;
const NOTE_H = 28; // строка над листом: 20 px текста и 8 px до листа (см. .cv-fit)

export function MenuCanvas({ doc, lead }: { doc: MenuDoc; lead?: ReactNode }) {
  const { ws, fb } = useWs();
  const [margins, setMargins] = usePrinterMargins();
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [box, setBox] = useState({ w: 0, h: 0 });
  const scroller = useRef<HTMLDivElement>(null);

  const scene = useMemo(() => (fb ? layoutDoc(ws, doc, fb) : null), [ws, doc, fb]);
  const svg = useMemo(() => (scene ? sceneToSvg(scene, { title: doc.name, margins, autoMargins: true, overflow: true }) : ""), [scene, doc.name, margins]);
  const sheetH = scene ? previewHeight(scene) : doc.size.h;
  const pad = box.w < 520 ? 16 : 32;
  const fitNote = scene?.fit && scene.fit < 1 ? `Текст уменьшен до ${Math.round(scene.fit * 100)} %` : "";
  // строка «Текст уменьшен…» стоит прямо над листом — под неё оставляем место, чтобы лист всё равно вписывался
  const above = fitNote ? NOTE_H : 0;
  const fit = box.w && box.h ? Math.max(MIN, Math.min((box.w - 2 * pad) / (doc.size.w * PX_MM), (box.h - 2 * pad - above) / (sheetH * PX_MM))) : 0;
  const scale = zoom === "fit" ? fit : zoom;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    // щипок на тачпаде приходит как колесо с Ctrl; слушатель не пассивный, чтобы не зумилась вся страница
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(Math.min(MAX, Math.max(MIN, scaleRef.current * Math.exp(-e.deltaY * 0.01))));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, []);

  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? STOPS.find((s) => s > scale * 1.02) : [...STOPS].reverse().find((s) => s < scale * 0.98);
    if (next) setZoom(next);
  };

  return (
    <section className="cv" aria-label="Лист меню">
      <div className="cv-bar">
        {lead}
        <div className="cv-zoom" role="group" aria-label="Масштаб листа">
          <button className="cv-btn" onClick={() => step(-1)} disabled={scale <= STOPS[0]} aria-label="Отдалить">
            <Icon name="minus" size={16} />
          </button>
          <output className="cv-pct" aria-live="off">
            {scale ? `${Math.round(scale * 100)} %` : "…"}
          </output>
          <button className="cv-btn" onClick={() => step(1)} disabled={scale >= STOPS[STOPS.length - 1]} aria-label="Приблизить">
            <Icon name="plus" size={16} />
          </button>
          <button className={`cv-btn text ${zoom === "fit" ? "on" : ""}`} aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>
            Вписать
          </button>
        </div>
        <span className="cv-margins">
          <label className="switch">
            <input type="checkbox" className="toggle" aria-label="Поля принтера" checked={margins} onChange={(e) => setMargins(e.target.checked)} />
            <span>
              Поля<span className="cv-long"> принтера</span>
            </span>
          </label>
          <InfoTip label="Что такое поля принтера">
            Край листа {scene?.margin ?? 5} мм, который обычный принтер не печатает. Если туда что-то заехало, край станет красным сам.
          </InfoTip>
        </span>
      </div>
      {scene && scene.warnings.length > 0 && (
        <ul className="cv-notes" role="status">
          {scene.warnings.map((w) => (
            <li key={w} className="warn">
              {w}
            </li>
          ))}
        </ul>
      )}
      <div className="cv-scroll" ref={scroller} tabIndex={0} aria-label="Лист, прокручивается">
        <div className="cv-sheet" style={{ padding: pad }}>
          {fitNote && scale > 0 && (
            <p className="cv-fit" role="status" style={{ width: doc.size.w * PX_MM * scale }}>
              {fitNote}
              <span className="cv-long">, чтобы меню поместилось на лист</span>
            </p>
          )}
          <div
            className={`paper ${scene && sheetH > scene.h ? "over" : ""}`}
            style={{ width: scale ? doc.size.w * PX_MM * scale : undefined, aspectRatio: `${doc.size.w} / ${sheetH}`, visibility: scale ? "visible" : "hidden" }}
          >
            {scene ? <div className="paper-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="paper-loading">Загружаю шрифты…</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Кнопка «i» с белой подсказкой: открывается наведением, фокусом и тапом, закрывается уходом, Esc и тапом мимо. */
function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="tip" onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)} onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}>
      <button
        type="button"
        className="tip-btn"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      >
        <Icon name="info" size={16} />
      </button>
      {open && (
        <span role="tooltip" id={id} className="tip-box">
          {children}
        </span>
      )}
    </span>
  );
}
