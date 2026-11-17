// Подробности отправки в типографию: что именно ушло (копии документов на момент отправки),
// что в них изменилось с прошлой отправки и само письмо. Хранятся на сервере отдельно от документа
// конструктора (таблица poster_send_details) — копии листов большие, а нужны только в истории.

import type { DocChanges } from "./changes";
import type { ChangeEntry, Size } from "./model";

export interface SentDoc {
  id: string;
  kind: "menu" | "tag";
  name: string;
  size: Size;
  cafeId: string;
  file: string;
  hash: string;
  /** renderInput документа на момент отправки; нет — если версия клиента не совпала с серверной. */
  snap?: unknown;
  /** что изменилось по сравнению с прошлой отправкой этого документа */
  changes: DocChanges;
  /** прошлая отправка этого документа — для сравнения «Было / Отправлено» (заполняет сервер при чтении) */
  prev?: { sendId: string; at: string; snap?: unknown };
}

export interface SendDetails {
  id: string;
  at: string;
  method: "email" | "manual";
  to: string; // адрес или пометка «передано вручную»
  toName?: string;
  subject?: string;
  text?: string; // текст письма целиком
  message?: string; // комментарий, который написали в письме
  bytes: number;
  batch?: string;
  docs: SentDoc[];
  /** правки с прошлой отправки — то, что ушло в письме списком «Что изменилось» */
  log: ChangeEntry[];
  /** отправка сделана до того, как начали хранить подробности: часть сведений восстановлена */
  legacy?: boolean;
}

/** Превью отправки для строки списка (GET /poster/sends/previews): копии листов без прошлых версий и начало письма. */
export interface SendPreview {
  id: string;
  /** комментарий из письма, иначе начало текста письма; строки склеены в одну */
  snippet: string | null;
  docs: Pick<SentDoc, "id" | "kind" | "name" | "size" | "snap">[];
}
