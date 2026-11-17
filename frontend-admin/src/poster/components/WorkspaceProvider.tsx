import { posterFetch } from "@/lib/client/api";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { loadFontBook, type FontBook } from "@/lib/fonts";
import type { Workspace } from "@/lib/model";

type SaveState = "idle" | "pending" | "saving" | "saved" | "error" | "conflict";

interface Ctx {
  ws: Workspace;
  fb: FontBook | null;
  saveState: SaveState;
  saveError: string | null;
  /** Правка: функция получает черновик-копию и меняет его. Сохранение — автоматически. */
  update: (fn: (draft: Workspace) => void) => void;
  /** Заменить состояние ответом сервера (после отправки). */
  replace: (ws: Workspace) => void;
  reload: () => Promise<void>;
  undo: { label: string; run: () => void } | null;
  offerUndo: (label: string, before: Workspace) => void;
}

const WsContext = createContext<Ctx | null>(null);

export function useWs() {
  const c = useContext(WsContext);
  if (!c) throw new Error("useWs outside provider");
  return c;
}

export function WorkspaceProvider({ initial, children }: { initial: Workspace; children: ReactNode }) {
  const [ws, setWs] = useState(initial);
  const [fb, setFb] = useState<FontBook | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [undo, setUndo] = useState<Ctx["undo"]>(null);
  const wsRef = useRef(ws);
  const baseRev = useRef(initial.rev);
  const saving = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadFontBook().then(setFb, (e) => setSaveError(String(e)));
  }, []);

  const commit = useCallback((next: Workspace) => {
    wsRef.current = next;
    setWs(next);
  }, []);

  const save = useCallback(async () => {
    if (saving.current) {
      again.current = true;
      return;
    }
    saving.current = true;
    setSaveState("saving");
    const snapshot = wsRef.current;
    try {
      const res = await posterFetch("/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: snapshot, baseRev: baseRev.current }),
      });
      const data = await res.json();
      if (res.status === 409) {
        setSaveState("conflict");
        setSaveError("Меню изменили на другом устройстве. Загрузите свежую версию — ваши последние правки не сохранились.");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Ошибка сохранения");
      const server = data.ws as Workspace;
      baseRev.current = server.rev;
      if (wsRef.current === snapshot) commit(server);
      else {
        // за время сохранения успели ещё поправить — оставляем правки, подтягиваем серверные поля
        const cur = wsRef.current;
        commit({
          ...cur,
          rev: server.rev,
          changeLog: server.changeLog,
          sends: server.sends,
          documents: cur.documents.map((d) => ({ ...d, lastSent: server.documents.find((x) => x.id === d.id)?.lastSent })),
        });
        again.current = true;
      }
      setSaveState("saved");
      setSaveError(null);
    } catch (e) {
      setSaveState("error");
      setSaveError((e as Error).message + ". Повторю через 5 секунд.");
      setTimeout(() => void save(), 5000);
    } finally {
      saving.current = false;
      if (again.current) {
        again.current = false;
        void save();
      }
    }
  }, [commit]);

  const update = useCallback(
    (fn: (draft: Workspace) => void) => {
      const draft = structuredClone(wsRef.current);
      fn(draft);
      commit(draft);
      setSaveState("pending");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void save();
      }, 700);
    },
    [commit, save],
  );

  const replace = useCallback(
    (next: Workspace) => {
      baseRev.current = next.rev;
      commit(next);
    },
    [commit],
  );

  const reload = useCallback(async () => {
    const res = await posterFetch("/workspace");
    const data = await res.json();
    replace(data.ws);
    setSaveState("idle");
    setSaveError(null);
  }, [replace]);

  // подтянуть чужие правки, когда вкладка снова активна и своих несохранённых нет
  useEffect(() => {
    const onFocus = () => {
      if (!saving.current && !timer.current && saveState !== "pending") {
        posterFetch("/workspace")
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d?.ws && d.ws.rev > baseRev.current) replace(d.ws);
          })
          .catch(() => {});
      }
    };
    const onVis = () => document.visibilityState === "visible" && onFocus();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [replace, saveState]);

  // предупредить о несохранённом при закрытии
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (saveState === "pending" || saveState === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [saveState]);

  const offerUndo = useCallback(
    (label: string, before: Workspace) => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndo({
        label,
        run: () => {
          setUndo(null);
          update((d) => {
            const keepRev = d.rev;
            Object.assign(d, structuredClone(before), { rev: keepRev, changeLog: d.changeLog, sends: d.sends });
          });
        },
      });
      undoTimer.current = setTimeout(() => setUndo(null), 7000);
    },
    [update],
  );

  return (
    <WsContext.Provider value={{ ws, fb, saveState, saveError, update, replace, reload, undo, offerUndo }}>{children}</WsContext.Provider>
  );
}
