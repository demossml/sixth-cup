import { addonGroups, addonLine, printedGroup, resolveTag, variationBlocks, type Doc, type PriceNotice, type SentMark, type Workspace } from "./model";

// Отпечаток документа — хэш всего, что попадает в его PDF. Документ «изменён», если отпечаток
// не совпадает с тем, что был при последней отправке в типографию. Шрифты для этого не нужны.

// поднять при изменении вёрстки, чтобы документы этого вида ушли на перепечатку
export const MENU_LAYOUT_VERSION = 5; // 2: надписи из SVG, сноска о ценах; 3: логотип из SVG, отдельные вариации; 4: подгонка текста, знак аллергена; 5: первая таблица без крупного заголовка поднята к его верху
export const TAG_LAYOUT_VERSION = 1;

export function renderInput(ws: Workspace, doc: Doc): unknown {
  if (doc.kind === "menu") {
    return {
      v: MENU_LAYOUT_VERSION,
      kind: "menu",
      size: doc.size,
      brand: { accent: ws.brand.accent, note: ws.brand.priceNote, allergen: ws.brand.allergenNote },
      groups: doc.groupIds
        .map((id) => ws.groups.find((g) => g.id === id))
        .filter(Boolean)
        .map((g) => printedGroup(g!)) // пустые строки-заготовки на лист не идут
        .map((g) => ({
          t: g!.title,
          s: g!.style,
          c: g!.columns,
          // добавки — так, как печатаются: группа с общей ценой — одна строка
          i: (g!.style === "addons" ? addonGroups(g!.items).map((grp) => ({ ...addonLine(grp), variations: [] })) : g!.items).map((it) => ({
            n: it.name, a: !!it.allergen, o: it.note ?? "", p: it.prices,
            v: variationBlocks(it.variations).map((b) => ({ l: b.map((v) => [v.name, !!v.allergen, v.note ?? ""]), p: b[0].prices })),
          })),
        })),
    };
  }
  const r = resolveTag(ws, doc);
  return {
    v: TAG_LAYOUT_VERSION,
    kind: "tag",
    size: doc.size,
    accent: ws.brand.accent,
    name: r.name,
    price: r.price,
    volume: r.volume ?? "",
    info: doc.showInfo ? { date: doc.date ?? "", maker: (doc.maker ?? "").trim() || ws.brand.maker } : null,
    // дизайн — только если не основной: отпечатки уже отправленных ценников не меняются
    ...(doc.design && doc.design !== "classic" ? { design: doc.design } : {}),
  };
}

/** cyrb53 — быстрый некриптографический хэш, его хватает для сравнения версий. */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function fingerprint(ws: Workspace, doc: Doc): string {
  return hashString(JSON.stringify(renderInput(ws, doc)));
}

export function isChanged(ws: Workspace, doc: Doc): boolean {
  return !doc.lastSent || doc.lastSent.hash !== fingerprint(ws, doc);
}

export function lastSendAt(ws: Workspace): string | null {
  return ws.sends.length ? ws.sends[ws.sends.length - 1].at : null;
}

export function changesSinceLastSend(ws: Workspace) {
  const since = lastSendAt(ws);
  return ws.changeLog.filter((c) => !since || c.at > since);
}

/**
 * Статус печати документа:
 * pending — есть изменения, которых типография ещё не получала (или документ новый);
 * ordered — последняя версия ушла в последней отправке, заказ в работе;
 * ok      — без изменений: напечатанная версия актуальна.
 */
export type PrintStatus = "pending" | "ordered" | "ok";
export const STATUS_LABEL: Record<PrintStatus, string> = {
  pending: "Ожидает печати",
  ordered: "Заказ отправлен",
  ok: "Без изменений",
};

export function printStatus(ws: Workspace, doc: Doc): PrintStatus {
  if (isChanged(ws, doc)) return "pending";
  const last = ws.sends[ws.sends.length - 1];
  if (!last || !doc.lastSent) return "ok";
  if (doc.lastSent.sendId === last.id) return "ordered";
  // письма разным типографиям из одной отправки — один заказ
  const mine = ws.sends.find((s) => s.id === doc.lastSent!.sendId);
  return last.batch && mine?.batch === last.batch ? "ordered" : "ok";
}

/**
 * Насколько срочно печатать документ, который ждёт печати.
 * Цена из базы без даты активации (или с датой, которая уже наступила) — срочно.
 * Цена с датой в будущем — к этой дате: типография должна успеть напечатать, кафе — расставить.
 * null — срока нет: документ меняли вручную или он не ждёт печати.
 */
export type Due = { urgent: true } | { urgent: false; date: string };

export function docDue(ws: Workspace, doc: Doc, today = new Date().toISOString().slice(0, 10)): Due | null {
  if (!isChanged(ws, doc)) return null;
  const since = doc.lastSent?.at ?? "";
  const notices: PriceNotice[] = [];
  const take = (n?: PriceNotice) => {
    if (n && n.at > since) notices.push(n);
  };
  if (doc.kind === "menu") {
    for (const id of doc.groupIds)
      for (const it of ws.groups.find((g) => g.id === id)?.items ?? []) {
        take(it.priceNotice);
        for (const v of it.variations) take(v.priceNotice);
      }
  } else if (doc.ref) {
    const it = ws.groups.flatMap((g) => g.items).find((i) => i.id === doc.ref!.itemId);
    const v = doc.ref.variationId ? it?.variations.find((x) => x.id === doc.ref!.variationId) : undefined;
    take(v ? v.priceNotice : it?.priceNotice);
  }
  if (!notices.length) return null;
  if (notices.some((n) => !n.activeFrom || n.activeFrom <= today)) return { urgent: true };
  return { urgent: false, date: notices.map((n) => n.activeFrom!).sort()[0] };
}

/** Порядок в списке на печать: сначала срочные, потом по дате активации цены, потом остальные. */
export function dueRank(d: Due | null): string {
  return !d ? "9" : d.urgent ? "0" : `1${d.date}`;
}

/** Отметка «отправлено» с копией того, что ушло в печать. Копия пишется, только если документ с тех пор не менялся. */
export function sentMark(ws: Workspace, doc: Doc, hash: string, at: string, sendId: string): SentMark {
  const json = JSON.stringify(renderInput(ws, doc));
  // копия отдельная от документа: дальнейшие правки меню её не трогают
  return { hash, at, sendId, ...(hashString(json) === hash ? { snap: JSON.parse(json) } : {}) };
}

/** Журнал правок, которых получатель ещё не видел: с прошлой отправки, не считая писем этой же партии. */
export function changesForBatch(ws: Workspace, batch?: string) {
  const prev = [...ws.sends].reverse().find((s) => !batch || s.batch !== batch);
  return ws.changeLog.filter((c) => (!prev || c.at > prev.at) && !/^(Отправлено в типографию|Отмечено отправленным)/.test(c.text));
}

/** Сколько раз документы отправляли в печать: число отправок, в которых был хотя бы один из них. */
export function printCount(ws: Workspace, docIds: string[]): number {
  return ws.sends.filter((s) => s.docIds.some((id) => docIds.includes(id))).length;
}

/** «Ещё не печатали» / «Печатали 1 раз» / «Печатали 2 раза» / «Печатали 5 раз». */
export function printCountLabel(n: number): string {
  if (!n) return "Ещё не печатали";
  const a = n % 10;
  const b = n % 100;
  return `Печатали ${n} ${a >= 2 && a <= 4 && (b < 12 || b > 14) ? "раза" : "раз"}`;
}
