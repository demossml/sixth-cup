/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { makeFontBook, WEIGHTS } from "@/lib/fonts";
import type { Weight } from "@/lib/layout/scene";

export function nodeFontBook() {
  const bytes = Object.fromEntries(
    WEIGHTS.map((w) => [w, new Uint8Array(fs.readFileSync(path.join(__dirname, "..", "..", "..", "public", "poster", "fonts", `InterDisplay-${w}.ttf`)))]),
  ) as Record<Weight, Uint8Array>;
  return makeFontBook(bytes);
}
