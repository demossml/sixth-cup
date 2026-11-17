import { useLayoutEffect, type RefObject } from "react";

/** Отступ всплывающего блока от края видимой области. */
const EDGE = 8;
/** Ниже этой высоты блок не сжимаем — лучше пусть прокручивается страница. */
const MIN_H = 120;

/**
 * Видимая часть экрана для элемента: видимая область окна (без экранной клавиатуры)
 * в пересечении со всеми прокручиваемыми или обрезающими предками.
 */
function visibleArea(el: HTMLElement) {
  const vv = window.visualViewport;
  const b = vv
    ? { left: vv.offsetLeft, top: vv.offsetTop, right: vv.offsetLeft + vv.width, bottom: vv.offsetTop + vv.height }
    : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
    const r = p.getBoundingClientRect();
    const top = r.top + p.clientTop;
    const left = r.left + p.clientLeft;
    b.left = Math.max(b.left, left);
    b.top = Math.max(b.top, top);
    b.right = Math.min(b.right, left + p.clientWidth);
    b.bottom = Math.min(b.bottom, top + p.clientHeight);
  }
  return b;
}

/**
 * Держит всплывающий блок (position: absolute у кнопки) в пределах видимой области.
 * Направление по умолчанию задаёт CSS; если там не хватает места, а с другой стороны его больше —
 * блок открывается в другую сторону. Не влезает и так — сжимается по высоте (внутри прокрутка).
 * По горизонтали сдвигается внутрь экрана. Пересчитывается при смене размера окна и при появлении клавиатуры.
 * Якорь — ближайший позиционированный предок блока (обёртка кнопки).
 */
export function useKeepOnScreen(open: boolean, box: RefObject<HTMLElement | null>, deps: readonly unknown[] = []) {
  useLayoutEffect(() => {
    const el = box.current;
    if (!open || !el) return;
    const fit = () => {
      const anchor = el.offsetParent as HTMLElement | null;
      if (!anchor) return;
      const s = el.style;
      s.top = s.bottom = s.maxHeight = s.translate = "";
      const a = anchor.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const area = visibleArea(el);
      const down = r.top >= a.top + a.height / 2;
      const gap = Math.max(0, down ? r.top - a.bottom : a.top - r.bottom);
      const below = area.bottom - a.bottom - gap - EDGE;
      const above = a.top - area.top - gap - EDGE;
      const room = down ? below : above;
      const other = down ? above : below;
      const flip = r.height > room && other > room;
      const h = Math.min(r.height, Math.max(flip ? other : room, MIN_H));
      if (h < r.height) s.maxHeight = `${h}px`;
      if (flip) {
        s.bottom = "auto";
        s.top = `${down ? -gap - h : a.height + gap}px`;
      }
      const r2 = el.getBoundingClientRect();
      let dx = 0;
      if (r2.right > area.right - EDGE) dx = area.right - EDGE - r2.right;
      if (r2.left + dx < area.left + EDGE) dx = area.left + EDGE - r2.left;
      if (dx) s.translate = `${dx}px 0`;
    };
    fit();
    const vv = window.visualViewport;
    window.addEventListener("resize", fit);
    vv?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      vv?.removeEventListener("resize", fit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, box, ...deps]);
}

/**
 * Всплывающий блок поверх всего: блок рисуется в document.body (через портал) с position: fixed и встаёт
 * у кнопки-якоря — под ней, правым краем по её правому краю. Не помещается снизу, а сверху места больше —
 * открывается вверх; не влезает и так — сжимается по высоте. По горизонтали не выходит за экран.
 * Так блок не перекрывают соседние таблицы, прилипшие шапки и не обрезает прокручиваемая панель.
 * Место пересчитывается при прокрутке любого предка, смене размера окна и появлении клавиатуры.
 * На блоке ставится data-side="above|below" — от него зависит, откуда растёт анимация появления.
 */
export function useFloating(open: boolean, anchor: RefObject<HTMLElement | null>, box: RefObject<HTMLElement | null>, { gap = 4, deps = [] as readonly unknown[] } = {}) {
  useLayoutEffect(() => {
    const el = box.current;
    const a0 = anchor.current;
    if (!open || !el || !a0) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a) return;
      const vv = window.visualViewport;
      const top0 = vv?.offsetTop ?? 0;
      const vh = vv?.height ?? window.innerHeight;
      const vw = window.innerWidth;
      const s = el.style;
      s.maxHeight = "";
      const natural = el.scrollHeight + (el.offsetHeight - el.clientHeight);
      const below = top0 + vh - a.bottom - gap - EDGE;
      const above = a.top - top0 - gap - EDGE;
      const up = natural > below && above > below;
      const room = Math.max(up ? above : below, MIN_H);
      if (natural > room) s.maxHeight = `${room}px`;
      const h = Math.min(natural, room);
      s.top = `${up ? a.top - gap - h : a.bottom + gap}px`;
      const w = el.offsetWidth;
      s.left = `${Math.max(EDGE, Math.min(a.right - w, vw - EDGE - w))}px`;
      el.dataset.side = up ? "above" : "below";
    };
    place();
    const vv = window.visualViewport;
    window.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
    vv?.addEventListener("resize", place);
    // содержимое меняет высоту (поиск в списке товаров) — переставить
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => {
      window.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
      vv?.removeEventListener("resize", place);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anchor, box, gap, ...deps]);
}
