import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearInviteNotice, getInviteNotice, type InviteNotice as Notice } from '../lib/invite'
import { resetCardWithInvite } from '../lib/ensureGuest'
import { useApp } from '../lib/app'
import { Gift, RefreshCw } from '../lib/icons'

/**
 * Плашка про приглашение, которое не удалось применить. Приглашение привязывается только
 * при создании карты, поэтому у существующей карты есть лишь два честных исхода:
 * объяснить это или осознанно начать новую карту по коду друга.
 */
export default function InviteNotice() {
  const { reload, sync } = useApp()
  const nav = useNavigate()
  const [notice, setNotice] = useState<Notice | null>(() => getInviteNotice())
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!notice) return null

  const dismiss = () => {
    clearInviteNotice()
    setNotice(null)
  }

  async function startOver() {
    if (!notice) return
    setBusy(true)
    setError(null)
    const result = await resetCardWithInvite(notice.code)
    setBusy(false)
    if (result === 'ok') {
      clearInviteNotice()
      setNotice(null)
      await reload()
      await sync()
      nav('/', { replace: true })
      return
    }
    setConfirm(false)
    setError(
      result === 'invalid_invite' ? 'Код приглашения не найден. Возьмите новую ссылку у друга.'
        : result === 'rate_limited' ? 'Слишком много попыток с этого адреса. Попробуйте позже.'
          : 'Нет сети — попробуйте ещё раз, когда появится интернет.',
    )
  }

  return (
    <div className="bg-white border border-line rounded-2xl shadow-card p-3.5" role="status">
      <div className="flex items-start gap-2.5">
        <span className="w-8 h-8 rounded-full bg-pale text-brand flex items-center justify-center shrink-0" aria-hidden="true">
          <Gift size={16} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-5 font-semibold text-ink">
            {notice.kind === 'ignored' ? 'Вы открыли приглашение друга' : 'Код приглашения не принят'}
          </p>
          <p className="mt-0.5 text-[12px] leading-4 text-ink-secondary">
            {notice.kind === 'ignored'
              ? 'Но у вас уже есть карта, а бонус за приглашение начисляется только новым гостям. Старую карту не меняем.'
              : 'Возможно, ссылка устарела. Карта создана без приглашения — всё остальное работает как обычно.'}
          </p>

          {error && <p className="mt-1.5 text-[12px] leading-4 text-bad">{error}</p>}

          {notice.kind === 'ignored' && confirm && (
            <p className="mt-2 text-[12px] leading-4 text-bad">
              Новая карта начнётся с нуля: стаканы, кэшбэк и история текущей карты останутся в прошлом аккаунте.
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            {notice.kind === 'ignored' && !confirm && (
              <button
                type="button"
                className="text-[12px] leading-4 font-semibold rounded-full px-3 min-h-9 border border-line text-brand"
                onClick={() => setConfirm(true)}
              >
                Начать новую карту по приглашению
              </button>
            )}
            {confirm && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  className="text-[12px] leading-4 font-semibold rounded-full px-3 min-h-9 bg-bad text-white inline-flex items-center gap-1.5 disabled:opacity-60"
                  onClick={() => void startOver()}
                >
                  {busy ? <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" /> : null}
                  Да, сбросить карту
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="text-[12px] leading-4 font-semibold rounded-full px-3 min-h-9 border border-line text-ink-secondary"
                  onClick={() => setConfirm(false)}
                >
                  Отмена
                </button>
              </>
            )}
            <button
              type="button"
              className="text-[12px] leading-4 font-semibold rounded-full px-3 min-h-9 border border-line text-ink-secondary"
              onClick={dismiss}
            >
              Понятно
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
