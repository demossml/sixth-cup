// Конструктор «Меню и Ценники» — отдельная страница админки (/poster.html), открывается из меню
// админки в новой вкладке. Вход общий с админкой: токен из localStorage, без своего пароля.
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./components/App";
import { WorkspaceProvider } from "./components/WorkspaceProvider";
import { adminToken, AUTH_EVENT, posterFetch } from "./lib/client/api";
import type { Workspace } from "./lib/model";
import "./styles/icons.css";
import "./styles/globals.css";

type State = { kind: "loading" } | { kind: "auth" } | { kind: "error"; text: string } | { kind: "ready"; ws: Workspace };

function Root() {
  const [state, setState] = useState<State>(() => (adminToken() ? { kind: "loading" } : { kind: "auth" }));

  useEffect(() => {
    const onAuth = () => setState({ kind: "auth" });
    window.addEventListener(AUTH_EVENT, onAuth);
    return () => window.removeEventListener(AUTH_EVENT, onAuth);
  }, []);

  useEffect(() => {
    if (state.kind !== "loading") return;
    posterFetch("/workspace")
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) return; // AUTH_EVENT уже показал вход
        const data = (await res.json()) as { ws?: Workspace; error?: string };
        if (!res.ok || !data.ws) throw new Error(data.error || `Сервер ответил ${res.status}`);
        setState({ kind: "ready", ws: data.ws });
      })
      .catch((e: Error) => setState({ kind: "error", text: e.message }));
  }, [state.kind]);

  if (state.kind === "ready")
    return (
      <WorkspaceProvider initial={state.ws}>
        <App />
      </WorkspaceProvider>
    );
  return (
    <main className="poster-gate">
      {state.kind === "loading" && <p>Загружаю меню…</p>}
      {state.kind === "auth" && (
        <>
          <h1>Меню и ценники</h1>
          <p>Конструктор открывается из админки 6.7. Войдите в админку и откройте «Меню и Ценники» ещё раз.</p>
          <a className="btn primary" href="/">
            Войти в админку
          </a>
        </>
      )}
      {state.kind === "error" && (
        <>
          <h1>Не удалось загрузить</h1>
          <p>{state.text}</p>
          <button className="btn primary" type="button" onClick={() => setState({ kind: "loading" })}>
            Повторить
          </button>
        </>
      )}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
