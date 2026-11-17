import type { FontBook } from "./fonts";
import { layoutMenu } from "./layout/menu";
import type { Scene } from "./layout/scene";
import { layoutTag } from "./layout/tag";
import type { Doc, Group, Price, Variation, Workspace } from "./model";

// «Было»: вёрстка того, что ушло в печать в прошлый раз. Копия — это renderInput документа
// на момент отправки (см. sentMark), из неё собирается временное меню и верстается тем же движком.

type MenuSnap = {
  kind: "menu";
  size: { w: number; h: number };
  brand: { accent: string; note: string; allergen: string };
  groups: { t: string; s: Group["style"]; c: string[]; i: { n: string; a: boolean; o: string; p: Price[]; v: { l: [string, boolean, string][]; p: Price[] }[] }[] }[];
};
type TagSnap = {
  kind: "tag";
  size: { w: number; h: number };
  accent: string;
  name: string;
  price: Price;
  volume: string;
  info: { date: string; maker: string } | null;
};

const emptyWs = (accent: string): Workspace => ({
  rev: 0,
  brand: { accent, priceNote: "", allergenNote: "", maker: "" },
  cafes: [],
  groups: [],
  documents: [],
  contacts: [],
  sends: [],
  changeLog: [],
});

/** Сцена отправленной версии документа или null, если копии нет (отправляли до того, как их начали хранить). */
export function layoutSent(doc: Doc, fb: FontBook): Scene | null {
  return layoutSnap(doc.lastSent?.snap, doc.name, fb);
}

/** Сцена любой сохранённой копии (renderInput на момент отправки) — для истории отправок. */
export function layoutSnap(raw: unknown, name: string, fb: FontBook): Scene | null {
  const snap = raw as MenuSnap | TagSnap | undefined;
  if (!snap || typeof snap !== "object") return null;
  try {
    if (snap.kind === "menu") {
      const ws = emptyWs(snap.brand.accent);
      ws.brand.priceNote = snap.brand.note;
      ws.brand.allergenNote = snap.brand.allergen;
      ws.groups = snap.groups.map((g, gi) => ({
        id: `g${gi}`,
        title: g.t,
        style: g.s,
        columns: g.c,
        items: g.i.map((it, ii) => ({
          id: `i${gi}.${ii}`,
          name: it.n,
          allergen: it.a || undefined,
          note: it.o || undefined,
          prices: it.p,
          variations: it.v.flatMap((b, bi) =>
            b.l.map(([name, allergen, note], li): Variation => ({ id: `v${gi}.${ii}.${bi}.${li}`, name, allergen: allergen || undefined, note: note || undefined, prices: b.p, ...(li > 0 ? { sharePrice: true } : {}) })),
          ),
        })),
      }));
      return layoutMenu(ws, { id: "sent", kind: "menu", cafeId: "", name, size: snap.size, groupIds: ws.groups.map((g) => g.id), createdAt: "" }, fb);
    }
    if (snap.kind === "tag") {
      const ws = emptyWs(snap.accent);
      return layoutTag(
        ws,
        { id: "sent", kind: "tag", cafeId: "", name, size: snap.size, showInfo: !!snap.info, date: snap.info?.date || undefined, maker: snap.info?.maker, createdAt: "" },
        fb,
        { name: snap.name, price: snap.price, volume: snap.volume || undefined, broken: false },
      );
    }
  } catch {
    /* копия от старой версии с другой структурой — считаем, что её нет */
  }
  return null;
}

/**
 * Что отличается между двумя версиями листа: номера надписей сцены `scene`, которых нет в `other`.
 * Надписи сравниваются по порядку на листе (наибольшая общая подпоследовательность), а не по месту:
 * строка, сдвинувшаяся вниз из-за новой позиции, не подсвечивается, а новая строка подсвечивается целиком,
 * даже если такая же цена есть где-то ещё.
 */
export function changedTexts(scene: Scene, other: Scene): Set<number> {
  const a = scene.els.map((e, i) => ({ e, i })).filter((x) => x.e.kind === "text");
  const b = other.els.filter((e) => e.kind === "text");
  const key = (e: Scene["els"][number]) => (e.kind === "text" ? `${e.text}\u0000${e.color}` : "");
  const A = a.map((x) => key(x.e));
  const B = b.map(key);
  const n = A.length;
  const m = B.length;
  // lcs[i][j] — длина общей подпоследовательности хвостов A[i:] и B[j:]
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = A[i] === B[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < n) {
    if (j < m && A[i] === B[j]) {
      i++;
      j++;
    } else if (j < m && lcs[i][j + 1] >= lcs[i + 1][j]) j++;
    else out.add(a[i++].i);
  }
  return out;
}
