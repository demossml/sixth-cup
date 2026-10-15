import { useEffect, useState } from 'react'
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
import { mediaUrl } from '../lib/media'
import { ChevronRight, Coffee, Gift, RefreshCw, Ticket, Users, Wallet, Wifi, WifiOff } from '../lib/icons'

type CmsItem = {
  id: number
  title: string
  body?: string
  imageUrl?: string | null
  placement?: string
  badge?: string | null
  ctaLabel?: string | null
  sortOrder?: number
}

/**
 * Главный экран по стильборду UI/UX v1.0:
 * фото-hero (или компактный brand-fallback) → прогресс + штампы → QR сразу →
 * кэшбэк → один баннер новинки. Без пустой дыры на полэкрана.
 */
export default function CardPage() {
  const { dir, me, best, syncing, lastSync, sync } = useApp()
  const nav = useNavigate()
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [hasNetwork, setHasNetwork] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const onOnline = () => setHasNetwork(true)
    const onOffline = () => setHasNetwork(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])
  const saved = (() => {
    try {
      return localStorage.getItem('sc-saved') === '1'
    } catch {
      return false
    }
  })()

  const N = Math.max(1, me?.cupsForFree ?? dir?.cupsForFree ?? 5)
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

  const contentList = (dir?.content ?? dir?.promos ?? []) as CmsItem[]
  const bySort = (a: CmsItem, b: CmsItem) => (b.sortOrder ?? 0) - (a.sortOrder ?? 0)
  const heroItem =
    [...contentList].filter((x) => x.placement === 'home_hero' && x.imageUrl).sort(bySort)[0] ||
    [...contentList].filter((x) => (x.placement === 'home' || x.placement === 'both') && x.imageUrl).sort(bySort)[0]
  const heroUrl = mediaUrl(heroItem?.imageUrl)

  const featured =
    [...contentList]
      .filter(
        (x) =>
          x !== heroItem &&
          (x.placement === 'home_feature' ||
            x.placement === 'featured' ||
            x.placement === 'home' ||
            x.placement === 'both' ||
            !x.placement),
      )
      .sort(bySort)[0] || null

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

  const slots = N + 1
  const cols = slots <= 8 ? slots : Math.ceil(slots / 2)

  const chip =
    status.kind === 'syncing'
      ? { cls: 'bg-white/15 text-white border border-white/25', label: 'Синхронизация' }
      : status.kind === 'offline'
        ? { cls: 'bg-off-bg text-off', label: 'Офлайн' }
        : status.kind === 'stale'
          ? { cls: 'bg-warn-bg text-warn', label: 'Устарело' }
          : hasGift
            ? { cls: 'bg-crema text-ink', label: 'Подарок доступен' }
            : { cls: 'bg-white/15 text-white border border-white/25', label: status.kind === 'never' ? 'Не обновлялось' : 'Онлайн' }

  const dim = status.kind === 'offline'

  return (
    <div className="pb-4">
      {/* Hero: фото CMS или компактный brand/night — без пустой 42vh-дыры */}
      <section
        className={`relative overflow-hidden rounded-b-3xl text-white ${!heroUrl ? (dim ? 'hero-night-off' : 'hero-night') : ''}`}
      >
        {heroUrl ? (
          <>
            <img src={heroUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/45 to-black/75" />
          </>
        ) : null}

        <div
          className="relative z-10 px-4 pb-12"
          style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <img
                src="/logo-mark.png"
                alt=""
                width={28}
                height={28}
                className="w-7 h-7 rounded-lg"
                style={{ mixBlendMode: 'lighten' }}
              />
              <h1 className="font-display text-[17px] leading-6 font-semibold">6.7 Coffee</h1>
            </div>
            <button
              type="button"
              onClick={() => void onSync()}
              className={`inline-flex items-center gap-1.5 text-[12px] leading-4 font-semibold px-3 rounded-full min-h-11 ${chip.cls}`}
              aria-label={`Обновить данные. ${status.label}`}
            >
              {hasGift && status.kind !== 'offline' && status.kind !== 'stale' ? (
                <Gift size={14} strokeWidth={1.75} />
              ) : hasNetwork ? (
                <Wifi size={14} strokeWidth={1.75} />
              ) : (
                <WifiOff size={14} strokeWidth={1.75} />
              )}
              {syncing ? (
                <RefreshCw size={14} strokeWidth={1.75} className="animate-spin motion-reduce:animate-none" />
              ) : null}
              {chip.label}
            </button>
          </div>

          <p className="mt-2 font-display font-semibold text-[22px] leading-[28px] max-w-[280px]">
            {progressPhrase({ n: N, left, freeAvailable: freeLeft })}
          </p>

          <div
            role="img"
            aria-label={`Куплено ${paidProgress} из ${N} ${cupsWord(N)}${hasGift ? ', подарок доступен' : ''}`}
            className="mt-3"
          >
            <div className="grid gap-x-1.5 gap-y-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {Array.from({ length: N }, (_, i) => {
                const filled = i < paidProgress
                return (
                  <div key={i} className="flex justify-center min-w-0">
                    <div
                      className={`w-full max-w-[36px] aspect-square rounded-full flex items-center justify-center ${
                        filled
                          ? 'bg-[#3B6EF5] text-white stamp-in'
                          : 'border border-white/35 text-white/45'
                      }`}
                      style={filled ? { animationDelay: `${i * 30}ms` } : undefined}
                    >
                      <Coffee size={18} strokeWidth={1.75} />
                    </div>
                  </div>
                )
              })}
              <div className="flex justify-center min-w-0">
                <div
                  className={`w-full max-w-[36px] aspect-square rounded-full flex items-center justify-center ${
                    hasGift ? 'bg-crema text-ink gift-pulse' : 'border border-crema/70 text-crema'
                  }`}
                >
                  <Gift size={18} strokeWidth={1.75} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="px-4 -mt-6 space-y-2.5 relative z-20">
        {/* QR-карточка — главный объект, сразу */}
        <div className="bg-white rounded-3xl shadow-lift px-4 pt-4 pb-3">
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
              <button
                type="button"
                className="btn-ghost min-h-12 inline-flex items-center justify-center gap-2"
                onClick={() => void onSync()}
              >
                <RefreshCw size={16} className={syncing ? 'animate-spin motion-reduce:animate-none' : ''} /> Обновить
              </button>
            </div>
          ) : (
            <>
              {!hasNetwork && (
                <div
                  className="flex items-center gap-2 text-[13px] leading-[18px] text-off bg-off-bg rounded-xl px-3 py-2 mb-3"
                  role="status"
                >
                  <WifiOff size={16} strokeWidth={1.75} className="shrink-0" />
                  <span>
                    <b className="font-semibold">Нет сети</b> · QR из кэша доступен
                  </span>
                </div>
              )}
              <button
                type="button"
                className="w-full flex flex-col items-center bg-white rounded-xl active:opacity-90"
                onClick={() => nav('/card-qr')}
                aria-label="Увеличить QR на весь экран"
              >
                <div className="w-full max-w-[200px] bg-white rounded-xl">
                  <Qr value={proof} size={280} alt="QR карты для кассы" />
                </div>
                <p className="mt-1 font-display font-semibold text-[28px] leading-9 tracking-[0.12em] num text-ink">
                  {formatCardCode(cardCode)}
                </p>
                <p className="text-[12px] leading-4 text-ink-secondary mt-0.5">Не читается — назовите номер бариста</p>
              </button>
              {!hasNetwork ? (
                <p className="text-center text-[12px] leading-4 text-ink-secondary mt-2">
                  Обновится при подключении
                  {status.detail ? ` · ${status.detail.replace('QR работает · ', '')}` : ''}
                </p>
              ) : status.detail && status.kind !== 'fresh' ? (
                <p className="text-center text-[12px] leading-4 text-ink-secondary mt-2">{status.detail}</p>
              ) : null}
            </>
          )}
        </div>

        {msg && <p className={`text-sm ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}

        {/* Кэшбэк — одна кремовая строка как на макете */}
        {me && (
          <button
            type="button"
            onClick={() => nav('/history')}
            className="w-full text-left flex items-center gap-3 px-3.5 py-3 min-h-12 rounded-2xl bg-[#F6EEDF] border border-[#EADFC9] active:opacity-90"
          >
            <span className="w-8 h-8 rounded-full bg-crema/40 text-[#78572F] flex items-center justify-center shrink-0">
              <Wallet size={16} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-display font-semibold text-[15px] num text-ink">
                Кэшбэк {formatRub(me.cashbackBalance)} ₽
              </div>
              <div className="text-[12px] leading-4 text-ink-secondary">Списать можно только у бариста</div>
            </div>
            <ChevronRight size={18} strokeWidth={1.75} className="text-ink-tertiary shrink-0" />
          </button>
        )}

        {/* Один баннер новинки или brand-fallback */}
        {(() => {
          if (!featured) {
            return (
              <div className="rounded-3xl overflow-hidden bg-brand text-white p-5 flex items-center gap-4 shadow-card">
                <img
                  src="/logo-mark.png"
                  alt=""
                  width={44}
                  height={44}
                  className="w-11 h-11 rounded-xl shrink-0"
                  style={{ mixBlendMode: 'lighten' }}
                />
                <div>
                  <p className="font-display font-semibold text-[18px] leading-6">Каждый {N + 1}-й кофе в подарок</p>
                  <p className="text-[13px] text-white/80 mt-0.5">Покажите карту на кассе</p>
                </div>
              </div>
            )
          }
          const badge =
            featured.badge === 'new'
              ? 'Новинка'
              : featured.badge === 'hit'
                ? 'Хит'
                : featured.badge
                  ? 'Сезон'
                  : null
          const img = mediaUrl(featured.imageUrl)
          if (!img) {
            return (
              <button
                type="button"
                onClick={() => nav('/menu')}
                className="w-full text-left rounded-3xl bg-brand text-white p-5 shadow-card"
              >
                {badge ? (
                  <span className="inline-block text-[11px] font-semibold uppercase tracking-wide bg-crema text-ink rounded-full px-2.5 py-0.5 mb-2">
                    {badge}
                  </span>
                ) : null}
                <div className="font-display font-semibold text-[18px] leading-6">{featured.title}</div>
                {featured.body ? (
                  <p className="text-[13px] leading-[18px] text-white/80 mt-1 line-clamp-2">{featured.body}</p>
                ) : null}
                <div className="text-[13px] font-semibold mt-3 inline-flex items-center gap-1">
                  {featured.ctaLabel || 'Смотреть в меню'} <ChevronRight size={16} strokeWidth={1.75} />
                </div>
              </button>
            )
          }
          return (
            <button
              type="button"
              onClick={() => nav('/menu')}
              className="relative w-full text-left rounded-3xl overflow-hidden shadow-card block min-h-[140px] bg-[#1B1A17]"
            >
              <img src={img} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
              <div className="relative p-4 flex flex-col justify-end min-h-[140px] text-white">
                {badge ? (
                  <span className="self-start text-[11px] font-semibold uppercase tracking-wide bg-crema text-ink rounded-full px-2.5 py-0.5 mb-2">
                    {badge}
                  </span>
                ) : null}
                <div className="font-display font-semibold text-[17px] leading-6">{featured.title}</div>
                <div className="text-[13px] leading-[18px] text-white/85 mt-0.5">
                  {featured.ctaLabel || featured.body || 'Смотреть в меню'}
                </div>
              </div>
            </button>
          )
        })()}

        {me && (
          <div className="bg-white border border-line rounded-2xl shadow-card divide-y divide-line">
            <button
              type="button"
              onClick={() => nav('/invite')}
              className="w-full text-left flex items-center gap-3 px-3.5 py-3 min-h-14 active:bg-brand-tint/60"
            >
              <Users size={20} strokeWidth={1.75} className="text-brand shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-ink">Пригласить друга</div>
                <div className="text-[13px] leading-[18px] text-ink-secondary">
                  {pct}% с его покупок · ссылка для друга, не для кассы
                </div>
              </div>
              <ChevronRight size={18} strokeWidth={1.75} className="text-ink-tertiary shrink-0" />
            </button>
            {(me?.friendsCount ?? 0) > 0 || fromFriendsKop > 0 ? (
              <div className="flex items-center gap-3 px-3.5 py-3 min-h-14">
                <Gift size={20} strokeWidth={1.75} className="text-brand shrink-0" />
                <div>
                  <div className="text-[15px] font-semibold text-ink num">
                    От друзей +{formatRub(fromFriendsKop)} ₽
                  </div>
                  <div className="text-[13px] leading-[18px] text-ink-secondary">
                    {me?.friendsCount ?? 0} {friendsWord(me?.friendsCount ?? 0)}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

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
                <span className="text-ink-tertiary text-[13px] num">
                  до {new Date(v[3] * 86_400_000).toLocaleDateString('ru-RU')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
