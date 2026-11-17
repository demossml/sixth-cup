// Запросы конструктора к backend sixth-cup: /api/admin/poster/*, с токеном админки.
// Токен лежит там же, где его хранит админка (localStorage['admin_token']), — отдельного входа нет.

const API = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_URL ?? "";
const TOKEN_KEY = "admin_token";

export const adminToken = (): string => {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
};

/** Токена нет или он больше не подходит: конструктор показывает «Войдите в админку». */
export const AUTH_EVENT = "poster:auth";

export async function posterFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Admin-Token", adminToken());
  const res = await fetch(`${API}/api/admin/poster${path}`, { cache: "no-store", ...init, headers });
  if (res.status === 401 || res.status === 403) window.dispatchEvent(new Event(AUTH_EVENT));
  return res;
}
