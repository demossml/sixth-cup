import { useEffect, useMemo, useRef } from "react";
import type { FontBook } from "@/lib/fonts";
import { LOGO } from "@/lib/layout/design";
import { layoutMenu } from "@/lib/layout/menu";
import type { Group, GroupStyle, Item, MenuDoc, Price, Workspace } from "@/lib/model";
import { sceneToSvg } from "@/lib/render/svg";
import { useKeepOnScreen } from "./keepOnScreen";
import { useWs } from "./WorkspaceProvider";

// Выбор вида новой таблицы: миниатюры — настоящая вёрстка листа на образце таблицы каждого вида,
// поэтому выглядят ровно так, как таблица встанет на лист.

const row = (id: string, name: string, prices: Price[]): Item => ({ id, name, prices, variations: [] });

export const TABLE_TEMPLATES: { style: GroupStyle; label: string; hint: string; sample: Group }[] = [
  {
    style: "hero",
    label: "С крупным заголовком",
    hint: "Название листа и цены по объёмам",
    sample: {
      id: "tpl-hero", title: "Кофе", style: "hero", columns: ["0.25", "0.35", "0.40"],
      items: [row("a", "Капучино", [190, 220, 260]), row("b", "Латте", [200, 230, 270]), row("c", "Раф", [240, 270, 300])],
    },
  },
  {
    style: "section",
    label: "С подзаголовком",
    hint: "Синий подзаголовок, цены по объёмам",
    sample: {
      id: "tpl-section", title: "Холодные", style: "section", columns: ["0.30", "0.40"],
      items: [row("a", "Айс латте", [210, 240]), row("b", "Айс американо", [160, 180]), row("c", "Лимонад", [180, 210])],
    },
  },
  {
    style: "compact",
    label: "Узкий список по центру",
    hint: "Еда и десерты: одна цена или несколько",
    sample: {
      id: "tpl-compact", title: "К кофе", style: "compact", columns: ["1 шт"],
      items: [row("a", "Круассан", [160]), row("b", "Сырник", [170]), row("c", "Брауни", [200]), row("d", "Тирамису", [290])],
    },
  },
  {
    style: "addons",
    label: "Добавки к напиткам",
    hint: "«+40 Сироп…» под таблицей напитков",
    sample: {
      id: "tpl-addons", title: "Добавки", style: "addons", columns: ["+"],
      items: [row("a", "Сироп ваниль", [40]), row("b", "Карамель", [40]), row("c", "Доп. эспрессо", [50]), row("d", "Корица", [20])],
    },
  },
];

/** Миниатюра: лист A4 с одной таблицей-образцом, обрезанный по ней (без логотипа и сноски). */
function thumb(ws: Workspace, fb: FontBook, sample: Group): string {
  const doc: MenuDoc = { id: "tpl", kind: "menu", cafeId: "", name: sample.title, size: { w: 210, h: 297 }, groupIds: [sample.id], createdAt: "" };
  const scene = layoutMenu({ ...ws, groups: [sample] }, doc, fb);
  const top = 28; // ниже логотипа: здесь начинается первая таблица листа
  const bottom = (scene.contentBottom ?? 120) + 5;
  // только сама таблица: логотип и сноску убираем — рамка миниатюры шире обрезки и показала бы их
  const els = scene.els.filter((e) => !(e.kind === "path" && e.d === LOGO) && !(e.kind === "text" && e.y > bottom));
  return sceneToSvg({ ...scene, els }, { title: sample.title }).replace(/viewBox="[^"]*"/, `viewBox="16 ${top} 178 ${bottom - top}"`);
}

/**
 * Всплывающий выбор вида таблицы — под кнопкой «+ Таблица» или промежутком между таблицами.
 * Стоит в обёртке с position: relative вместе с кнопкой; клик мимо обёртки и Esc закрывают.
 */
export function TablePicker({ onPick, onClose }: { onPick: (style: GroupStyle) => void; onClose: () => void }) {
  const { ws, fb } = useWs();
  const box = useRef<HTMLDivElement>(null);
  useKeepOnScreen(true, box);
  const brand = ws.brand;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const thumbs = useMemo(() => (fb ? TABLE_TEMPLATES.map((t) => thumb(ws, fb, t.sample)) : []), [fb, brand]);

  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>(".tpick-opt")?.focus({ preventScroll: true });
    const down = (e: PointerEvent) => {
      if (!box.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [onClose]);

  return (
    <div
      ref={box}
      className="tpick"
      role="dialog"
      aria-label="Добавить таблицу"
      onKeyDown={(e) => {
        e.stopPropagation(); // стрелки и Enter — не навигация по ячейкам таблиц
        if (e.key === "Escape") onClose();
      }}
    >
      <p className="tpick-title">Какую таблицу добавить</p>
      <div className="tpick-grid">
        {TABLE_TEMPLATES.map((t, i) => (
          <button key={t.style} type="button" className="tpick-opt" onClick={() => onPick(t.style)}>
            <span className="tpick-thumb" aria-hidden="true" dangerouslySetInnerHTML={{ __html: thumbs[i] ?? "" }} />
            <span className="tpick-label">{t.label}</span>
            <span className="tpick-hint">{t.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
