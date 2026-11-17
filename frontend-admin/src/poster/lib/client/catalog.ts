// Каталог sixth-cup для конструктора: товары с размерами и ценами, виды молока. Грузится один раз
// на вкладку и обновляется, когда вкладка снова становится видимой (цены могли поменять в админке).
import { useEffect, useSyncExternalStore } from "react";
import type { Catalog } from "@/lib/catalog";
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
