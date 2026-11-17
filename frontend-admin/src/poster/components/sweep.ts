import { type PointerEvent } from "react";

/**
 * Выбор строк протяжкой: зажать кнопку мыши и вести вверх или вниз — отмечается диапазон от строки, где зажали,
 * до строки под курсором (или снимается, если начали с отмеченной). Строки не пропускаются при быстром движении;
 * если повести обратно, строки за курсором возвращаются в прежнее состояние. У края прокручиваемой области
 * список сам прокручивается. Касание и клавиатура — обычное переключение галочки.
 *
 * Начать можно в любой ячейке строки, кроме ручки перетаскивания и «⋯»:
 *  — на галочке выбор начинается сразу;
 *  — в названии, цене и других ячейках — только когда курсор ушёл на соседнюю строку. Пока он в своей строке,
 *    всё работает как обычно: клик ставит курсор в поле, протяжка выделяет текст.
 *
 * Разметка: общий контейнер строк — data-pick-root и onPointerDown={sweep.down}; строка — data-pick="<id>"
 * (и data-pick-scope, если выбор возможен только внутри части списка — вариации одной позиции);
 * ячейка с галочкой — data-pick-box и onClick={() => sweep.click(id)}.
 */
const SKIP = ".gt-grip, .rm, [role='menu'], [role='dialog'], [role='listbox'], [data-no-sweep]";

export function useSweep(isOn: (id: string) => boolean, set: (id: string, on: boolean) => void) {
  return {
    down(e: PointerEvent<HTMLElement>) {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest(SKIP)) return;
      const row = target.closest<HTMLElement>("[data-pick]");
      const root = e.currentTarget;
      if (!row || row.closest("[data-pick-root]") !== root) return;
      const onBox = !!target.closest("[data-pick-box]");
      if (onBox) e.preventDefault(); // чтобы при протяжке не выделялся текст

      const scope = row.dataset.pickScope ?? "";
      const rows = [...root.querySelectorAll<HTMLElement>("[data-pick]")].filter((r) => (r.dataset.pickScope ?? "") === scope);
      const ids = rows.map((r) => r.dataset.pick!);
      const anchor = rows.indexOf(row);
      const before = new Map(ids.map((x) => [x, isOn(x)]));
      const now = new Map(before);
      const paint = !isOn(ids[anchor]);
      let active = false;

      const apply = (to: number) => {
        const [a, b] = anchor < to ? [anchor, to] : [to, anchor];
        ids.forEach((x, i) => {
          const want = i >= a && i <= b ? paint : before.get(x)!;
          if (now.get(x) !== want) {
            now.set(x, want);
            set(x, want);
          }
        });
      };
      // строка под курсором — только по высоте: курсор может уйти вбок; выше первой — первая, ниже последней — последняя
      const rowAt = (y: number) => {
        const i = rows.findIndex((r) => r.getBoundingClientRect().bottom > y);
        return i < 0 ? rows.length - 1 : i;
      };
      const activate = () => {
        active = sweeping = true;
        document.body.classList.add("sweeping");
        // начали в поле: снять курсор и выделение текста, иначе поле продолжит выделять текст за мышью
        const el = document.activeElement as HTMLElement | null;
        if (el && root.contains(el)) el.blur();
        window.getSelection()?.removeAllRanges();
      };
      if (onBox) {
        activate();
        apply(anchor);
      }

      const scroller = scrollParent(root);
      let y = e.clientY;
      let raf = 0;
      const tick = () => {
        if (active) {
          const box = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
          const edge = 48;
          const dy = y < box.top + edge ? -(box.top + edge - y) : y > box.bottom - edge ? y - (box.bottom - edge) : 0;
          if (dy) {
            scroller.scrollTop += Math.max(-24, Math.min(24, dy / 2));
            apply(rowAt(y));
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      const move = (ev: globalThis.PointerEvent) => {
        y = ev.clientY;
        const at = rowAt(y);
        if (!active && at !== anchor) activate();
        if (active) {
          ev.preventDefault();
          apply(at);
        }
      };
      // ссылки (цена из базы) браузер иначе начинает тащить как ссылку
      const noDrag = (ev: DragEvent) => ev.preventDefault();
      const stop = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        window.removeEventListener("dragstart", noDrag);
        document.body.classList.remove("sweeping");
        if (active) setTimeout(() => (sweeping = false), 0); // после click, который придёт следом за отпусканием
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      window.addEventListener("dragstart", noDrag);
    },
    click(id: string) {
      if (!sweeping) set(id, !isOn(id));
    },
  };
}
export type Sweep = ReturnType<typeof useSweep>;

let sweeping = false;

/** Ближайший прокручиваемый предок (панель таблиц); нет такого — сама страница. */
export function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}
