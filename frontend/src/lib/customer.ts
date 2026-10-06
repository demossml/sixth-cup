import { api, unwrap } from '../api'
import { allReceipts, kvGet, kvSet, putReceipt } from './db'
import { refreshDirectory } from './directory'
import type { CardState, Directory, Me } from './types'
import { verifyProof, type Verified } from './proof'

export type Best = { state: CardState; token: string }

/**
 * Карта только из доказательства сервера (kv card), не из локальных чеков.
 * Начисления — строго после ответа backend.
 */
export async function computeBest(dir: Directory, me: Me): Promise<Best | null> {
  const card = await kvGet<string>('card')
  if (!card) return null
  const v = verifyProof(card, dir)
  if (!v || v.kind !== 'card' || v.payload.id !== me.cardId) return null
  return { state: v.payload, token: card }
}

/**
 * Скан QR чека кассы: проверка подписи → сразу на сервер.
 * Локально чек кладём в очередь только если сети нет.
 */
export async function submitScannedReceipt(
  token: string,
  dir: Directory | null,
  me: Me | null,
): Promise<{ ok: true; message: string } | { ok: false; reason: string }> {
  if (!dir || !me) {
    return { ok: false, reason: 'Нужен интернет один раз, чтобы открыть карту.' }
  }
  const v = verifyProof(token, dir)
  if (!v || v.kind !== 'receipt') {
    return {
      ok: false,
      reason: 'Это не QR чека кассы 6.7 Coffee. Покажите карту кассиру или отсканируйте QR с чека лояльности.',
    }
  }
  // receipt tokens carry the numeric user id internally; card QR itself never exposes it.
  if (v.payload.u !== me.id) {
    return { ok: false, reason: 'Этот чек относится к другой карте.' }
  }
  const receiptId = (v.payload as { r: string }).r

  try {
    const res = await unwrap(
      api.api.sync.$post({ json: { receipts: [token] } }),
    )
    await kvSet('card', res.card)
    await kvSet('me', res.me)
    await putReceipt({
      id: receiptId,
      token,
      uploaded: 1,
      userId: me.id,
      q: v.payload.q,
    })
    localStorage.setItem('sc-last-sync', String(Date.now()))
    const applied = res.result?.applied?.length ?? 0
    const dup = res.result?.duplicates?.length ?? 0
    if (applied > 0) {
      return { ok: true, message: 'Чек принят на сервере. Стаканы и кэшбэк обновлены.' }
    }
    if (dup > 0) {
      return { ok: true, message: 'Этот чек уже был учтён ранее. Карта синхронизирована.' }
    }
    return {
      ok: false,
      reason: 'Сервер не принял чек. Обновите меню по сети или обратитесь к бариста.',
    }
  } catch (e) {
    const m = (e as Error).message
    if (m === 'Unauthorized' || m === 'Invalid token') {
      return { ok: false, reason: 'Сессия устарела. Откройте приложение ещё раз.' }
    }
    // Офлайн: в очередь, начисление только после будущей синхронизации с сервером
    await putReceipt({
      id: receiptId,
      token,
      uploaded: 0,
      userId: me.id,
      q: v.payload.q,
    })
    return {
      ok: false,
      reason: 'Нет сети. Чек сохранён и будет отправлен на сервер при появлении интернета — начисление только после ответа сервера.',
    }
  }
}

export type SyncStatus = 'ok' | 'offline' | 'auth'

export async function syncCustomer(): Promise<SyncStatus> {
  const dir = await refreshDirectory()
  if (!dir) return 'offline'

  const pending = (await allReceipts()).filter((r) => !r.uploaded)
  try {
    const res = await unwrap(api.api.sync.$post({ json: { receipts: pending.map((r) => r.token) } }))
    await kvSet('card', res.card)
    await kvSet('me', res.me)
    const done = new Set([...(res.result.applied ?? []), ...(res.result.duplicates ?? [])])
    for (const r of pending) if (done.has(r.id)) await putReceipt({ ...r, uploaded: 1 })
    localStorage.setItem('sc-last-sync', String(Date.now()))
    return 'ok'
  } catch (e) {
    const m = (e as Error).message
    return m === 'Unauthorized' || m === 'Invalid token' ? 'auth' : 'offline'
  }
}
