import { FONT_FAMILY } from "../fonts";
import type { Scene, Weight } from "../layout/scene";

const WEIGHT_NUM: Record<Weight, number> = { Light: 300, Regular: 400, Medium: 500 };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => Number(v.toFixed(3));

export interface SvgOptions {
  className?: string;
  title?: string;
  /** Закрасить поля, где обычный принтер не печатает. */
  margins?: boolean;
  /** Показать поля и без margins, если в них что-то заезжает или лист переполнен (редактор). */
  autoMargins?: boolean;
  /** Показать то, что не влезло: превью продолжается ниже края листа, сам лист не меняется. */
  overflow?: boolean;
  /** Номера надписей сцены, которые нужно подсветить (отличия «Было / Будет»). */
  highlight?: Set<number>;
  /** Мерка ширины надписи — нужна только для подсветки. */
  measure?: (text: string, weight: Weight, size: number, tracking: number) => number;
}

const OVER = "#e5484d";
const MARK = "#121216"; // поля принтера и отличия «Было / Будет» — нейтральным, не цветом
const ALARM = "#e5484d"; // поля, в которые что-то заехало, — красным

/** Высота превью в мм: высота листа, а при переполнении — ещё и то, что вылезло за его край. */
export function previewHeight(scene: Scene): number {
  if (!scene.overflow || scene.overflow <= 0.05 || scene.contentBottom === undefined) return scene.h;
  return Math.max(scene.h, scene.contentBottom + scene.w * 0.02);
}

/** Сцена → SVG-строка в миллиметрах. Используется для превью и миниатюр. */
export function sceneToSvg(scene: Scene, opts: SvgOptions = {}): string {
  const out: string[] = [];
  const over = !!scene.overflow && scene.overflow > 0.05 && scene.limitY !== undefined;
  const H = opts.overflow ? previewHeight(scene) : scene.h;
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(scene.w)} ${n(H)}" preserveAspectRatio="xMidYMid meet"` +
      (opts.className ? ` class="${esc(opts.className)}"` : "") +
      ` role="img" aria-label="${esc(opts.title ?? "Превью")}" style="font-family:'${FONT_FAMILY}';font-kerning:none;text-rendering:geometricPrecision">`,
  );
  out.push(`<rect x="0" y="0" width="${n(scene.w)}" height="${n(scene.h)}" fill="#fff"/>`);
  if (H > scene.h) out.push(`<rect x="0" y="0" width="${n(scene.w)}" height="${n(scene.h)}" fill="none" stroke="#000" stroke-opacity="0.14" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
  scene.els.forEach((e, i) => {
    if (e.kind !== "text" || !opts.highlight?.has(i) || !opts.measure) return;
    const pad = e.size * 0.22;
    const wd = opts.measure(e.text, e.weight, e.size, e.tracking);
    out.push(`<rect x="${n(e.x - pad)}" y="${n(e.y - e.size * 0.9)}" width="${n(wd + 2 * pad)}" height="${n(e.size * 1.2)}" rx="${n(pad)}" fill="${MARK}" fill-opacity="0.13"/>`);
  });
  for (const e of scene.els) {
    switch (e.kind) {
      case "text":
        out.push(
          `<text x="${n(e.x)}" y="${n(e.y)}" font-size="${n(e.size)}" font-weight="${WEIGHT_NUM[e.weight]}" fill="${e.color}"` +
            (e.tracking ? ` letter-spacing="${n(e.tracking * e.size)}"` : "") +
            ` xml:space="preserve">${esc(e.text)}</text>`,
        );
        break;
      case "line":
        out.push(
          `<line x1="${n(e.x1)}" y1="${n(e.y1)}" x2="${n(e.x2)}" y2="${n(e.y2)}" stroke="${e.color}" stroke-width="${n(e.width)}"` +
            (e.dash ? ` stroke-dasharray="${n(e.dash[0])} ${n(e.dash[1])}"` : "") +
            `/>`,
        );
        break;
      case "rect":
        out.push(
          `<rect x="${n(e.x)}" y="${n(e.y)}" width="${n(e.w)}" height="${n(e.h)}" fill="${e.fill ?? "none"}"` +
            (e.stroke ? ` stroke="${e.stroke}" stroke-width="${n(e.strokeWidth ?? 0.3)}"` : "") +
            `/>`,
        );
        break;
      case "path":
        out.push(`<path transform="translate(${n(e.x)} ${n(e.y)}) scale(${n(e.scale)})" d="${e.d}" fill="${e.fill}"/>`);
        break;
    }
  }
  // поля нейтральные, пока в них ничего не заехало; заехало или лист переполнен — красные и видны сами
  const alarm = !!scene.inMargin || over;
  if (scene.margin && (opts.margins || (opts.autoMargins && alarm))) {
    const m = scene.margin;
    const { w, h } = scene;
    const c = alarm ? ALARM : MARK;
    out.push(
      `<path fill-rule="evenodd" d="M0 0H${n(w)}V${n(h)}H0ZM${n(m)} ${n(m)}V${n(h - m)}H${n(w - m)}V${n(m)}Z" fill="${c}" fill-opacity="${alarm ? 0.14 : 0.1}"/>` +
        `<rect x="${n(m)}" y="${n(m)}" width="${n(w - 2 * m)}" height="${n(h - 2 * m)}" fill="none" stroke="${c}" stroke-opacity="${alarm ? 0.8 : 0.55}" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`,
    );
  }
  if (over) {
    const y = scene.limitY!;
    out.push(
      `<rect x="0" y="${n(y)}" width="${n(scene.w)}" height="${n(H - y)}" fill="${OVER}" fill-opacity="0.14"/>` +
        `<line x1="0" y1="${n(y)}" x2="${n(scene.w)}" y2="${n(y)}" stroke="${OVER}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`,
    );
  }
  out.push(`</svg>`);
  return out.join("");
}

export const FONT_FACE_CSS = (["Light", "Regular", "Medium"] as Weight[])
  .map(
    (w) =>
      `@font-face{font-family:'${FONT_FAMILY}';src:url('/fonts/InterDisplay-${w}.ttf') format('truetype');font-weight:${WEIGHT_NUM[w]};font-style:normal;font-display:block}`,
  )
  .join("\n");
