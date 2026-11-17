// Почта конструктора: состояние подключения (без пароля), сохранение, проверка.
// Одно состояние на вкладку — его видят и блок на главной, и раздел «Почта».
import { useEffect, useSyncExternalStore } from "react";
import { posterFetch } from "./api";

export interface MailState {
  configured: boolean;
  source: "settings" | "env" | null;
  host: string;
  port: number;
  user: string;
  from: string | null;
  fromName: string;
  hasPassword: boolean;
  updatedAt: number | null;
}

export interface MailForm {
  host: string;
  port: number;
  user: string;
  pass: string; // пусто — оставить сохранённый
  from: string;
  fromName: string;
}

let state: MailState | null = null;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();
const set = (next: MailState) => {
  state = next;
  subs.forEach((f) => f());
};

async function json<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Сервер ответил ${res.status}`);
  return data;
}

export function refreshMail(): Promise<void> {
  loading ??= posterFetch("/mail")
    .then((r) => json<MailState>(r))
    .then(set)
    .catch(() => undefined)
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function useMail(): MailState | null {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
  useEffect(() => {
    if (!state) void refreshMail();
  }, []);
  return s;
}

const body = (form: MailForm) => JSON.stringify({ ...form, pass: form.pass || undefined, from: form.from || undefined, fromName: form.fromName || undefined });

export async function saveMail(form: MailForm): Promise<MailState> {
  const next = await json<MailState>(await posterFetch("/mail", { method: "PUT", headers: { "Content-Type": "application/json" }, body: body(form) }));
  set(next);
  return next;
}

export async function disconnectMail(): Promise<MailState> {
  const next = await json<MailState>(await posterFetch("/mail", { method: "DELETE" }));
  set(next);
  return next;
}

/** Проверить подключение с данными формы; с адресом to — ещё и прислать тестовое письмо. */
export async function testMail(form: MailForm, to?: string): Promise<{ ok: boolean; error?: string; sent?: boolean }> {
  const payload = JSON.parse(body(form)) as Record<string, unknown>;
  if (to) payload.to = to;
  return json(await posterFetch("/mail/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
}
