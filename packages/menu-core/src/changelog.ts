import type { ChangeEntry } from "./model";

export const LOG_LIMIT = 1000;
const MERGE_MS = 3 * 60 * 1000;
const CHANGE = /^(.*): (.*) → (.*)$/;

/**
 * Набор цены по цифрам даёт серию правок «350 → 3», «3 → 36», «36 → 360».
 * Склеиваем их в одну строку «350 → 360», а правку туда-обратно убираем совсем.
 */
export function coalesce(log: ChangeEntry[], entries: ChangeEntry[]): ChangeEntry[] {
  const out = [...log];
  for (const e of entries) {
    const m = CHANGE.exec(e.text);
    if (m) {
      let idx = -1;
      for (let i = out.length - 1; i >= 0 && Date.parse(e.at) - Date.parse(out[i].at) < MERGE_MS; i--) {
        const pm = CHANGE.exec(out[i].text);
        if (pm && pm[1] === m[1]) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        const from = CHANGE.exec(out[idx].text)![2];
        out.splice(idx, 1);
        if (from !== m[3]) out.push({ at: e.at, text: `${m[1]}: ${from} → ${m[3]}` });
        continue;
      }
    }
    out.push(e);
  }
  return out;
}
