
import { useEffect, useMemo, useState } from "react";
import { printStatus } from "@/lib/fingerprint";
import { CafeProvider, CafeSwitcher, useCafe } from "./cafe";
import { Home } from "./Home";
import { Mail } from "./Mail";
import { Menus } from "./Menus";
import { Tags } from "./Tags";
import { Icon, Logo, Toast } from "./ui";
import { useWs } from "./WorkspaceProvider";

type Section = "home" | "menu" | "tags" | "mail";
const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "home", label: "Главная", icon: "home" },
  { id: "menu", label: "Меню", icon: "menu" },
  { id: "tags", label: "Ценники", icon: "tag" },
  { id: "mail", label: "Почта", icon: "send" },
];
const LEGACY: Record<string, Section> = { send: "home", docs: "tags" };

/** Адрес внутри приложения: #menu/<id>/edit → ["menu", id, "edit"]. */
function useRoute(): [string[], (path: string) => void] {
  const [route, setRoute] = useState<string[]>(["home"]);
  useEffect(() => {
    const read = () => {
      const parts = location.hash
        .replace(/^#\/?/, "")
        .split("/")
        .filter(Boolean);
      const s = LEGACY[parts[0]] ?? parts[0];
      setRoute(
        SECTIONS.some((x) => x.id === s) ? [s, ...parts.slice(1)] : ["home"],
      );
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return [route, (p) => (location.hash = p)];
}

const SAVE_LABEL = {
  idle: "",
  pending: "Изменено…",
  saving: "Сохраняю…",
  saved: "Сохранено",
  error: "Не сохранено",
  conflict: "Конфликт",
} as const;

export function App() {
  return (
    <CafeProvider>
      <Shell />
    </CafeProvider>
  );
}

function Shell() {
  const { ws, saveState, saveError, reload, undo } = useWs();
  const [route, go] = useRoute();
  const section = route[0] as Section;
  const { cafes } = useCafe();
  const pending = useMemo(
    () =>
      ws.documents.filter(
        (d) =>
          cafes.some((c) => c.id === d.cafeId) &&
          printStatus(ws, d) === "pending",
      ).length,
    [ws, cafes],
  );
  const path = route.join("/");
  // редактор меню — во всё окно, без шапки и нижних вкладок: выход и сохранение у него в панели
  const full = section === "menu" && route[2] === "edit";
  // список меню — на сером поле, как лист в просмотре: белые только сами листы
  const grey = section === "menu" && route[2] !== "edit";
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  const nav = (cls: string) =>
    SECTIONS.map((s) => (
      <a
        key={s.id}
        href={`#${s.id}`}
        className={section === s.id ? "active" : ""}
        aria-current={section === s.id ? "page" : undefined}
      >
        {cls === "tabbar" && <Icon name={s.icon} size={22} />}
        <span>{s.label}</span>
        {s.id === "home" && pending > 0 && (
          <span className="badge" aria-label={`ожидают печати: ${pending}`}>
            {pending}
          </span>
        )}
      </a>
    ));

  return (
    <div className={`app ${full ? "app-full" : ""} ${grey ? "app-grey" : ""}`}>
      {!full && (
        <header className="topbar">
          <a className="brand" href="#home" aria-label="Главная">
            <Logo height={36} />
          </a>
          <nav className="tabs-top" aria-label="Разделы">
            {nav("top")}
          </nav>
          <div className={`save-state ${saveState}`} aria-live="polite">
            {SAVE_LABEL[saveState]}
          </div>
          <CafeSwitcher />
        </header>
      )}

      {saveError && (
        <div
          className={`banner ${saveState === "conflict" ? "danger" : "warn"}`}
          role="alert"
        >
          <span>{saveError}</span>
          {saveState === "conflict" && (
            <button className="btn small" onClick={() => void reload()}>
              Загрузить свежую
            </button>
          )}
        </div>
      )}

      <main className={`content ${full ? "full" : ""}`}>
        {/* смена раздела — мягкое появление (только прозрачность: сдвиг сломал бы fixed-окна внутри) */}
        <div key={section} className="section-in">
          {section === "home" && <Home />}
          {section === "menu" && <Menus route={route} go={go} />}
          {section === "tags" && <Tags />}
          {section === "mail" && <Mail route={route} />}
        </div>
      </main>

      {!full && (
        <nav className="tabbar" aria-label="Разделы">
          {nav("tabbar")}
        </nav>
      )}

      {undo && (
        <Toast>
          <span>{undo.label}</span>
          <button className="btn small light" onClick={undo.run}>
            Отменить
          </button>
        </Toast>
      )}
    </div>
  );
}
