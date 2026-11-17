// Превью отправок для списка в «Почте»: копии отправленных листов и начало письма.
// Грузятся только для строк, которые видно на экране, пачками до 20 (GET /poster/sends/previews),
// и запоминаются на вкладку — отправленное не меняется.
import { useEffect, useSyncExternalStore } from "react";
import type { SendPreview } from "@/lib/sends";
import { posterFetch } from "./api";

const cache = new Map<string, SendPreview>();
const queued = new Set<string>();
const loading = new Set<string>();
const subs = new Set<() => void>();
let version = 0;
let timer: number | undefined;

const BATCH = 20;

function request(id: string) {
  if (cache.has(id) || queued.has(id) || loading.has(id)) return;
  queued.add(id);
  timer ??= window.setTimeout(flush, 30); // строки, показавшиеся разом, — одним запросом
}

async function flush() {
  timer = undefined;
  const ids = [...queued].slice(0, BATCH);
  for (const id of ids) {
    queued.delete(id);
    loading.add(id);
  }
  if (queued.size) timer = window.setTimeout(flush, 0);
  try {
    const res = await posterFetch(`/sends/previews?ids=${ids.map(encodeURIComponent).join(",")}`);
    if (res.ok) for (const p of ((await res.json()) as { previews: SendPreview[] }).previews) cache.set(p.id, p);
  } catch {
    // нет сети — строка останется без превью; список от этого не ломается
  } finally {
    for (const id of ids) loading.delete(id);
    version++;
    subs.forEach((f) => f());
  }
}

/** Превью отправки; visible — строка на экране (тогда и только тогда превью запрашивается). */
export function useSendPreview(id: string, visible: boolean): SendPreview | undefined {
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => version,
  );
  useEffect(() => {
    if (visible) request(id);
  }, [id, visible]);
  return cache.get(id);
}
