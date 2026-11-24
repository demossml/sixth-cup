import type { FontBook } from "../fonts";
import { addonGroups, addonLine, printedGroup, variationBlocks, type Group, type Line, type MenuDoc, type Price, type Workspace } from "../model";
import { A4, INK, LOGO, MENU as M, PRINTER_MARGIN, PT_MM, upper, WORDMARKS } from "./design";
import type { El, Scene, Weight } from "./scene";

/** Насколько можно уменьшить текст меню, чтобы всё поместилось (доля от размера в макете). */
export const FIT_MIN = 0.6;

/**
 * Вёрстка листа меню. Всё считается в координатах A4 и масштабируется под формат листа.
 *
 * Лист и его пропорции не меняются никогда. Если содержимое не помещается, уменьшается только
 * основное меню: кегль строк, высота строк и толщина линий (она подобрана под кегль). Ширина блоков,
 * логотип, заголовок-надпись, добавки и сноски остаются как в макете. Что не влезло даже так —
 * остаётся в сцене ниже границы, чтобы превью показало, сколько вылезает.
 */
export function layoutMenu(ws: Workspace, doc: MenuDoc, fb: FontBook): Scene {
  const accent = ws.brand.accent;
  const s = Math.min(doc.size.w / A4.w, doc.size.h / A4.h);
  const ox = (doc.size.w - A4.w * s) / 2;
  const baseH = doc.size.h / s;
  const cap = (size: number) => size * fb.capHeight;
  // пустые строки-заготовки из редактора на лист не идут
  const groups = doc.groupIds.map((id) => ws.groups.find((g) => g.id === id)).filter((g): g is Group => !!g).map(printedGroup);

  // Поля принтера — физические миллиметры, с листом не масштабируются.
  const safe = PRINTER_MARGIN / s;
  const F = M.footnote;
  const footBase = baseH - Math.max(F.bottomPad, safe + F.size * 0.25);

  const first = build(1);
  const priceNote = ws.brand.priceNote
    .split(/\s*\n\s*/)
    .filter(Boolean)
    .join(" ");
  const allergenNote = first.usesAllergen ? ws.brand.allergenNote.trim() : "";
  // ниже этой линии содержимому нельзя: там сноска и поле, где принтер не печатает
  const limit = priceNote || allergenNote ? footBase - cap(F.size) - F.gapAbove : baseH - Math.max(M.bottomLimit, safe);

  // Длинное название, которое налезает на цены, — тоже повод уменьшить текст: подпись целиком
  // важнее кегля, а мелкий шрифт чинит и высоту, и ширину строки.
  const nameClash = (p: { warnings: string[] }) => p.warnings.some((w) => w.includes(": название наезжает на цен"));
  const fits = (p: { bottom: number; warnings: string[] }) => p.bottom <= limit && !nameClash(p);

  let fit = 1;
  let page = first;
  if (!fits(first)) {
    const at = (p: number) => build(p / 100);
    let lo = Math.round(FIT_MIN * 100);
    let hi = 99;
    page = at(lo);
    if (fits(page)) {
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const r = at(mid);
        if (fits(r)) {
          lo = mid;
          page = r;
        } else hi = mid - 1;
      }
    }
    fit = lo / 100;
  }
  const { els, warnings } = page;
  const overflow = Math.max(0, page.bottom - limit) * s;
  if (overflow > 0.05) {
    warnings.push(
      `Содержимое не помещается на лист: вылезает ${Math.ceil(overflow)} мм, хотя текст уже уменьшен до предела. Красным показано, что не влезло, — уберите позиции или группу.`,
    );
  }

  // --- сноска внизу одной строкой: сначала пометка о ценах, за ней пояснение «А». Не уменьшается.
  {
    const put = (x: number, str: string) => {
      const { lsb } = fb.bearings(str, "Regular", F.size);
      els.push({ kind: "text", x: x - lsb, y: footBase, text: str, weight: "Regular", size: F.size, tracking: 0, color: INK });
      return fb.measure(str, "Regular", F.size) - lsb;
    };
    let x = M.left;
    if (priceNote) x += put(x, priceNote) + F.gap;
    if (allergenNote) put(x, allergenNote);
  }

  // --- масштаб под формат листа
  const scaled = els.map((e): El => {
    switch (e.kind) {
      case "text":
        return { ...e, x: e.x * s + ox, y: e.y * s, size: e.size * s };
      case "line":
        return { ...e, x1: e.x1 * s + ox, x2: e.x2 * s + ox, y1: e.y1 * s, y2: e.y2 * s, width: e.width * s, dash: e.dash && [e.dash[0] * s, e.dash[1] * s] };
      case "rect":
        return { ...e, x: e.x * s + ox, y: e.y * s, w: e.w * s, h: e.h * s, strokeWidth: e.strokeWidth && e.strokeWidth * s };
      case "path":
        return { ...e, x: e.x * s + ox, y: e.y * s, scale: e.scale * s };
    }
  });

  // --- что попало в поля, где принтер не печатает (низ при переполнении уже назван выше)
  const m = PRINTER_MARGIN;
  const { w, h } = doc.size;
  const eps = 0.05;
  const inMargin = scaled.some((e) => {
    let x1: number, x2: number, y1: number, y2: number;
    if (e.kind === "text") {
      x1 = e.x;
      x2 = e.x + fb.measure(e.text, e.weight, e.size, e.tracking);
      y1 = e.y - cap(e.size);
      y2 = e.y;
    } else if (e.kind === "line") {
      [x1, x2, y1, y2] = [Math.min(e.x1, e.x2), Math.max(e.x1, e.x2), Math.min(e.y1, e.y2), Math.max(e.y1, e.y2)];
    } else if (e.kind === "rect") {
      [x1, x2, y1, y2] = [e.x, e.x + e.w, e.y, e.y + e.h];
    } else if (e.d === LOGO) {
      [x1, x2, y1, y2] = [e.x, e.x + M.logo.w * s, e.y, e.y + M.logo.h * s];
    } else return false;
    return x1 < m - eps || x2 > w - m + eps || y1 < m - eps || (overflow <= 0.05 && y2 > h - m + eps);
  });
  if (inMargin) warnings.push(`Часть содержимого попадает в поля, где обычный принтер не печатает (${m} мм от края листа).`);

  return { w, h, els: scaled, warnings: [...new Set(warnings)], fit, overflow, limitY: limit * s, contentBottom: page.bottom * s, margin: m, inMargin };

  /** Одна попытка вёрстки: k — масштаб основного меню (текст, строки, линии), 1 — как в макете. */
  function build(k: number) {
    const els: El[] = [];
    const warnings: string[] = [];
    // размеры основного меню, которые уменьшаются вместе с текстом
    const T = {
      row: M.row * k,
      rowBaseline: M.rowBaseline * k,
      text: M.text * k,
      ruleSolid: M.ruleSolid * k,
      ruleDash: M.ruleDash * k,
      dash: [M.dash[0] * k, M.dash[1] * k] as [number, number],
      labels: M.labels.size * k,
      capTopPad: M.labels.capTopPad * k,
      headerToRow: M.headerToRow * k,
      section: M.section.size * k,
      sectionGap: M.section.gapBefore * k,
      // колонки цен сужаются вместе с текстом: правый край последней стоит на месте
      colPitch: M.colPitch * k,
      sepOffset: M.sepOffset * k,
    };

    // x — край буквы (как в Figma по контурам), а не начало кегельной площадки
    const text = (x: number, y: number, str: string, weight: Weight, size: number, color = INK, tracking = 0) => {
      const { lsb } = fb.bearings(str, weight, size);
      els.push({ kind: "text", x: x - lsb, y, text: str, weight, size, tracking, color });
      return fb.measure(str, weight, size, tracking) - lsb;
    };
    const right = (xRight: number, y: number, str: string, weight: Weight, size: number, color = INK, tracking = 0) => {
      const { lsb, rsb } = fb.bearings(str, weight, size);
      const w = fb.measure(str, weight, size, tracking);
      els.push({ kind: "text", x: xRight + rsb - w, y, text: str, weight, size, tracking, color });
      return w - lsb - rsb;
    };
    const hline = (y: number, x1: number, x2: number, width: number, dash?: boolean) =>
      els.push({ kind: "line", x1, y1: y, x2, y2: y, width, color: accent, dash: dash ? T.dash : undefined });
    type Block = { top: number; bottom: number; prices: Price[] | null };
    /**
     * Пунктир между колонками цен — только там, где цены есть по обе стороны.
     * blocks — строки сверху вниз (prices: null — строка подписей, там пунктир есть всегда); f — доля от размеров таблицы.
     */
    const separators = (edges: number[], blocks: Block[], f: number) => {
      const width = T.ruleDash * f;
      const dash: [number, number] = [T.dash[0] * f, T.dash[1] * f];
      const vline = (x: number, y1: number, y2: number) => els.push({ kind: "line", x1: x, y1, x2: x, y2, width, color: accent, dash });
      for (let c = 0; c < edges.length - 1; c++) {
        const x = edges[c] + T.sepOffset * f;
        let start: number | null = null;
        let end = 0;
        for (const b of blocks) {
          const on = b.prices === null || (b.prices[c] != null && b.prices[c + 1] != null);
          if (on) {
            if (start === null) start = b.top;
            end = b.bottom;
          } else if (start !== null) {
            vline(x, start, end - 0.6 * k * f);
            start = null;
          }
        }
        if (start !== null) vline(x, start, end - 0.6 * k * f);
      }
    };

    let usesAllergen = false;
    // Рамка «А» рисуется от кегля строки: уменьшается вместе с текстом, в добавках и узком списке — под их кегль.
    const allergenBox = (xAfter: number, baseline: number, size: number, weight: Weight, color: string) => {
      usesAllergen = true;
      const a = M.allergen;
      const f = size / M.text;
      const sw = a.stroke[weight] * f;
      const x = xAfter + a.gap * f;
      const w = a.w * f;
      const h = a.h * f;
      // линия рамки лежит внутри габарита; рамка слегка выступает за верх прописных и за базовую линию
      const bottom = baseline + a.drop * f;
      els.push({ kind: "rect", x: x + sw / 2, y: bottom - h + sw / 2, w: w - sw, h: h - sw, stroke: color, strokeWidth: sw });
      const letter = "А";
      const ls = a.letter * f;
      const { lsb, rsb } = fb.bearings(letter, "Medium", ls);
      const ink = fb.measure(letter, "Medium", ls) - lsb - rsb;
      text(x + (w - ink) / 2, bottom - (h - cap(ls)) / 2, letter, "Medium", ls, color);
      return x + w;
    };
    const nameWithMarks = (x: number, baseline: number, line: Line, weight: Weight, size: number, color = INK, tracking = 0) => {
      let end = x + text(x, baseline, upper(line.name), weight, size, color, tracking);
      if (line.note) {
        const nx = end + 0.8;
        end =
          nx +
          text(
            nx,
            baseline - M.addons.noteRise * (size / M.addons.size),
            upper(line.note),
            weight,
            M.addons.noteSize * (size / M.addons.size),
            color,
            tracking,
          );
      }
      if (line.allergen) end = allergenBox(end, baseline, size, weight, color);
      return end;
    };

    // --- шапка: логотип и заголовок-надпись не уменьшаются
    els.push({ kind: "path", x: M.logo.x, y: M.logo.y, scale: PT_MM, d: LOGO, fill: accent });

    let bottom = M.logo.y + M.logo.h;
    // первая таблица без крупного заголовка не ждёт его места: верх её заголовка встаёт туда,
    // где был бы верх крупного заголовка (базовая линия крупного минус высота его заглавных)
    const heroTop = M.hero.firstBaseline - cap(M.hero.size);
    const firstBase = (size: number) => heroTop + cap(size);

    groups.forEach((g0, gi) => {
      const first = gi === 0;
      if (g0.style === "addons") {
        bottom = layoutAddons(g0, first ? firstBase(M.addons.size) - M.addons.firstBaseline : bottom);
        return;
      }
      const g = withoutEmptyColumns(g0);
      if (g.style === "compact") {
        bottom = layoutCompact(g, first ? firstBase(M.compact.title * k) : bottom + T.sectionGap);
        return;
      }
      const hero = g.style === "hero";
      const baseline = first ? (hero ? M.hero.firstBaseline : firstBase(T.section)) : bottom + (hero ? M.hero.gapBefore : T.sectionGap);
      const mark = hero ? WORDMARKS[upper(g.title).trim().replace(/\s+/g, " ")] : undefined;
      let titleRight: number;
      if (mark) {
        els.push({ kind: "path", x: M.hero.x, y: baseline - mark.inkBottom * PT_MM, scale: PT_MM, d: mark.d, fill: accent });
        titleRight = M.hero.x + mark.w * PT_MM;
      } else if (hero) titleRight = M.hero.x + text(M.hero.x, baseline, upper(g.title), "Light", M.hero.size, accent, M.hero.tracking);
      else titleRight = M.left + text(M.left, baseline, upper(g.title), "Medium", T.section, accent);
      // заголовок стоит в одной строке с подписями объёмов: с лишней колонкой они сталкиваются
      const firstLabel = M.colRightLast - (g.columns.length - 1) * T.colPitch - fb.measure(upper(g.columns[0] ?? ""), "Regular", T.labels);
      if (g.columns.length > 1 && titleRight > firstLabel - 2)
        warnings.push(
          `Заголовок «${g.title}» наезжает на колонки объёма: уберите колонку, сократите заголовок${hero ? " или выберите вид «Таблица с подзаголовком»" : ""}.`,
        );
      bottom = layoutTable(g, baseline - 0.2);
    });

    // --- таблица с колонками объёмов
    function layoutTable(g: Group, labelBase: number): number {
      const n = g.columns.length;
      const edges = g.columns.map((_, i) => M.colRightLast - (n - 1 - i) * T.colPitch);
      g.columns.forEach((c, i) => right(edges[i] + 0.1, labelBase, upper(c), "Regular", T.labels, accent));
      const blocks: Block[] = [{ top: labelBase - cap(T.labels) - T.capTopPad, bottom: labelBase + T.headerToRow, prices: null }];
      let top = labelBase + T.headerToRow;
      const priceCells = (prices: Price[], baseline: number) =>
        prices.forEach((p, i) => {
          if (p !== null && p !== undefined && i < n) right(edges[i], baseline, String(p), "Regular", T.text);
        });
      const firstPriceInk = (prices: Price[]) => {
        const i = prices.findIndex((p, k) => k < n && p !== null && p !== undefined);
        return i < 0 ? M.ruleX2 : edges[i] - fb.measure(String(prices[i]), "Regular", T.text) + fb.bearings(String(prices[i]), "Regular", T.text).rsb;
      };

      g.items.forEach((item, idx) => {
        const nameEnd = nameWithMarks(M.left, top + T.rowBaseline, item, "Medium", T.text);
        if (nameEnd > firstPriceInk(item.prices) - 2) warnings.push(`«${item.name}»: название наезжает на цены — сократите его.`);
        priceCells(item.prices, top + T.rowBaseline);
        blocks.push({ top, bottom: top + T.row, prices: item.prices });
        top += T.row;
        // вариации с общей ценой — один блок, цена по центру блока
        for (const block of variationBlocks(item.variations)) {
          hline(top, M.ruleX1, M.ruleX2, T.ruleDash, true);
          const L = block.length;
          const prices = block[0].prices;
          block.forEach((v, j) => {
            const end = nameWithMarks(M.indent, top + j * T.row + T.rowBaseline, v, "Regular", T.text, INK, -0.01);
            if (end > firstPriceInk(prices) - 2) warnings.push(`«${v.name}»: название наезжает на цены.`);
          });
          priceCells(prices, top + L * (T.row / 2) + (T.rowBaseline - T.row / 2));
          blocks.push({ top, bottom: top + L * T.row, prices });
          top += L * T.row;
        }
        if (idx < g.items.length - 1) hline(top, M.ruleX1, M.ruleX2, T.ruleSolid);
      });

      separators(edges, blocks, 1);
      return top;
    }

    // --- узкий список по центру («К кофе»). Ширина та же при любом числе объёмов:
    // колонки цен стоят у правого края списка, место под них берётся у названий.
    function layoutCompact(g: Group, titleBase: number): number {
      const C0 = M.compact;
      const C = {
        ...C0,
        size: C0.size * k,
        title: C0.title * k,
        pitch: C0.pitch * k,
        firstRow: C0.firstRow * k,
        ruleBelow: C0.ruleBelow * k,
        rule: C0.rule * k,
        colPitch: C0.colPitch * k,
      };
      const n = Math.max(1, g.columns.length);
      const edges = Array.from({ length: n }, (_, i) => C.priceRight - (n - 1 - i) * C.colPitch);
      const titleEnd = C.nameX + text(C.nameX, titleBase, upper(g.title), "Medium", C.title, accent);
      g.columns.forEach((c, i) => right(edges[i] + 0.1, titleBase, upper(c), "Regular", T.labels, accent));
      const firstLabel = edges[0] + 0.1 - fb.measure(upper(g.columns[0] ?? ""), "Regular", T.labels);
      if (n > 1 && titleEnd > firstLabel - 2) warnings.push(`Заголовок «${g.title}» наезжает на колонки объёма: уберите колонку или сократите заголовок.`);
      // пунктир и отступ вариаций — как в таблице, но под кегль списка
      const f = C0.size / M.text;
      const indent = (M.indent - M.left) * f;
      // строка списка: от линейки над ней до линейки под ней, базовая линия — на ruleBelow выше нижней
      const rowBase = C.pitch - C.ruleBelow;
      let top = titleBase + C.firstRow - rowBase;
      const blocks: Block[] = [{ top: titleBase - cap(T.labels) - T.capTopPad, bottom: top, prices: null }];
      /** Цены строки по колонкам; возвращает левый край первой цены — до него можно писать название. */
      const priceCells = (prices: Price[], baseline: number) => {
        let firstInk = C.priceRight;
        for (let i = n - 1; i >= 0; i--) {
          const p = prices[i];
          if (p != null) firstInk = edges[i] - right(edges[i], baseline, String(p), "Regular", C.size);
        }
        return firstInk;
      };
      const overlap = n > 1 ? "цены" : "цену";
      g.items.forEach((item, idx) => {
        const end = nameWithMarks(C.nameX, top + rowBase, item, "Medium", C.size);
        if (end > priceCells(item.prices, top + rowBase) - 2) warnings.push(`«${item.name}»: название наезжает на ${overlap}.`);
        blocks.push({ top, bottom: top + C.pitch, prices: item.prices });
        top += C.pitch;
        // вариации с общей ценой — один блок, цена по центру блока
        for (const block of variationBlocks(item.variations)) {
          els.push({ kind: "line", x1: C.x1, y1: top, x2: C.x2, y2: top, width: T.ruleDash * f, color: accent, dash: [T.dash[0] * f, T.dash[1] * f] });
          const L = block.length;
          const prices = block[0].prices;
          const firstInk = priceCells(prices, top + L * (C.pitch / 2) + (rowBase - C.pitch / 2));
          block.forEach((v, j) => {
            const end = nameWithMarks(C.nameX + indent, top + j * C.pitch + rowBase, v, "Regular", C.size, INK, -0.01);
            if (end > firstInk - 2) warnings.push(`«${v.name}»: название наезжает на ${overlap}.`);
          });
          blocks.push({ top, bottom: top + L * C.pitch, prices });
          top += L * C.pitch;
        }
        if (idx < g.items.length - 1) hline(top, C.x1, C.x2, C.rule);
      });
      separators(edges, blocks, f);
      return top;
    }

    // --- добавки: длинные списки слева в строку, короткие — справа столбиком
    function layoutAddons(g: Group, prevBottom: number): number {
      const A = M.addons;
      const t = A.tracking;
      // группа добавок с общей ценой — одна строка: «+40 СИРОП ВАНИЛЬ, КАРАМЕЛЬ, …»
      const entries = addonGroups(g.items)
        .map(addonLine)
        .filter((i) => i.prices[0] != null);
      // что не влезает в столбик справа — слева, с переносом по словам
      let left = entries.filter((i) => fb.measure(upper(i.name), "Medium", A.size, t) > M.ruleX2 - A.nameX);
      let rightCol = entries.filter((i) => !left.includes(i));
      let leftTabular = false;
      if (left.length === 0) {
        leftTabular = true;
        left = rightCol.slice(0, Math.ceil(rightCol.length / 2));
        rightCol = rightCol.slice(left.length);
      }
      const first = prevBottom + A.firstBaseline;
      let yl = first;
      for (const it of left) {
        if (leftTabular) {
          text(A.leftX, yl, `+${it.prices[0]}`, "Medium", A.size, accent, t);
          nameWithMarks(A.leftX + (A.nameX - A.priceX), yl, it, "Medium", A.size, accent, t);
          yl += A.pitch;
          continue;
        }
        const words = `+${it.prices[0]} ${upper(it.name)}`.split(/\s+/);
        let line = "";
        for (const w of words) {
          const cand = line ? `${line} ${w}` : w;
          if (line && fb.measure(cand, "Medium", A.size, t) > A.leftWidth) {
            text(A.leftX, yl, line, "Medium", A.size, accent, t);
            yl += A.pitch;
            line = w;
          } else line = cand;
        }
        if (line) {
          const end = A.leftX + text(A.leftX, yl, line, "Medium", A.size, accent, t);
          if (it.note) text(end + 0.8, yl - A.noteRise, upper(it.note), "Medium", A.noteSize, accent, t);
          yl += A.pitch;
        }
      }
      let yr = first;
      for (const it of rightCol) {
        text(A.priceX, yr, `+${it.prices[0]}`, "Medium", A.size, accent, t);
        nameWithMarks(A.nameX, yr, it, "Medium", A.size, accent, t);
        yr += A.pitch;
      }
      return Math.max(yl, yr) - A.pitch + 2;
    }

    return { els, warnings, bottom, usesAllergen };
  }
}

/**
 * Колонка объёма без подписи и без единой цены на листе не нужна: иначе под неё остаётся место
 * у правого края и цены уезжают влево. Такая колонка появляется, когда объём добавили и не заполнили.
 */
function withoutEmptyColumns(g: Group): Group {
  const used = (i: number) =>
    g.columns[i].trim() !== "" || g.items.some((it) => it.prices[i] != null || it.variations.some((v) => v.prices[i] != null));
  const keep = g.columns.map((_, i) => i).filter(used);
  if (keep.length === g.columns.length || keep.length === 0) return g;
  const pick = (prices: Price[]) => keep.map((i) => prices[i] ?? null);
  return {
    ...g,
    columns: keep.map((i) => g.columns[i]),
    items: g.items.map((it) => ({ ...it, prices: pick(it.prices), variations: it.variations.map((v) => ({ ...v, prices: pick(v.prices) })) })),
  };
}
