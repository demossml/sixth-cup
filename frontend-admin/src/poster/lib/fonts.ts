import fontkit from "@pdf-lib/fontkit";
import type { Weight } from "./layout/scene";

// Одни и те же TTF меряют текст при вёрстке, рисуют превью и встраиваются в PDF.
// Кернинг намеренно не используется нигде: pdf-lib рисует глифы по их ширинам,
// поэтому замер = превью = печать.

export const WEIGHTS: Weight[] = ["Light", "Regular", "Medium"];
export const FONT_FAMILY = "Inter Display";
export const fontUrl = (w: Weight) => `/poster/fonts/InterDisplay-${w}.ttf`;

type FkGlyph = { advanceWidth: number; bbox: { minX: number; maxX: number } };
type FkFont = {
  unitsPerEm: number;
  capHeight: number;
  layout(text: string): { glyphs: FkGlyph[] };
};

export interface FontBook {
  bytes: Record<Weight, Uint8Array>;
  /** Ширина строки в мм (кегль в мм, трекинг в долях кегля). */
  measure(text: string, weight: Weight, size: number, tracking?: number): number;
  /** Поля первого и последнего знака в мм: чтобы выравнивать по краю буквы, а не по кеглю. */
  bearings(text: string, weight: Weight, size: number): { lsb: number; rsb: number };
  capHeight: number; // доля кегля
}

export function makeFontBook(bytes: Record<Weight, Uint8Array>): FontBook {
  const fonts = {} as Record<Weight, FkFont>;
  for (const w of WEIGHTS) fonts[w] = fontkit.create(bytes[w]) as unknown as FkFont;
  const cache = new Map<string, number>();
  const sides = new Map<string, { lsb: number; rsb: number }>();
  return {
    bytes,
    capHeight: fonts.Regular.capHeight / fonts.Regular.unitsPerEm,
    measure(text, weight, size, tracking = 0) {
      if (!text) return 0;
      const key = weight + "\u0000" + text;
      let units = cache.get(key);
      if (units === undefined) {
        const f = fonts[weight];
        units = f.layout(text).glyphs.reduce((s, g) => s + g.advanceWidth, 0) / f.unitsPerEm;
        cache.set(key, units);
      }
      // трекинг добавляется после каждого знака, кроме последнего (так же рисует PDF)
      return units * size + tracking * size * (Array.from(text).length - 1);
    },
    // Свесы считаются в долях кегля один раз на строку и начертание: f.layout — самое дорогое в вёрстке,
    // а при подгонке под лист одни и те же строки меряются в каждой попытке (без кэша — ~50 мс на меню).
    bearings(text, weight, size) {
      if (!text) return { lsb: 0, rsb: 0 };
      const key = weight + "\u0000" + text;
      let b = sides.get(key);
      if (!b) {
        const f = fonts[weight];
        const g = f.layout(text).glyphs;
        const first = g[0];
        const last = g[g.length - 1];
        b = first && last ? { lsb: first.bbox.minX / f.unitsPerEm, rsb: (last.advanceWidth - last.bbox.maxX) / f.unitsPerEm } : { lsb: 0, rsb: 0 };
        sides.set(key, b);
      }
      return { lsb: b.lsb * size, rsb: b.rsb * size };
    },
  };
}

let browserBook: Promise<FontBook> | null = null;

/** Загрузка шрифтов в браузере (один раз за сессию, дальше — из кэша). */
export function loadFontBook(): Promise<FontBook> {
  if (!browserBook) {
    browserBook = Promise.all(
      WEIGHTS.map(async (w) => {
        const res = await fetch(fontUrl(w));
        if (!res.ok) throw new Error(`Не загрузился шрифт ${w}`);
        return [w, new Uint8Array(await res.arrayBuffer())] as const;
      }),
    ).then((pairs) => makeFontBook(Object.fromEntries(pairs) as Record<Weight, Uint8Array>));
    browserBook.catch(() => (browserBook = null));
  }
  return browserBook;
}
