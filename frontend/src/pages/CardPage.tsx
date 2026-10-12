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
import { ChevronRight, Coffee, Gift, RefreshCw, Ticket, Users, Wallet, Wifi, WifiOff } from '../lib/icons'

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

  // Чип статуса: цвет + иконка + слово (состояние не только цветом).
  const chip =
    hasGift && status.kind === 'fresh'
      ? { cls: 'bg-crema text-ink', label: 'Подарок' }
      : status.kind === 'offline'
        ? { cls: 'bg-off-bg text-off', label: status.label }
        : status.kind === 'stale'
          ? { cls: 'bg-warn-bg text-warn', label: status.label }
          : { cls: 'bg-white/15 text-white', label: status.label }
  const dim = status.kind === 'offline'

  return (
    <div className="pb-4">
      {/* L1–L5: шапка (градиент, знак, чип, фраза, штампы). QR-карта наезжает на неё на 24 px. */}
      <div
        className={`${dim ? 'hero-off' : 'hero'} text-white px-4 pb-12 rounded-b-3xl`}
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <img src="/logo-mark.png" alt="" width={28} height={28} className="w-7 h-7 rounded-lg" style={{ mixBlendMode: 'lighten' }} />
            <h1 className="text-[12px] leading-4 font-semibold tracking-wide font-sans">6.7 Coffee</h1>
          </div>
          <button
            type="button"
            onClick={() => void onSync()}
            className={`inline-flex items-center gap-1.5 text-[12px] leading-4 font-semibold px-3 rounded-full min-h-11 ${chip.cls}`}
            aria-label={`Обновить данные. ${status.label}`}
          >
            {hasGift && status.kind === 'fresh' ? <Gift size={14} strokeWidth={1.75} /> : hasNetwork ? <Wifi size={14} strokeWidth={1.75} /> : <WifiOff size={14} strokeWidth={1.75} />}
            {syncing ? <RefreshCw size={14} strokeWidth={1.75} className="animate-spin motion-reduce:animate-none" /> : null}
            {chip.label}
          </button>
        </div>

        <p className="mt-1 font-display font-semibold text-[20px] leading-[26px]">
          {progressPhrase({ n: N, left, freeAvailable: freeLeft })}
        </p>

        <div role="img" aria-label={`Куплено ${paidProgress} из ${N} ${cupsWord(N)}${hasGift ? ', подарок доступен' : ''}`} className="mt-3">
          <div className="grid gap-x-1.5 gap-y-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: N }, (_, i) => {
              const filled = i < paidProgress
              return (
                <div key={i} className="flex justify-center min-w-0">
                  <div
                    className={`w-full max-w-[36px] aspect-square rounded-full flex items-center justify-center ${filled ? 'bg-white text-brand stamp-in' : 'border border-white/40 text-white/50'}`}
                    style={filled ? { animationDelay: `${i * 30}ms` } : undefined}
                  >
                    <Coffee size={18} strokeWidth={1.75} />
                  </div>
                </div>
              )
            })}
            <div className="flex justify-center min-w-0">
              <div
                className={`w-full max-w-[36px] aspect-square rounded-full flex items-center justify-center ${hasGift ? 'bg-crema text-ink gift-pulse' : 'border border-dashed border-white/50 text-white/60'}`}
              >
                <Gift size={18} strokeWidth={1.75} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 -mt-6 space-y-2.5">
        {/* L6–L8: карточка QR — главный объект. QR сразу, 0 тапов. Тёмный код на чистом белом, без градиента под ним. */}
        <div className="bg-white rounded-3xl shadow-lift p-4 relative">
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
                <div className="w-full bg-white rounded-xl">
                  <Qr value={proof} size={300} alt="QR карты для кассы" />
                </div>
                <p className="mt-2 font-display font-semibold text-[32px] leading-9 tracking-[0.12em] num text-ink">
                  {formatCardCode(cardCode)}
                </p>
                <p className="text-[13px] leading-[18px] text-ink-secondary mt-1">Не читается — назовите номер бариста</p>
              </button>
              {status.detail && status.kind !== 'fresh' && (
                <p className="text-center text-[12px] leading-4 text-ink-secondary mt-2">{status.detail}</p>
              )}
            </>
          )}
        </div>

        {msg && <p className={`text-sm ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}

        {/* L9: вторичное — одна группа с hairline вместо стопки одинаковых карточек. */}
        {me && (
          <div className="bg-white border border-line rounded-2xl shadow-card divide-y divide-line">
            <div className="flex items-center gap-3 px-3.5 py-3 min-h-14">
              <Wallet size={20} strokeWidth={1.75} className="text-brand shrink-0" />
              <div className="min-w-0">
                <div className="font-display font-semibold text-base num text-ink">Кэшбэк {formatRub(me.cashbackBalance)} ₽</div>
                <div className="text-[13px] leading-[18px] text-ink-secondary">Списать можно только у бариста на кассе</div>
              </div>
            </div>
            <button type="button" onClick={() => nav('/invite')} className="w-full text-left flex items-center gap-3 px-3.5 py-3 min-h-14 active:bg-brand-tint/60">
              <Users size={20} strokeWidth={1.75} className="text-brand shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-ink">Пригласить друга</div>
                <div className="text-[13px] leading-[18px] text-ink-secondary">{pct}% с его покупок · ссылка для друга, не для кассы</div>
              </div>
              <ChevronRight size={18} strokeWidth={1.75} className="text-ink-tertiary shrink-0" />
            </button>
            {(me?.friendsCount ?? 0) > 0 || fromFriendsKop > 0 ? (
              <div className="flex items-center gap-3 px-3.5 py-3 min-h-14">
                <Gift size={20} strokeWidth={1.75} className="text-brand shrink-0" />
                <div>
                  <div className="text-[15px] font-semibold text-ink num">От друзей +{formatRub(fromFriendsKop)} ₽</div>
                  <div className="text-[13px] leading-[18px] text-ink-secondary">{me?.friendsCount ?? 0} {friendsWord(me?.friendsCount ?? 0)}</div>
                </div>
              </div>
            ) : null}
          </div>
        )}


        {(() => {
          const list = (dir?.content ?? dir?.promos ?? []) as Array<{
            id: number; title: string; body?: string; imageUrl?: string | null
            placement?: string; badge?: string | null; ctaLabel?: string | null
          }>
          const home = list.find((x) => !x.placement || x.placement === 'home' || x.placement === 'both')
          if (!home) return null
          return (
            <button
              type="button"
              onClick={() => nav('/menu')}
              className="w-full text-left rounded-3xl overflow-hidden bg-white border border-line shadow-card mb-3"
            >
              {home.imageUrl ? (
                <img src={home.imageUrl} alt="" className="w-full h-36 object-cover bg-[#EDE7DC]" loading="lazy" />
              ) : null}
              <div className="p-3.5">
                {home.badge ? (
                  <span className="inline-block text-[11px] font-semibold uppercase tracking-wide text-brand bg-brand-tint rounded-full px-2 py-0.5 mb-1">
                    {home.badge === 'new' ? 'Новинка' : home.badge === 'hit' ? 'Хит' : 'Сезон'}
                  </span>
                ) : null}
                <div className="font-semibold text-[16px] text-ink">{home.title}</div>
                {home.body ? <p className="text-[13px] text-ink-secondary mt-1 line-clamp-2">{home.body}</p> : null}
                <div className="text-[13px] font-semibold text-brand mt-2">{home.ctaLabel || 'Смотреть в меню'}</div>
              </div>
            </button>
          )
        })()}

        <InstallBanner variant="inline" />

        {!saved && me && (
          <button
            type="button"
            onClick={() => nav('/me')}
            className="w-full text-left text-[13px] leading-[18px] text-ink-secondary px-1 min-h-11 underline decoration-dotted"
          >
            Сохраните код восстановления, чтобы не потерять прогресс — «Профиль»
          </button>
        )}

        {vouchers.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-ink flex items-center gap-1.5">
              <Ticket size={18} strokeWidth={1.75} className="text-brand" /> Купоны
            </h2>
            {vouchers.map((v) => (
              <div key={v[0]} className="card flex justify-between items-center !py-3 !mb-0">
                <b className="text-[15px] num">{v[1] === 'p' ? `Скидка ${v[2]}%` : `Скидка ${v[2]} ₽`}</b>
                <span className="text-ink-tertiary text-[13px] num">до {new Date(v[3] * 86_400_000).toLocaleDateString('ru-RU')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
