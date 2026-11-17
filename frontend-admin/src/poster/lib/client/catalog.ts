// Каталог sixth-cup для конструктора: товары с размерами и ценами, виды молока. Грузится один раз
// на вкладку и обновляется, когда вкладка снова становится видимой (цены могли поменять в админке).
import { useEffect, useSyncExternalStore } from "react";
import type { Catalog, CatalogPriceKey } from "@/lib/catalog";
import { posterFetch } from "./api";

type State = { catalog: Catalog | null; error: string | null };

let state: State = { catalog: null, error: null };
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();
const set = (next: State) => {
  state = next;
  subs.forEach((f) => f());
};

export function refreshCatalog(): Promise<void> {
  loading ??= posterFetch("/catalog")
    .then(async (res) => {
      if (!res.ok) throw new Error(`база товаров не ответила (${res.status})`);
      set({ catalog: (await res.json()) as Catalog, error: null });
    })
    .catch((e: Error) => set({ ...state, error: e.message }))
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function useCatalog(): State {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
  useEffect(() => {
    if (!state.catalog) void refreshCatalog();
    const onVis = () => document.visibilityState === "visible" && void refreshCatalog();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return s;
}

/**
 * «Обновить в базе тоже»: записать цены в товары базы. При успехе каталог сразу обновляется
 * (новые цены и даты); строку меню редактор меняет сам. Ошибка — с текстом для пользователя.
 */
export async function updateCatalogPrices(updates: (CatalogPriceKey & { price: number })[]): Promise<void> {
  const res = await posterFetch("/catalog/prices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  });
  const body = (await res.json().catch(() => ({}))) as { catalog?: Catalog; error?: string };
  if (!res.ok || !body.catalog) {
    throw new Error(res.status === 403 ? "Недостаточно прав, чтобы менять цены в базе" : body.error || `База не ответила (${res.status})`);
  }
  set({ catalog: body.catalog, error: null });
}
