import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import InstallBanner from '../components/InstallBanner'
import Qr from '../components/Qr'
import { useApp } from '../lib/app'
import { formatCardCode } from '../lib/card'
import { activeVouchers } from '../lib/proof'
import { formatRub } from '../lib/money'
import { cupsWord, friendsWord, progressPhrase } from '../lib/plural'
import { syncStatus } from '../lib/syncStatus'
import { useWakeLock } from '../lib/wakeLock'
import { Coffee, Gift, RefreshCw, Ticket, Users, Wallet, Wifi, WifiOff } from '../lib/icons'

/**
 * Главный экран: «открыл → понял → показал».
 * Сверху вниз: статус + кружки-штампы + одна фраза «что дальше» → QR и крупный номер карты →
 * кэшбэк одной строкой → (скроллом) приглашение, установка, купоны.
 * QR виден без единого тапа; fullscreen — только увеличение. Все цифры приходят с сервера.
 */
export default function CardPage() {
  const { dir, me, best, syncing, lastSync, sync } = useApp()
  const nav = useNavigate()
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const saved = (() => { try { return localStorage.getItem('sc-saved') === '1' } catch { return false } })()

  const N = Math.max(1, me?.cupsForFree ?? dir?.cupsForFree ?? 5)
  const hasNetwork = typeof navigator === 'undefined' ? true : navigator.onLine
  const status = syncStatus({ online: hasNetwork, syncing, lastSync })
  const paidProgress = Math.min(N, Math.max(0, me?.cupsTowardFree ?? 0))
  const freeLeft = me?.freeAvailable ?? 0
  const left = Math.max(0, N - paidProgress)
  const pct = dir?.referralCashbackPercent ?? 3
  const fromFriendsKop = me?.fromFriendsKopecks ?? (me?.fromFriendsRub ?? 0) * 100
  const vouchers = activeVouchers({ v: me?.vouchers ?? [] } as never)
  const proof = best?.token
  const cardCode = me?.cardCode ?? ''
  const hasGift = freeLeft > 0

  useWakeLock(!!proof)

  async function onSync() {
    setMsg(null)
    const result = await sync()
    if (result === 'auth') {
      const { ensureGuest } = await import('../lib/ensureGuest')
      const { setJwt } = await import('../api')
      setJwt(null)
      await ensureGuest()
      await sync()
      setMsg({ text: 'Выдана новая карта (без телефона).', ok: true })
    } else if (result === 'offline') {
      setMsg({ text: 'Нет сети. Если карта уже была — QR остаётся на экране.', ok: false })
    }
  }

  // Кружки: до 8 в ряд, больше — в два ряда (кружок масштабируется, не вылезает за экран).
  const slots = N + 1
  const cols = slots <= 8 ? slots : Math.ceil(slots / 2)

  const statusTone =
    status.kind === 'offline' ? 'bg-black/30' : status.kind === 'stale' ? 'bg-accent-orange/90' : 'bg-white/20'

  return (
    <div className="pb-4">
      <div className="bg-brand text-white px-4 pb-4" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-bold leading-tight">6.7 Coffee</h1>
          <button
            type="button"
            onClick={() => void onSync()}
            className={`inline-flex items-center gap-1.5 text-xs px-3 rounded-full min-h-11 ${statusTone}`}
            aria-label={`Обновить данные. ${status.label}`}
          >
            {hasNetwork ? <Wifi size={14} /> : <WifiOff size={14} />}
            {syncing ? <RefreshCw size={14} className="animate-spin motion-reduce:animate-none" /> : null}
            {status.label}
          </button>
        </div>

        <div role="img" aria-label={`Куплено ${paidProgress} из ${N} ${cupsWord(N)}${hasGift ? ', подарок доступен' : ''}`} className="mt-2">
          <div className="grid gap-x-1.5 gap-y-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: N }, (_, i) => {
              const filled = i < paidProgress
              return (
                <div key={i} className="flex flex-col items-center gap-0.5 min-w-0">
                  <div
                    className={`w-full max-w-[46px] aspect-square rounded-full flex items-center justify-center ${
                      filled ? 'bg-white text-brand' : 'bg-white/15 text-white/50 border border-white/35'
                    }`}
                  >
                    <Coffee size={20} strokeWidth={filled ? 2.4 : 1.6} />
                  </div>
                  <span className={`text-[11px] leading-none ${filled ? 'text-white' : 'text-white/60'}`}>{i + 1}</span>
                </div>
              )
            })}
            <div className="flex flex-col items-center gap-0.5 min-w-0">
              <div
                className={`w-full max-w-[46px] aspect-square rounded-full flex items-center justify-center ${
                  hasGift ? 'bg-accent-orange text-white ring-2 ring-white' : 'bg-white/15 text-white/60 border border-dashed border-white/50'
                }`}
              >
                <Gift size={20} strokeWidth={2} />
              </div>
              <span className={`text-[11px] leading-none ${hasGift ? 'text-white font-semibold' : 'text-white/70'}`}>в подарок</span>
            </div>
          </div>
        </div>

        <p
          className={`mt-3 text-center font-semibold leading-snug ${
            hasGift ? 'text-[17px] bg-accent-orange rounded-xl py-2 px-3' : 'text-base'
          }`}
        >
          {progressPhrase({ n: N, left, freeAvailable: freeLeft })}
        </p>
      </div>

      <div className="px-4 mt-3 space-y-2.5">
        {/* QR СРАЗУ — главный блок */}
        <div className="bg-white border border-line rounded-2xl shadow-card p-3">
          {!me && !proof ? (
            <div className="text-center py-8 space-y-3">
              <p className="text-sm text-ink-secondary">Нужен интернет один раз — карта и QR появятся сами.</p>
              <button type="button" className="btn min-h-12" onClick={() => void onSync()}>
                Получить карту
              </button>
            </div>
          ) : !proof ? (
            <div className="text-center py-6 space-y-3">
              <p className="text-sm text-ink-secondary">
                {hasNetwork ? 'QR нужно обновить.' : 'QR нужно обновить — подключитесь к сети.'}
              </p>
              <button type="button" className="btn-ghost min-h-12 inline-flex items-center justify-center gap-2" onClick={() => void onSync()}>
                <RefreshCw size={16} className={syncing ? 'animate-spin motion-reduce:animate-none' : ''} /> Обновить
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="w-full flex flex-col items-center bg-white rounded-xl active:opacity-90 motion-reduce:transition-none"
                onClick={() => nav('/card-qr')}
                aria-label="Увеличить QR на весь экран"
              >
                <p className="text-sm font-semibold text-ink-secondary mb-1">Покажите QR на кассе</p>
                <div className="w-full bg-white p-1 rounded-lg">
                  <Qr value={proof} size={300} alt="QR карты для кассы" />
                </div>
                <p className="mt-1.5 text-[34px] leading-none font-bold tracking-[0.18em] tabular-nums text-ink">
                  {formatCardCode(cardCode)}
                </p>
                <p className="text-xs text-ink-secondary mt-1.5">Не сканируется — назовите номер. Нажмите, чтобы увеличить</p>
              </button>
              {status.detail && status.kind !== 'fresh' && (
                <p className="text-center text-xs text-ink-secondary mt-2">{status.detail}</p>
              )}
            </>
          )}
        </div>

        {me && (
          <div className="card flex items-center gap-3 !py-2.5 !mb-0">
            <div className="w-10 h-10 rounded-xl bg-brand-soft flex items-center justify-center shrink-0">
              <Wallet size={20} className="text-brand" />
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold text-ink tabular-nums">Кэшбэк {formatRub(me.cashbackBalance)} ₽</div>
              <div className="text-xs text-ink-secondary">Списать можно только у бариста на кассе</div>
            </div>
          </div>
        )}

        {msg && <p className={`text-sm ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}

        {/* Вторичное — ниже QR */}
        <button
          type="button"
          onClick={() => nav('/invite')}
          className="card w-full text-left flex items-center gap-3 !py-2.5 !mb-0 min-h-14 active:bg-brand-soft/50"
        >
          <div className="w-10 h-10 rounded-xl bg-accent-orange/15 flex items-center justify-center shrink-0">
            <Users size={20} className="text-accent-orange" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink">Пригласить друга</div>
            <div className="text-xs text-ink-secondary">{pct}% с его покупок · ссылка для друга, не для кассы</div>
          </div>
        </button>

        {(me?.friendsCount ?? 0) > 0 || fromFriendsKop > 0 ? (
          <div className="card flex items-center gap-3 !py-2.5 !mb-0">
            <div className="w-10 h-10 rounded-xl bg-brand-soft flex items-center justify-center">
              <Gift size={20} className="text-brand" />
            </div>
            <div>
              <div className="text-sm font-semibold text-ink tabular-nums">От друзей +{formatRub(fromFriendsKop)} ₽</div>
              <div className="text-xs text-ink-secondary">{me?.friendsCount ?? 0} {friendsWord(me?.friendsCount ?? 0)}</div>
            </div>
          </div>
        ) : null}

        <InstallBanner variant="inline" />

        {!saved && me && (
          <button
            type="button"
            onClick={() => nav('/me')}
            className="w-full text-left text-sm text-ink-secondary px-1 min-h-11 underline decoration-dotted"
          >
            Сохраните код восстановления, чтобы не потерять прогресс — «Профиль»
          </button>
        )}

        {vouchers.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5">
              <Ticket size={16} className="text-brand" /> Купоны
            </h2>
            {vouchers.map((v) => (
              <div key={v[0]} className="card flex justify-between items-center !py-3 !mb-0">
                <b className="text-sm">{v[1] === 'p' ? `Скидка ${v[2]}%` : `Скидка ${v[2]} ₽`}</b>
                <span className="text-ink-tertiary text-xs">до {new Date(v[3] * 86_400_000).toLocaleDateString('ru-RU')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
