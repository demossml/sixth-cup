// Сцена — результат вёрстки: список примитивов в миллиметрах, начало координат — левый верхний
// угол обрезного формата. Из одной сцены рисуются и превью (SVG), и PDF для типографии.

export type Weight = "Light" | "Regular" | "Medium";

export interface TextEl {
  kind: "text";
  x: number; // левый край строки (выравнивание уже посчитано вёрсткой)
  y: number; // базовая линия
  text: string;
  weight: Weight;
  size: number; // кегль в мм
  tracking: number; // межбуквенный в долях кегля
  color: string;
}

export interface LineEl {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color: string;
  dash?: [number, number];
}

export interface RectEl {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** Растянуть до края вылета по этим сторонам (полоса ценника, фон). */
  bleed?: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };
}

export interface PathEl {
  kind: "path";
  x: number;
  y: number;
  scale: number;
  d: string; // в мм относительно (x, y) при scale = 1
  fill: string;
}

export type El = TextEl | LineEl | RectEl | PathEl;

export interface Scene {
  w: number;
  h: number;
  els: El[];
  warnings: string[];
  /** Меню: во сколько раз уменьшен текст основного меню, чтобы поместиться (1 — как в макете). */
  fit?: number;
  /** Меню: сколько мм не влезло даже с самым мелким текстом. */
  overflow?: number;
  /** Меню: нижняя граница для содержимого, мм от верха листа. */
  limitY?: number;
  /** Меню: где кончается содержимое, мм от верха листа (при переполнении — ниже limitY). */
  contentBottom?: number;
  /** Поле, где принтер не печатает, мм. */
  margin?: number;
  /** Меню: что-то заезжает в это поле. */
  inMargin?: boolean;
}
