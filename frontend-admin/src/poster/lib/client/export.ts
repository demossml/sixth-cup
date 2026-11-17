import { zipSync } from "fflate";
import { fingerprint } from "../fingerprint";
import type { FontBook } from "../fonts";
import { layoutMenu } from "../layout/menu";
import { layoutTag } from "../layout/tag";
import type { Scene } from "../layout/scene";
import { cafeLabel, sizeLabel, type Doc, type Workspace } from "../model";
import { sceneToPdf } from "../render/pdf";

export function layoutDoc(ws: Workspace, doc: Doc, fb: FontBook): Scene {
  return doc.kind === "menu" ? layoutMenu(ws, doc, fb) : layoutTag(ws, doc, fb);
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|«»]+/g, "").replace(/\s+/g, " ").trim() || "документ";

export function fileName(doc: Doc) {
  const kind = doc.kind === "menu" ? "Меню" : "Ценник";
  const name = safe(doc.name).replace(/\s*·\s*/g, " — ");
  const title = name.toLowerCase().startsWith(kind.toLowerCase()) ? name : `${kind} — ${name}`;
  return `${title} — ${sizeLabel(doc.size).replace("×", "x")}.pdf`;
}

export interface BuiltPdf {
  doc: Doc;
  file: string;
  bytes: Uint8Array;
  hash: string;
  warnings: string[];
}

export async function buildPdfs(ws: Workspace, docs: Doc[], fb: FontBook, print: boolean): Promise<BuiltPdf[]> {
  const used = new Map<string, number>();
  const out: BuiltPdf[] = [];
  // в архиве на несколько кафе у каждого своя папка — одноимённые листы не путаются
  const folders = new Set(docs.map((d) => d.cafeId)).size > 1;
  for (const doc of docs) {
    const scene = layoutDoc(ws, doc, fb);
    const folder = folders ? `${safe(cafeLabel(ws.cafes.find((c) => c.id === doc.cafeId)))}/` : "";
    let file = folder + fileName(doc);
    const n = used.get(file) ?? 0;
    used.set(file, n + 1);
    if (n) file = file.replace(/\.pdf$/, ` (${n + 1}).pdf`);
    const bytes = await sceneToPdf(scene, fb, { print, title: doc.name });
    out.push({ doc, file, bytes, hash: fingerprint(ws, doc), warnings: scene.warnings });
  }
  return out;
}

export function zipPdfs(pdfs: BuiltPdf[]): Uint8Array {
  // PDF уже сжаты внутри — повторное сжатие почти ничего не даёт, поэтому level 0 (быстро и на телефоне)
  return zipSync(Object.fromEntries(pdfs.map((p) => [p.file, [p.bytes, { level: 0 }]])), { level: 0 });
}

export function archiveName() {
  const d = new Date();
  const pad = (x: number) => String(x).padStart(2, "0");
  return `6.7 макеты ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.zip`;
}

export function downloadBytes(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
