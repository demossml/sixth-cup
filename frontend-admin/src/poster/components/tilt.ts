import type { PointerEvent } from "react";

/*
  Лист меню под курсором: приподнимается к зрителю (чуть увеличивается) и прогибается — сторона под
  курсором уходит вглубь, противоположная приподнимается.

  Значения не прыгают за курсором, а догоняют его плавно (экспоненциальное сглаживание по времени кадра):
  при наведении наклон и подъём нарастают с нуля из центра листа, а не включаются сразу на всю силу
  у того края, где курсор вошёл; при уходе так же плавно возвращаются. Здесь — только числа
  (--dx, --dy от −0.5 до 0.5 и --lift от 0 до 1); сам наклон и тень считает CSS (.menu-card в globals.css).
  Только для мыши и трекпада и только если система не просит уменьшить движение.
*/

const TAU_TILT = 120; // мс: за сколько наклон проходит ~63 % пути до курсора
const TAU_LIFT = 160; // подъём — чуть медленнее наклона: лист сначала «замечает» курсор, потом тянется к нему

interface State {
  x: number;
  y: number;
  lift: number;
  tx: number;
  ty: number;
  tl: number;
  raf: number;
  last: number;
}

const states = new WeakMap<HTMLElement, State>();

const enabled = () =>
  window.matchMedia("(hover: hover) and (pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

function run(paper: HTMLElement, s: State) {
  if (s.raf) return;
  s.last = performance.now();
  const step = (now: number) => {
    const dt = Math.min(64, Math.max(0, now - s.last)); // время кадра rAF бывает раньше performance.now() при старте
    s.last = now;
    const a = 1 - Math.exp(-dt / TAU_TILT);
    const b = 1 - Math.exp(-dt / TAU_LIFT);
    s.x += (s.tx - s.x) * a;
    s.y += (s.ty - s.y) * a;
    s.lift = Math.max(0, s.lift + (s.tl - s.lift) * b);
    const done = Math.abs(s.tx - s.x) < 0.001 && Math.abs(s.ty - s.y) < 0.001 && Math.abs(s.tl - s.lift) < 0.002;
    if (done && s.tl === 0) {
      // лист вернулся на место — убрать всё, чтобы он стоял ровно, как без эффекта
      s.raf = 0;
      paper.style.removeProperty("--dx");
      paper.style.removeProperty("--dy");
      paper.style.removeProperty("--lift");
      states.delete(paper);
      return;
    }
    paper.style.setProperty("--dx", (s.x - 0.5).toFixed(4));
    paper.style.setProperty("--dy", (s.y - 0.5).toFixed(4));
    paper.style.setProperty("--lift", s.lift.toFixed(4));
    s.raf = done ? 0 : requestAnimationFrame(step);
  };
  s.raf = requestAnimationFrame(step);
}

/** Цель — точка курсора на листе. Считаем от рамки .thumb: сам лист наклонён и увеличен, его рамка «плывёт». */
function aim(e: PointerEvent<HTMLElement>, lifted: boolean) {
  if (e.pointerType !== "mouse" || !enabled()) return;
  const frame = e.currentTarget.querySelector<HTMLElement>(".thumb");
  const paper = frame?.querySelector<HTMLElement>(".paper");
  if (!frame || !paper) return;
  const s = states.get(paper) ?? { x: 0.5, y: 0.5, lift: 0, tx: 0.5, ty: 0.5, tl: 0, raf: 0, last: 0 };
  states.set(paper, s);
  if (lifted) {
    const r = frame.getBoundingClientRect();
    s.tx = clamp((e.clientX - r.left) / r.width);
    s.ty = clamp((e.clientY - r.top) / r.height);
    s.tl = 1;
  } else {
    s.tx = 0.5;
    s.ty = 0.5;
    s.tl = 0;
  }
  run(paper, s);
}

export const tilt = {
  onPointerEnter: (e: PointerEvent<HTMLElement>) => aim(e, true),
  onPointerMove: (e: PointerEvent<HTMLElement>) => aim(e, true),
  onPointerLeave: (e: PointerEvent<HTMLElement>) => aim(e, false),
};
