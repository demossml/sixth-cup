
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { CAFE_NAME, addCafe, cafeLabel, type Cafe } from "@/lib/model";
import { Select } from "./Select";
import { Icon, Sheet } from "./ui";
import { useWs } from "./WorkspaceProvider";

// Кафе выбирается один раз в шапке — и меню, и ценники, и список на отправку показывают его.
// «Все кафе» показывает всё сразу, блоками по кафе. Выбор запоминается на устройстве:
// каждое кафе открывает конструктор уже на себе.

const KEY = "m67.cafe";
export const ALL = "all";
type CafeCtx = {
  /** Что выбрано в шапке: id кафе или ALL. */
  scope: string;
  setScope: (id: string) => void;
  /** Кафе, которые сейчас показываются: одно или все. */
  cafes: Cafe[];
  /** Кафе по умолчанию для нового документа: выбранное, а при «Все кафе» — первое. */
  cafeId: string;
  /** Старое имя setScope — переключить на кафе. */
  setCafeId: (id: string) => void;
};
const Ctx = createContext<CafeCtx | null>(null);

// Выбор хранится в браузере и читается до первой отрисовки на клиенте — без мигания «первое кафе → своё».
const subs = new Set<() => void>();
let saved: string | null | undefined;
const readSaved = () => {
  if (saved === undefined) {
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      saved = null;
    }
  }
  return saved;
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

export function CafeProvider({ children }: { children: ReactNode }) {
  const { ws } = useWs();
  const scope = useSyncExternalStore(subscribe, readSaved, () => null) ?? "";
  // кафе удалили на другом устройстве или оно осталось одно — показывать первое
  const valid = (scope === ALL && ws.cafes.length > 1) || ws.cafes.some((c) => c.id === scope) ? scope : (ws.cafes[0]?.id ?? "");
  const setScope = (id: string) => {
    saved = id;
    try {
      localStorage.setItem(KEY, id);
    } catch {}
    subs.forEach((f) => f());
  };
  const cafes = valid === ALL ? ws.cafes : ws.cafes.filter((c) => c.id === valid);
  return <Ctx.Provider value={{ scope: valid, setScope, cafes, cafeId: cafes[0]?.id ?? "", setCafeId: setScope }}>{children}</Ctx.Provider>;
}

export function useCafe() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCafe вне CafeProvider");
  return c;
}

/** Кафе двумя строками: общее название и под ним мелко адрес — по нему кафе и различают. */
export function CafeTitle({ cafe }: { cafe: Cafe }) {
  return (
    <span className="cafe-title">
      <b>{CAFE_NAME}</b>
      <small>{cafe.address.trim() || "адрес не указан"}</small>
    </span>
  );
}

/** Выбор кафе в шапке: справа вверху на всех страницах. */
export function CafeSwitcher() {
  const { ws } = useWs();
  const { scope, setScope, cafeId } = useCafe();
  const [sheet, setSheet] = useState<"new" | "edit" | null>(null);
  const current = ws.cafes.find((c) => c.id === scope);
  return (
    <>
      <Select
        variant="title"
        align="right"
        className="cafe-switch"
        label="Кафе"
        value={scope}
        display={scope === ALL || !current ? <span className="cafe-name">Все кафе</span> : <CafeTitle cafe={current} />}
        onChange={(v) => {
          if (v === "+new") setSheet("new");
          else if (v === "+edit") setSheet("edit");
          else setScope(v);
        }}
        options={[
          ...(ws.cafes.length > 1 ? [{ value: ALL, label: "Все кафе" }] : []),
          ...ws.cafes.map((c) => ({ value: c.id, label: CAFE_NAME, sub: c.address.trim() || "адрес не указан" })),
          { sep: true as const },
          ...(scope !== ALL ? [{ value: "+edit", label: "Изменить адрес…", action: true }] : []),
          { value: "+new", label: "Добавить кафе…", action: true },
        ]}
      />
      {sheet && <CafeSheet mode={sheet} cafeId={cafeId} onClose={() => setSheet(null)} />}
    </>
  );
}

function CafeSheet({ mode, cafeId, onClose }: { mode: "new" | "edit"; cafeId: string; onClose: () => void }) {
  const { ws, update, offerUndo } = useWs();
  const { setCafeId } = useCafe();
  const cafe = ws.cafes.find((c) => c.id === cafeId);
  const [address, setAddress] = useState(mode === "edit" ? (cafe?.address ?? "") : "");
  const [copyFrom, setCopyFrom] = useState(mode === "new" ? cafeId : "");
  const docs = ws.documents.filter((d) => d.cafeId === cafeId).length;

  const save = () => {
    const a = address.trim();
    if (!a) return;
    if (mode === "new") {
      let id = "";
      update((w) => {
        id = addCafe(w, a, copyFrom || undefined);
      });
      setCafeId(id);
    } else update((w) => (w.cafes.find((c) => c.id === cafeId)!.address = a));
    onClose();
  };

  return (
    <Sheet
      title={mode === "new" ? "Новое кафе" : "Кафе"}
      onClose={onClose}
      footer={
        <button className="btn primary" disabled={!address.trim()} onClick={save}>
          {mode === "new" ? "Добавить" : "Сохранить"}
        </button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="field">
          <span>Улица и номер дома</span>
          <input className="text-input" autoFocus value={address} onChange={(e) => setAddress(e.target.value)} placeholder="ул. Ленина, 12" />
        </label>
        {mode === "new" && (
          <label className="field">
            <span>Меню и ценники</span>
            <Select
              value={copyFrom}
              onChange={setCopyFrom}
              options={[{ value: "", label: "Начать с пустого" }, ...ws.cafes.map((c) => ({ value: c.id, label: `Скопировать из «${cafeLabel(c)}»` }))]}
            />
            <span className="hint">Копия независима: цены в новом кафе можно менять, не трогая остальные.</span>
          </label>
        )}
      </form>
      {mode === "edit" && ws.cafes.length > 1 && (
        <button
          className="btn danger small"
          onClick={() => {
            offerUndo(`Кафе «${cafeLabel(cafe)}» удалено`, ws);
            update((w) => {
              const gone = w.documents.filter((d) => d.cafeId === cafeId);
              const groups = new Set(gone.flatMap((d) => (d.kind === "menu" ? d.groupIds : [])));
              w.documents = w.documents.filter((d) => d.cafeId !== cafeId);
              const used = new Set(w.documents.flatMap((d) => (d.kind === "menu" ? d.groupIds : [])));
              w.groups = w.groups.filter((g) => !groups.has(g.id) || used.has(g.id));
              w.cafes = w.cafes.filter((c) => c.id !== cafeId);
              for (const c of w.contacts) if (c.cafeIds) c.cafeIds = c.cafeIds.filter((id) => id !== cafeId);
            });
            setCafeId(ws.cafes.find((c) => c.id !== cafeId)!.id);
            onClose();
          }}
        >
          <Icon name="trash" size={16} /> Удалить кафе{docs ? ` и его документы (${docs})` : ""}
        </button>
      )}
    </Sheet>
  );
}
