import type { FontBook } from "../fonts";
import { resolveTag, type TagDoc, type Workspace } from "../model";
import { GREY, INK, TAG as T, ruDate, upper } from "./design";
import type { El, Scene } from "./scene";

/**
 * Ценник: полоса слева фиксированной ширины, название — слева сверху, цена — слева снизу,
 * «Изготовлено … в …» — справа снизу. Кегли и поля масштабируются от базового 89,3×45,2,
 * название подбирается так, чтобы влезть в 2 строки (на узких — в 3).
 */
export function layoutTag(ws: Workspace, doc: TagDoc, fb: FontBook, resolved = resolveTag(ws, doc)): Scene {
  const { w, h } = doc.size;
  const s = Math.min(h / T.base.h, w / T.base.w);
  const els: El[] = [];
  const warnings: string[] = [];
  const r = resolved;
  if (r.broken) warnings.push("Позиция, к которой привязан ценник, удалена из меню.");

  els.push({ kind: "rect", x: 0, y: 0, w: T.bar, h, fill: ws.brand.accent, bleed: { left: true, top: true, bottom: true } });

  const x0 = T.bar + T.padLeft * s;
  const xR = w - T.padRight * s;
  const baseBottom = h - T.padBottom * s;
  const capH = fb.capHeight;

  // цена
  const priceSize = T.price.size * s;
  const priceStr = r.price != null ? String(r.price) : "—";
  const priceW = fb.measure(priceStr, "Medium", priceSize);
  els.push({ kind: "text", x: x0, y: baseBottom, text: priceStr, weight: "Medium", size: priceSize, tracking: 0, color: INK });
  if (r.volume) {
    const vs = T.volume.size * s;
    els.push({ kind: "text", x: x0 + priceW + 1.6 * s, y: baseBottom, text: `${r.volume} л`, weight: "Regular", size: vs, tracking: 0, color: GREY });
  }

  // справа внизу — изготовитель
  let infoLeft = xR;
  let infoTop = baseBottom;
  if (doc.showInfo) {
    const maker = (doc.maker ?? "").trim() || ws.brand.maker;
    const lines = ["Изготовлено", ...(doc.date ? [ruDate(doc.date)] : []), ...(maker ? [`в ${maker}`] : [])];
    const size = T.info.size * s;
    const pitch = T.info.pitch * s;
    lines.forEach((l, i) => {
      const lw = fb.measure(l, "Regular", size);
      const y = baseBottom - (lines.length - 1 - i) * pitch;
      els.push({ kind: "text", x: xR - lw, y, text: l, weight: "Regular", size, tracking: 0, color: GREY });
      infoLeft = Math.min(infoLeft, xR - lw);
    });
    infoTop = baseBottom - (lines.length - 1) * pitch - size * capH;
    if (infoLeft < x0 + priceW + 3 * s) warnings.push("Блок «Изготовлено» наезжает на цену — сократите текст или увеличьте ценник.");
  }

  // название: подбор кегля под ширину и высоту
  const name = upper(r.name);
  const top = T.padTop * s;
  const maxBottom = Math.min(baseBottom - priceSize * capH, infoTop) - T.name.gapToPrice * s;
  const width = xR - x0;
  const maxLines = w / h < 1.6 ? 3 : 2;
  let size = T.name.size * s;
  let lines: string[] = [];
  for (; size >= T.name.size * s * T.name.minScale; size *= 0.97) {
    lines = wrap(name, width, (t) => fb.measure(t, "Medium", size));
    const height = size * capH + (lines.length - 1) * size * T.name.leading;
    const fitsW = lines.every((l) => fb.measure(l, "Medium", size) <= width + 0.01);
    if (fitsW && lines.length <= maxLines && top + height <= maxBottom) break;
  }
  if (size < T.name.size * s * T.name.minScale) warnings.push("Название слишком длинное для этого размера ценника.");
  lines.forEach((l, i) => {
    els.push({ kind: "text", x: x0, y: top + size * capH + i * size * T.name.leading, text: l, weight: "Medium", size, tracking: 0, color: INK });
  });

  return { w, h, els, warnings };
}

/** Перенос по словам; слово длиннее строки остаётся целым (кегль тогда уменьшится). */
export function wrap(text: string, width: number, measure: (t: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const cand = line ? `${line} ${w}` : w;
    if (line && measure(cand) > width) {
      lines.push(line);
      line = w;
    } else line = cand;
  }
  if (line) lines.push(line);
  return lines;
}
