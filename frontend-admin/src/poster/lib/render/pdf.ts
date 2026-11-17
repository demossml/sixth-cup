import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  LineCapStyle,
  beginText,
  endText,
  moveText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  setFillingRgbColor,
  setFontAndSize,
  showText,
} from "pdf-lib";
import type { FontBook } from "../fonts";
import type { Scene, Weight } from "../layout/scene";

const PT = 72 / 25.4;

export interface PdfOptions {
  /** Для типографии: вылеты 3 мм и метки реза. Без них — файл ровно в обрезной формат. */
  print: boolean;
  title: string;
}

export const BLEED = 3;
const SLUG = 8; // поле под метки реза

function color(hex: string) {
  const v = hex.replace("#", "");
  const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
  const num = parseInt(full, 16);
  return rgb(((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255);
}

/**
 * Сцена → PDF: только вектор, шрифты встраиваются подмножеством (только нужные знаки),
 * потоки сжаты, в метаданных нет ничего лишнего. Обычно это десятки килобайт.
 */
export async function sceneToPdf(scene: Scene, fb: FontBook, opts: PdfOptions): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit);
  pdf.setTitle(opts.title, { showInWindowTitleBar: true });
  pdf.setProducer("6.7 · конструктор меню");
  pdf.setCreator("6.7 · конструктор меню");
  pdf.setLanguage("ru-RU");

  const bleed = opts.print ? BLEED : 0;
  const slug = opts.print ? SLUG : 0;
  const off = bleed + slug;
  const W = scene.w + 2 * off;
  const H = scene.h + 2 * off;
  const page = pdf.addPage([W * PT, H * PT]);
  const X = (x: number) => (x + off) * PT;
  const Y = (y: number) => (H - (y + off)) * PT;
  if (opts.print) {
    page.setTrimBox(off * PT, off * PT, scene.w * PT, scene.h * PT);
    page.setBleedBox(slug * PT, slug * PT, (scene.w + 2 * bleed) * PT, (scene.h + 2 * bleed) * PT);
  }

  const fonts = new Map<Weight, { font: PDFFont; key: string }>();
  const fontFor = async (w: Weight) => {
    let f = fonts.get(w);
    if (!f) {
      const font = await pdf.embedFont(fb.bytes[w], { subset: true });
      const key = page.node.newFontDictionary(font.name, font.ref).decodeText();
      f = { font, key };
      fonts.set(w, f);
    }
    return f;
  };

  for (const e of scene.els) {
    switch (e.kind) {
      case "rect": {
        let { x, y, w, h } = e;
        if (e.bleed) {
          if (e.bleed.left) { w += x + bleed; x = -bleed; }
          if (e.bleed.top) { h += y + bleed; y = -bleed; }
          if (e.bleed.right) w = scene.w + bleed - x;
          if (e.bleed.bottom) h = scene.h + bleed - y;
        }
        page.drawRectangle({
          x: X(x), y: Y(y + h), width: w * PT, height: h * PT,
          color: e.fill ? color(e.fill) : undefined,
          borderColor: e.stroke ? color(e.stroke) : undefined,
          borderWidth: e.stroke ? (e.strokeWidth ?? 0.3) * PT : 0,
        });
        break;
      }
      case "line":
        page.drawLine({
          start: { x: X(e.x1), y: Y(e.y1) }, end: { x: X(e.x2), y: Y(e.y2) },
          thickness: e.width * PT, color: color(e.color),
          dashArray: e.dash ? [e.dash[0] * PT, e.dash[1] * PT] : undefined,
          lineCap: LineCapStyle.Butt,
        });
        break;
      case "path":
        page.drawSvgPath(e.d, { x: X(e.x), y: Y(e.y), scale: e.scale * PT, color: color(e.fill), borderWidth: 0 });
        break;
      case "text": {
        const { font, key } = await fontFor(e.weight);
        const c = color(e.color);
        page.pushOperators(
          pushGraphicsState(),
          beginText(),
          setFillingRgbColor(c.red, c.green, c.blue),
          setFontAndSize(key, e.size * PT),
          ...(e.tracking ? [setCharacterSpacing(e.tracking * e.size * PT)] : []),
          moveText(X(e.x), Y(e.y)),
          showText(font.encodeText(e.text)),
          endText(),
          popGraphicsState(),
        );
        break;
      }
    }
  }
  if (opts.print) drawCropMarks(page, scene.w, scene.h, off, H);
  return pdf.save({ useObjectStreams: true, addDefaultPage: false });
}

function drawCropMarks(page: PDFPage, w: number, h: number, off: number, H: number) {
  const len = SLUG - 2;
  const gap = BLEED + 0.5; // метки начинаются за вылетом
  const black = rgb(0, 0, 0);
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    page.drawLine({ start: { x: x1 * PT, y: (H - y1) * PT }, end: { x: x2 * PT, y: (H - y2) * PT }, thickness: 0.25, color: black });
  for (const x of [off, off + w]) {
    line(x, off - gap - len, x, off - gap);
    line(x, off + h + gap, x, off + h + gap + len);
  }
  for (const y of [off, off + h]) {
    line(off - gap - len, y, off - gap, y);
    line(off + w + gap, y, off + w + gap + len, y);
  }
}
