import { lazy, Suspense, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Qr from '../components/Qr'
import { api, setJwt, unwrap } from '../api'
import { ensureGuest, restoreAccount } from '../lib/ensureGuest'
import { clearInvite } from '../lib/invite'
import { formatRub } from '../lib/money'
import { useApp } from '../lib/app'
import { formatCardCode } from '../lib/card'
import { clearUserData } from '../lib/db'
import { syncStatus } from '../lib/syncStatus'
import { ArrowLeft, Camera, Copy, Download, LogOut, RefreshCw, Users, Wallet } from '../lib/icons'

const ScanModal = lazy(() => import('../components/ScanModal'))

type ResetStep = 'none' | 'offer' | 'final'

/**
 * Профиль и восстановление. Порядок защиты от потери карты:
 * код восстановления → (если не сохранён) предложение сохранить перед сбросом → двойное подтверждение.
 */
export default function ProfilePage() {
  const [fav, setFav] = useState(() => { try { return localStorage.getItem('sc-favorite-drink') || '' } catch { return '' } })
  const saveFav = () => { try { localStorage.setItem('sc-favorite-drink', fav); } catch {} }

  const { me, lastSync, syncing, sync, reload } = useApp()
  const nav = useNavigate()
  const [recovery, setRecovery] = useState('')
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreText, setRestoreText] = useState('')
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null)
  const [scan, setScan] = useState(false)
  const [resetStep, setResetStep] = useState<ResetStep>('none')
  const [busy, setBusy] = useState(false)
  const saved = (() => { try { return localStorage.getItem('sc-saved') === '1' } catch { return false } })()
  const status = syncStatus({ online: typeof navigator === 'undefined' ? true : navigator.onLine, syncing, lastSync })

  async function makeRecovery() {
    setBusy(true); setNote(null)
    try {
      const r = await unwrap(api.api.auth.recovery.$post()) as { recovery: string }
      setRecovery(r.recovery)
      try { localStorage.setItem('sc-saved', '1') } catch { /* private mode */ }
    } catch {
      setNote({ text: 'Нужен интернет, чтобы создать код восстановления.', ok: false })
    } finally { setBusy(false) }
  }

  async function copyRecovery() {
    try { await navigator.clipboard.writeText(recovery); setNote({ text: 'Код скопирован.', ok: true }) }
    catch { setNote({ text: 'Не удалось скопировать — сохраните QR картинкой.', ok: false }) }
  }

  async function downloadRecovery() {
    const QRCode = (await import('qrcode')).default
    const url = await QRCode.toDataURL(recovery, { errorCorrectionLevel: 'M', margin: 3, width: 480 })
    const a = document.createElement('a')
    a.href = url; a.download = '6-7-coffee-account.png'; a.click()
  }

  async function doRestore(code: string) {
    setScan(false)
    const value = code.trim()
    if (!value) { setNote({ text: 'Вставьте код или отсканируйте QR восстановления.', ok: false }); return }
    setBusy(true)
    try {
      if (await restoreAccount(value)) {
        try { localStorage.setItem('sc-saved', '1') } catch { /* private mode */ }
        await clearUserData()
        await reload(); await sync(); nav('/')
      } else setNote({ text: 'Не удалось восстановить: код неверный или нет сети.', ok: false })
    } finally { setBusy(false) }
  }

  async function doReset() {
    setResetStep('none')
    setJwt(null)
    clearInvite() // осознанно сброшенная карта начинается с нуля: прежний реферер не тянем
    await clearUserData()
    try { localStorage.removeItem('sc-guest-nonce'); localStorage.removeItem('sc-saved') } catch { /* private mode */ }
    await ensureGuest()
    await reload()
    nav('/')
  }

  return (
    <div className="pb-6">
      <div className="hero text-white px-4 pb-5 rounded-b-3xl" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <button type="button" className="inline-flex items-center gap-1 min-h-11 text-white/90 text-sm" onClick={() => nav('/more')}>
          <ArrowLeft size={18} /> Ещё
        </button>
        <h1 className="text-[22px] leading-7 font-semibold">{me?.nickname ?? 'Профиль'}</h1>
        <p className="text-white/80 text-xs mt-1">{status.label}{status.detail ? ` · ${status.detail}` : ''}</p>
        {me && me.cashbackBalance > 0 && (
          <div className="mt-3 inline-flex items-center gap-2 bg-white/15 rounded-xl px-3 py-2">
            <Wallet size={16} />
            <span className="text-sm font-semibold tabular-nums">Кэшбэк {formatRub(me.cashbackBalance)} ₽</span>
          </div>
        )}
        {me?.cardCode && (
          <div className="mt-3 rounded-xl bg-white/10 px-3 py-2">
            <div className="text-white/80 text-xs">Номер карты</div>
            <div className="font-display text-[28px] leading-9 font-semibold tracking-[0.12em] num">{formatCardCode(me.cardCode)}</div>
          </div>
        )}
      </div>

      <div className="px-4 pt-4 space-y-3">
        {note && <p className={`text-sm ${note.ok ? 'text-ok' : 'text-bad'}`}>{note.text}</p>}

        <section className="card !mb-0 space-y-2">
          <h2 className="text-base font-semibold text-ink">Сохранить карту</h2>
          <p className="text-sm text-ink-secondary">
            Код восстановления вернёт стаканы и кэшбэк, если телефон потеряется или приложение удалится. Храните его отдельно от телефона.
          </p>
          {!recovery ? (
            <button type="button" className="btn min-h-12" disabled={busy || !me} onClick={() => void makeRecovery()}>
              {saved ? 'Показать код восстановления снова' : 'Создать код восстановления'}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="bg-white rounded-xl border border-line p-2"><Qr value={recovery} size={240} alt="QR восстановления карты" /></div>
              <p className="text-[11px] text-ink-secondary break-all font-mono select-all">{recovery}</p>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost min-h-12 flex items-center justify-center gap-2" onClick={() => void copyRecovery()}><Copy size={16} /> Копировать</button>
                <button type="button" className="btn-ghost min-h-12 flex items-center justify-center gap-2" onClick={() => void downloadRecovery()}><Download size={16} /> Скачать QR</button>
              </div>
              <p className="text-xs text-ink-secondary">Не показывайте этот код кассиру и друзьям — он даёт доступ к карте.</p>
            </div>
          )}
        </section>

        <section className="card !mb-0 space-y-2">
          <h2 className="text-base font-semibold text-ink">Восстановить карту</h2>
          {!restoreOpen ? (
            <button type="button" className="btn-ghost min-h-12" onClick={() => setRestoreOpen(true)}>Ввести код восстановления</button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-ink-secondary">Текущая карта на этом телефоне будет заменена восстановленной.</p>
              <textarea
                className="input !mb-0 min-h-24 font-mono text-xs"
                placeholder="Вставьте код восстановления"
                value={restoreText}
                onChange={(e) => setRestoreText(e.target.value)}
              />
              <div className="flex gap-2">
                <button type="button" className="btn-ghost min-h-12 flex items-center justify-center gap-2" onClick={() => setScan(true)}><Camera size={16} /> Сканировать</button>
                <button type="button" className="btn min-h-12" disabled={busy} onClick={() => void doRestore(restoreText)}>Восстановить</button>
              </div>
            </div>
          )}
        </section>

        <button type="button" className="btn-ghost min-h-12 flex items-center justify-center gap-2" disabled={syncing} onClick={() => void sync()}>
          <RefreshCw size={16} className={syncing ? 'animate-spin motion-reduce:animate-none' : ''} /> Синхронизировать
        </button>
        <button type="button" className="btn-ghost min-h-12 flex items-center justify-center gap-2" onClick={() => nav('/invite')}>
          <Users size={16} /> Пригласить друга
        </button>

        <button type="button" className="btn-danger min-h-12 mt-6 flex items-center justify-center gap-2" onClick={() => setResetStep(saved ? 'final' : 'offer')}>
          <LogOut size={16} /> Сбросить карту на этом телефоне
        </button>
      </div>

      {resetStep !== 'none' && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end justify-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-[480px] bg-white rounded-t-3xl p-5 space-y-3" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
            {resetStep === 'offer' ? (
              <>
                <h2 className="text-lg font-bold text-ink">Сначала сохраните карту</h2>
                <p className="text-sm text-ink-secondary">Код восстановления не создан. После сброса стаканы и кэшбэк станут недоступны.</p>
                <button type="button" className="btn min-h-12" onClick={() => { setResetStep('none'); void makeRecovery() }}>Создать код восстановления</button>
                <button type="button" className="btn-danger min-h-12" onClick={() => setResetStep('final')}>Всё равно сбросить</button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-ink">Создать новую пустую карту?</h2>
                <p className="text-sm text-ink-secondary">Текущая карта на этом телефоне будет удалена.</p>
                <button type="button" className="btn-danger min-h-12" onClick={() => void doReset()}>Да, сбросить</button>
              </>
            )}
            <button type="button" className="btn-ghost min-h-12" onClick={() => setResetStep('none')}>Отмена</button>
          </div>
        </div>
      )}

      {scan && (
        <Suspense fallback={null}>
          <ScanModal title="Отсканируйте QR восстановления" onResult={(t) => void doRestore(t)} onClose={() => setScan(false)} />
        </Suspense>
      )}
    
      <div className="mt-4 p-4 rounded-2xl bg-white border border-line">
        <div className="text-[15px] font-semibold text-ink mb-1">Обычный заказ (заметка)</div>
        <p className="text-[12px] text-ink-secondary mb-2">Только для вас, не передаётся на кассу и не является заказом.</p>
        <input
          className="w-full border border-line rounded-xl px-3 py-2 text-[15px]"
          value={fav}
          onChange={(e) => setFav(e.target.value)}
          onBlur={saveFav}
          placeholder="Например: капучино, овсяное"
        />
      </div>
</div>
  )
}
