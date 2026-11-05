import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import InstallBanner from '../components/InstallBanner'
import InviteNotice from '../components/InviteNotice'
import ProgressStamps from '../components/ProgressStamps'
import Qr from '../components/Qr'
import QrLayer from '../components/QrLayer'
import { useApp } from '../lib/app'
import { formatCardCode } from '../lib/card'
import { activeVouchers } from '../lib/proof'
import { formatRub } from '../lib/money'
import { friendsWord, progressPhrase } from '../lib/plural'
import { useWakeLock } from '../lib/wakeLock'
import AppLogo from '../components/AppLogo'
import { ChevronRight, Gift, RefreshCw, Ticket, Users, WifiOff } from '../lib/icons'

/**
 * Титульный экран (TITLE-SCREEN-PWA-SPEC): шапка с прогрессом → карта-пропуск →
 * акция → приглашение → установка → напоминание о коде → купоны.
 *
 * Сеть: в онлайне сетевого бейджа нет вообще, «Офлайн» показывается только когда
 * данные действительно не обновляются (результат sync, а не один navigator.onLine).
 * Все цифры прогресса — серверные, оптимистичных марок нет.
 */
export default function CardPage() {
  const { dir, me, best, online, syncing, sync } = useApp()
  const nav = useNavigate()
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const saved = (() => { try { return localStorage.getItem('sc-saved') === '1' } catch { return false } })()

  const N = Math.max(1, me?.cupsForFree ?? dir?.cupsForFree ?? 5)
  const paidProgress = Math.min(N, Math.max(0, me?.cupsTowardFree ?? 0))
  const hasGift = (me?.freeAvailable ?? 0) > 0
  // Подарок забирает последнюю марку: после 5-го стакана сервер отдаёт cupsTowardFree = 0.
  const marks = hasGift ? N : paidProgress
  const pct = dir?.referralCashbackPercent ?? 3
  const fromFriendsKop = me?.fromFriendsKopecks ?? (me?.fromFriendsRub ?? 0) * 100
  const vouchers = activeVouchers({ v: me?.vouchers ?? [] } as never)
  const proof = best?.token
  const cardCode = me?.cardCode ?? ''
  const cashback = me?.cashbackBalance ?? 0

  useWakeLock(!!proof)

  // Развёрнутый QR открыт — страница под ним не скроллится.
  useEffect(() => {
    if (!qrOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [qrOpen])

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

  const dim = !online

  const content = (dir?.content ?? dir?.promos ?? []) as Array<{
    id: number; title: string; body?: string; imageUrl?: string | null; mediaType?: 'image' | 'video'
    placement?: string; badge?: string | null; ctaLabel?: string | null; sortOrder?: number
  }>
  const activeContent = [...content].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
  // home_hero — фон существующей шапки, а не отдельный блок над ней.
  const heroBackground = activeContent.find((x) => x.placement === 'home_hero') ?? null
  // home_feature — единственная акция сразу под картой-пропуском; legacy 'home' совместим.
  const featureItem = activeContent.find((x) => ['home_feature', 'home'].includes(x.placement || 'home')) ?? null
  const media = (item: typeof content[number], className: string) => item.imageUrl ? (
    item.mediaType === 'video' ? <video src={item.imageUrl} className={className} autoPlay muted loop playsInline preload="metadata" aria-label={item.title} /> :
      <img src={item.imageUrl} alt={item.title} className={className} loading="lazy" />
  ) : null
  const badge = featureItem
    ? (featureItem.badge === 'new' ? 'Новинка' : featureItem.badge === 'hit' ? 'Хит' : featureItem.badge ? 'Сезон' : null)
    : null

  const promoTitle = featureItem?.title?.trim() || `Каждый ${N + 1}-й кофе в подарок`
  const promoSub = featureItem?.ctaLabel || featureItem?.body || 'Копите стаканы в 6.7 Coffee'
  // Акция: одна карточка сразу под картой-пропуском, до 148 px. С медиа — фон, без — центрированный текст.
  const promo = (
    <button
      type="button"
      onClick={() => nav('/menu')}
      className={`relative w-full text-left rounded-3xl overflow-hidden shadow-card block text-white min-h-[132px] max-h-[148px] ${featureItem?.imageUrl ? 'bg-night' : 'bg-brand'}`}
    >
      {featureItem?.imageUrl ? (
        <>
          {media(featureItem, 'absolute inset-0 w-full h-full object-cover')}
          <div className="absolute inset-0 bg-gradient-to-t from-[#073561]/75 via-[#0B4A8D]/25 to-transparent" />
        </>
      ) : null}
      <div className="relative p-4 min-h-[132px] flex items-center justify-between gap-3.5">
        <div className="min-w-0">
          {badge ? <span className="inline-block text-[11px] font-semibold uppercase tracking-wide bg-brand-mid text-white rounded-full px-2.5 py-0.5 mb-1.5">{badge}</span> : null}
          <div className="font-display font-semibold text-[19px] leading-6">{promoTitle}</div>
          <div className="mt-1.5 text-[11px] leading-[15px] text-white/80">{promoSub}</div>
        </div>
        <span className="w-9 h-9 flex-none rounded-[11px] border border-white/45 flex items-center justify-center font-display text-[10px] leading-none font-bold">
          6<span className="brand-dot" aria-hidden="true" />7
        </span>
      </div>
    </button>
  )

  return (
    <div className="pb-4">
      {/* Шапка: логотип + (только офлайн) бейдж, фраза прогресса, стикеры. Кэшбэка здесь нет. */}
      <div
        className={`${dim ? 'hero-night-off' : 'hero-night'} relative isolate overflow-hidden text-white px-4 pb-5 rounded-b-3xl`}
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        {heroBackground?.imageUrl ? (
          <>
            {media(heroBackground, 'absolute inset-0 z-0 w-full h-full object-cover')}
            <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#073561]/50 via-transparent to-[#0B4A8D]/40" aria-hidden="true" />
          </>
        ) : null}
        <div className="relative z-10">
          <div className="flex items-center justify-between gap-2 min-h-11">
            <AppLogo tone="onDark" size="sm" />
            <div className="flex items-center gap-1.5 flex-none">
              {/* Подарок — компактный чип справа, только когда он реально доступен. */}
              {hasGift ? (
                <span className="gift-chip" role="status" aria-label="Подарок доступен. Скажите бариста">
                  <Gift size={14} strokeWidth={1.7} />
                  Подарок
                </span>
              ) : null}
              {!online ? (
                <span
                  role="status"
                  title="Карта и QR доступны из кэша. Начисления — после подключения"
                  className="inline-flex items-center gap-1.5 text-[10px] leading-[14px] font-semibold px-2.5 h-8 rounded-full bg-white/15 text-white"
                >
                  <WifiOff size={14} strokeWidth={1.8} />
                  Офлайн
                </span>
              ) : null}
            </div>
          </div>

          <p className="mt-3.5 font-display font-semibold text-[19px] leading-[26px] tracking-[-0.01em] max-w-[250px]">
            {progressPhrase({ n: N, marks, freeAvailable: me?.freeAvailable ?? 0 })}
          </p>

          <ProgressStamps n={N} marks={marks} gift={hasGift} />
        </div>
      </div>

      <div className="px-4 -mt-3 space-y-3">
        {/* Приглашение, которое не применилось (существующая карта / неверный код). */}
        <InviteNotice />

        {/* Карта-пропуск: одна tap-зона, QR 112 px. Малый QR — якорь, а не код для сканера. */}
        {!me && !proof ? (
          <div className="bg-white rounded-3xl shadow-lift px-4 py-5 text-center space-y-3">
            <p className="text-sm text-ink-secondary">Нужен интернет один раз — карта и QR появятся сами.</p>
            <button type="button" className="btn min-h-12" onClick={() => void onSync()}>
              Получить карту
            </button>
          </div>
        ) : !proof ? (
          <div className="bg-white rounded-3xl shadow-lift px-4 py-5 min-h-[136px] flex flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-ink-secondary">QR обновится при подключении</p>
            <button type="button" className="btn-ghost min-h-11 inline-flex items-center justify-center gap-2" onClick={() => void onSync()}>
              <RefreshCw size={16} className={syncing ? 'animate-spin motion-reduce:animate-none' : ''} /> Обновить
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            aria-expanded={qrOpen}
            aria-controls="qr-layer"
            aria-label={`Карта ${cardCode}. Показать QR на кассе`}
            className="w-full bg-white border border-line rounded-[20px] shadow-lift p-3 flex items-center gap-3 text-left active:scale-[0.995] motion-reduce:transition-none"
          >
            <span className="w-[112px] h-[112px] flex-none p-1.5 border border-line rounded-xl bg-white">
              <Qr value={proof} size={112} alt="" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] leading-[14px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
                Карта 6<span className="brand-dot" aria-hidden="true" />7
              </span>
              <span className="block mt-px font-display font-semibold text-[24px] leading-[30px] tracking-[0.08em] num text-ink">
                {formatCardCode(cardCode)}
              </span>
              {cashback > 0 ? (
                <span className="block mt-px text-[11px] leading-[15px] text-ink-secondary num">
                  Кэшбэк {formatRub(cashback)} ₽ · у бариста
                </span>
              ) : null}
              <span className="mt-1.5 inline-flex items-center gap-0.5 text-[12px] leading-4 font-semibold text-brand">
                Показать QR · тап
                <ChevronRight size={12} strokeWidth={2} />
              </span>
            </span>
          </button>
        )}

        {msg && <p className={`text-sm ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}

        {promo}

        {me && (
          <div className="bg-white border border-line rounded-2xl shadow-card divide-y divide-line">
            <button type="button" onClick={() => nav('/invite')} className="w-full text-left flex items-center gap-3 px-3.5 py-2 min-h-14 active:bg-brand-tint/60">
              <Users size={20} strokeWidth={1.75} className="text-brand shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-5 font-semibold text-ink">Пригласить друга</span>
                <span className="block text-[12px] leading-4 text-ink-secondary">{pct}% с его покупок · не для кассы</span>
              </span>
              <ChevronRight size={18} strokeWidth={1.75} className="text-ink-tertiary shrink-0" />
            </button>
            {(me?.friendsCount ?? 0) > 0 ? (
              <div className="flex items-center gap-3 px-3.5 py-2 min-h-14">
                <Gift size={20} strokeWidth={1.75} className="text-brand shrink-0" />
                <div className="min-w-0">
                  <div className="text-[15px] leading-5 font-semibold text-ink num">
                    {fromFriendsKop > 0 ? `От друзей +${formatRub(fromFriendsKop)} ₽` : 'От друзей'}
                  </div>
                  <div className="text-[12px] leading-4 text-ink-secondary num">
                    {me?.friendsCount ?? 0} {friendsWord(me?.friendsCount ?? 0)}
                    {fromFriendsKop > 0 ? '' : ' · пока без начислений'}
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
            className="w-full text-left text-[11px] leading-4 text-ink-secondary py-3 underline decoration-dotted underline-offset-2"
          >
            Сохраните код восстановления, чтобы не потерять прогресс
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

      {qrOpen && proof ? (
        <QrLayer proof={proof} cardCode={cardCode} onClose={() => setQrOpen(false)} />
      ) : null}
    </div>
  )
}
