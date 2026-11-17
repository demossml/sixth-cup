
import { useEffect, useMemo, useRef, useState } from "react";
import { layoutDoc } from "@/lib/client/export";
import { isChanged } from "@/lib/fingerprint";
import { cafeLabel, resolveTag, sizeLabel, type Doc } from "@/lib/model";
import { previewHeight, sceneToSvg } from "@/lib/render/svg";
import { changedTexts, layoutSent } from "@/lib/snapshot";
import { Icon } from "./ui";
import { useWs } from "./WorkspaceProvider";

// Просмотр документа на весь экран: оценить лист перед отправкой и сравнить с тем,
// что печатали в прошлый раз — «Было / Будет», изменившиеся надписи подсвечены.

export function DocViewer({
  docs,
  id,
  onId,
  onClose,
  picked,
  onToggle,
}: {
  docs: Doc[];
  id: string;
  onId: (id: string) => void;
  onClose: () => void;
  picked?: Set<string>;
  onToggle?: (id: string) => void;
}) {
  const i = docs.findIndex((d) => d.id === id);
  const doc = docs[i];
  const step = (dir: 1 | -1) => {
    const next = docs[i + dir];
    if (next) onId(next.id);
  };
  const closeBtn = useRef<HTMLButtonElement>(null);
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
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  if (!doc) return null;
  return (
    <div className="viewer dv" role="dialog" aria-modal="true" aria-label="Просмотр документа">
      <Page key={doc.id} doc={doc} picked={picked?.has(doc.id)} onToggle={onToggle && (() => onToggle(doc.id))} onBackdrop={onClose}>
        <div className="viewer-nav">
          <button className="icon-btn" disabled={i <= 0} onClick={() => step(-1)} aria-label="Предыдущий документ">
            <Icon name="left" />
          </button>
          <span className="viewer-count">
            {i + 1} из {docs.length}
          </span>
          <button className="icon-btn" disabled={i >= docs.length - 1} onClick={() => step(1)} aria-label="Следующий документ">
            <Icon name="right" />
          </button>
        </div>
        <button ref={closeBtn} className="icon-btn" onClick={onClose} aria-label="Закрыть просмотр">
          <Icon name="close" />
        </button>
      </Page>
    </div>
  );
}

function Page({
  doc,
  picked,
  onToggle,
  onBackdrop,
  children,
}: {
  doc: Doc;
  picked?: boolean;
  onToggle?: () => void;
  onBackdrop: () => void;
  children: React.ReactNode;
}) {
  const { ws, fb } = useWs();
  const [side, setSide] = useState<"old" | "new">("new");
  const changed = isChanged(ws, doc);
  const now = useMemo(() => (fb ? layoutDoc(ws, doc, fb) : null), [ws, doc, fb]);
  const was = useMemo(() => (fb && changed ? layoutSent(doc, fb) : null), [doc, fb, changed]);
  const scene = side === "old" && was ? was : now;
  const svg = useMemo(() => {
    if (!scene || !fb) return "";
    const other = scene === now ? was : now;
    return sceneToSvg(scene, { title: doc.name, overflow: true, highlight: other ? changedTexts(scene, other) : undefined, measure: fb.measure });
  }, [scene, now, was, fb, doc.name]);
  const title = doc.kind === "tag" ? resolveTag(ws, doc).name : doc.name;
  const cafe = ws.cafes.length > 1 ? cafeLabel(ws.cafes.find((c) => c.id === doc.cafeId)) : "";
  const ext = scene ? previewHeight(scene) / scene.h : 1;
  const size = scene ?? doc.size;
  const sentOn = doc.lastSent ? new Date(doc.lastSent.at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "";

  return (
    <>
      <header className="viewer-head">
        <div className="viewer-title">
          <b>{title}</b>
          <span className="muted">
            {cafe ? `${cafe} · ` : ""}
            {doc.kind === "menu" ? "Меню" : "Ценник"} {sizeLabel(doc.size)}
          </span>
        </div>
        <div className="viewer-compare">
          {!doc.lastSent ? (
            <span className="muted">Новый — раньше не печатался</span>
          ) : !changed ? (
            <span className="muted">Без изменений с отправки {sentOn}</span>
          ) : (
            <>
              <div className="scale" role="group" aria-label="Что показать">
                <button aria-pressed={side === "old"} className={side === "old" ? "on" : ""} disabled={!was} onClick={() => setSide("old")}>
                  Было
                </button>
                <button aria-pressed={side === "new"} className={side === "new" ? "on" : ""} onClick={() => setSide("new")}>
                  Будет
                </button>
              </div>
              <span className="muted viewer-legend">
                {was ? (
                  <>
                    <i className="hl" aria-hidden /> {side === "old" ? `напечатано ${sentOn}, подсвечено то, что изменится` : "подсвечено то, что изменилось"}
                  </>
                ) : (
                  "Прошлая версия не сохранилась: копии хранятся начиная со следующей отправки"
                )}
              </span>
            </>
          )}
        </div>
        {onToggle && (
          <label className="switch viewer-pick">
            <input type="checkbox" checked={!!picked} onChange={onToggle} />
            Отправить
          </label>
        )}
        {children}
      </header>
      {/* клик мимо листа — по затемнённому фону — закрывает просмотр */}
      <div className="viewer-stage" onClick={(e) => e.target === e.currentTarget && onBackdrop()}>
        <div className={`paper ${ext > 1 ? "over" : ""}`} style={{ aspectRatio: `${size.w} / ${size.h * ext}`, ["--ar" as string]: size.w / size.h }}>
          {scene ? <div className="paper-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="paper-loading">Загружаю шрифты…</div>}
        </div>
      </div>
    </>
  );
}
