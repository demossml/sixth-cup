import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSetup from '../components/AppSetup'
import DealCard from '../components/DealCard'
import InviteNotice from '../components/InviteNotice'
import ActiveOrderBanner from '../components/order/ActiveOrderBanner'
import { OrderQrScreen } from '../components/order/OrderQrScreen'
import { useActiveOrder } from '../lib/useActiveOrder'
import { loadOrderRef, saveOrderRef, type OrderOut } from '../lib/preorderApi'
import ProgressStamps from '../components/ProgressStamps'
import PromoSheet from '../components/PromoSheet'
import Qr from '../components/Qr'
import QrLayer from '../components/QrLayer'
import { useApp } from '../lib/app'
import { formatCardCode } from '../lib/card'
import { displayNickname } from '../lib/guestName'
import { greetingFor } from '../lib/greeting'
import { isVisibleAt, minutesOf, weekdayIndex } from '../lib/dealWindow'
import { activeVouchers } from '../lib/proof'
import { formatRub } from '../lib/money'
import { friendsWord, progressPhrase } from '../lib/plural'
import { useNow } from '../lib/useNow'
import { useWakeLock } from '../lib/wakeLock'
import AppLogo from '../components/AppLogo'
import { ChevronRight, Gift, RefreshCw, Ticket, Users, WifiOff } from '../lib/icons'

/**
 * Титульный экран (TITLE-SCREEN-PWA-SPEC): шапка с прогрессом → карта-пропуск →
 * секция «Акции» (акции и купоны) → приглашение → установка.
 *
 * Тексты акций приходят только из админки (`promos`, плейсмент home_feature):
 * в коде нет зашитых «каждый N-й стакан» — иначе сезонная кампания выглядела бы
 * как постоянная надпись. Нет акций и купонов — секции на экране нет совсем.
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
  // Активный заказ: баннер над картой-пропуском и экран заказа по тапу.
  const { order: activeOrder, offline: orderOffline, refresh: refreshOrder } = useActiveOrder()
  const [orderView, setOrderView] = useState<OrderOut | null>(null)
  // Акция, открытая в модальном окне (tapAction='modal').
  const [promoOpen, setPromoOpen] = useState<null | {
    title: string; body?: string; subtitle?: string | null; terms?: string | null
    imageUrl?: string | null; mediaType?: 'image' | 'video'; ctaLabel?: string | null; productId?: number | null
  }>(null)
  // Время суток обновляем раз в минуту: акция появляется и исчезает по часам телефона.
  const nowMs = useNow(60_000)
  const minutesNow = minutesOf(new Date(nowMs))
  const weekdayNow = weekdayIndex(new Date(nowMs))
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
    productId?: number | null
    tapAction?: 'modal' | 'product' | 'menu'
    timeFrom?: number | null; timeTo?: number | null
    daysMask?: number | null
    subtitle?: string | null; terms?: string | null
  }>
  const activeContent = [...content].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
  // home_hero — фон существующей шапки, а не отдельный блок над ней.
  const heroBackground = activeContent.find((x) => x.placement === 'home_hero') ?? null
  const media = (item: typeof content[number], className: string) => item.imageUrl ? (
    item.mediaType === 'video' ? <video src={item.imageUrl} className={className} autoPlay muted loop playsInline preload="metadata" aria-label={item.title} /> :
      <img src={item.imageUrl} alt={item.title} className={className} loading="lazy" />
  ) : null

  // Акции на главной — только из админки, только плейсмент «Карточка под QR».
  // Старый плейсмент home намеренно игнорируется: он дублировал фразу про 6-й стакан.
  // Фильтр по времени — по часам телефона, поэтому карточка появляется и из кэша.
  const visibleDeals = activeContent
    .filter((x) => x.placement === 'home_feature')
    .filter((x) => isVisibleAt({ from: x.timeFrom, to: x.timeTo, daysMask: x.daysMask }, minutesNow, weekdayNow))

  // Приветствие: одна строка, имя только если оно осмысленное (у гостя — «Гость»).
  const guestName = displayNickname(me?.nickname)
  const greeting = me ? `${greetingFor()}, ${guestName === 'Гость' ? 'гость' : guestName}` : greetingFor()

  const dealCards = visibleDeals.map((d) => {
    // Заголовок — только заголовок; если владелец оставил его пустым, берём короткое.
    const title = (d.title || d.subtitle || d.body || '').trim()
    if (!title) return null
    const action = d.tapAction || 'modal'
    // На карточке — короткое описание (или прежний body, если короткого нет).
    const cardBody = (d.subtitle ?? '').trim() || (d.title ? (d.body ?? '').trim() : '')
    return {
      key: `deal-${d.id}`,
      title,
      body: cardBody,
      // Аудит F-03: подпись на карточке должна совпадать с тем, что случится по тапу.
      cta: action === 'modal' ? 'Подробнее' : (d.ctaLabel?.trim() || 'Открыть'),
      badge: d.badge,
      imageUrl: d.imageUrl,
      mediaType: d.mediaType,
      mediaIcon: undefined,
      onClick: () => {
        if (action === 'product' && d.productId) return nav(`/menu/${d.productId}`)
        if (action === 'menu') return nav('/menu')
        setPromoOpen(d)
      },
    }
  }).filter((x) => x !== null)

  const voucherDate = (day: number) => new Date(day * 86_400_000).toLocaleDateString('ru-RU')
  // Купоны живут в том же рельсе: срок годности виден прямо в карточке.
  const voucherCards = vouchers.map((v) => ({
    key: `voucher-${v[0]}`,
    title: v[1] === 'p' ? `Скидка ${v[2]}%` : `Скидка ${v[2]} ₽`,
    body: `до ${voucherDate(v[3])}`,
    cta: 'Куда применить',
    badge: null,
    imageUrl: null,
    mediaType: 'image' as const,
    mediaIcon: <Ticket size={26} strokeWidth={1.7} />,
    onClick: () => nav('/promos'),
  }))

  const deals_all = [...dealCards, ...voucherCards]
  const dealCount = deals_all.length
  // Одна карточка — широкая (медиа слева), несколько — рельс вбок.
  const dealsWide = dealCount === 1

  return (
    <div className={activeOrder ? 'pb-24' : 'pb-4'}>
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
          <p className="text-[12px] leading-4 text-white/60">{greeting}</p>
          <div className="mt-1 flex items-center justify-between gap-2 min-h-10">
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

          <p className="mt-2.5 font-display font-semibold text-[19px] leading-[26px] tracking-[-0.01em] max-w-[250px]">
            {progressPhrase({ n: N, marks, freeAvailable: me?.freeAvailable ?? 0 })}
          </p>

          {/* Полоса марок схлопывается в ноль, пока марок нет: пустых ячеек не
              рисуем, а резервировать под них 40 px — это дырка в шапке. */}
          {marks > 0 || hasGift ? <ProgressStamps n={N} marks={marks} gift={hasGift} /> : null}
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
              {/* Аудит F-10, вариант 1: QR на карте — компактный «якорь», подпись честно говорит,
                  что тап открывает полноэкранный QR для кассы. */}
              <span className="mt-1.5 inline-flex items-center gap-0.5 text-[12px] leading-4 font-semibold text-brand">
                Открыть QR
                <ChevronRight size={12} strokeWidth={2} />
              </span>
            </span>
          </button>
        )}

        {msg && <p className={`text-sm ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}

        {dealCount > 0 && (
          <section>
            {/* Никаких «Акции» и «Ещё»: одна карточка говорит сама за себя, а подпись
                нужна только чтобы разделить несколько карточек в рельсе. */}
            {dealCount > 1 ? (
              <div className="section-head">
                <h2>Для вас</h2>
              </div>
            ) : null}
            {dealsWide ? (
              deals_all.map((d) => (
                <DealCard
                  key={d.key}
                  title={d.title}
                  body={d.body}
                  cta={d.cta}
                  badge={d.badge}
                  imageUrl={d.imageUrl}
                  mediaType={d.mediaType}
                  mediaIcon={d.mediaIcon}
                  wide
                  onClick={d.onClick}
                />
              ))
            ) : (
              <div className="rail scrollbar-none">
                {deals_all.map((d) => (
                  <DealCard
                    key={d.key}
                    title={d.title}
                    body={d.body}
                    cta={d.cta}
                    badge={d.badge}
                    imageUrl={d.imageUrl}
                    mediaType={d.mediaType}
                    mediaIcon={d.mediaIcon}
                    onClick={d.onClick}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {me && (
          <div className="bg-white border border-line rounded-2xl shadow-card divide-y divide-line">
            <button type="button" onClick={() => nav('/invite')} className="w-full text-left flex items-center gap-3 px-3.5 py-2 min-h-14 active:bg-brand-tint/60">
              <Users size={20} strokeWidth={1.75} className="text-brand shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-5 font-semibold text-ink">Пригласить друга</span>
                <span className="block text-[12px] leading-4 text-ink-secondary">{pct}% с покупок друга</span>
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

        {/* Аудит F-07: вместо двух баннеров — одна компактная строка настройки. */}
        <AppSetup restore={!saved && !!me} onSaveCode={() => nav('/me')} />
      </div>

      {/* Статус заказа — плавающая пилюля над таб-баром: всегда на виду, но не
          занимает место в потоке (как трекер заказа у Luckin). */}
      <ActiveOrderBanner
        variant="floating"
        order={activeOrder}
        offline={orderOffline}
        onOpen={(order) => { setOrderView(order); saveOrderRef({ orderId: order.id, qrPayload: loadOrderRef()?.qrPayload ?? null }) }}
      />

      {qrOpen && proof ? (
        <QrLayer proof={proof} cardCode={cardCode} onClose={() => setQrOpen(false)} />
      ) : null}

      {/* Акция в модальном окне: описание из админки + переход туда, куда указал владелец. */}
      {promoOpen ? (
        <PromoSheet
          item={{
            title: promoOpen.title || promoOpen.subtitle || 'Акция',
            body: promoOpen.body,
            terms: promoOpen.terms,
            imageUrl: promoOpen.imageUrl,
            mediaType: promoOpen.mediaType,
            ctaLabel: promoOpen.ctaLabel ?? undefined,
          }}
          onGo={() => {
            const target = promoOpen.productId ? `/menu/${promoOpen.productId}` : '/menu'
            setPromoOpen(null)
            nav(target)
          }}
          onClose={() => setPromoOpen(null)}
        />
      ) : null}

      {orderView ? (
        <OrderQrScreen
          orderId={orderView.id}
          qrPayload={loadOrderRef()?.orderId === orderView.id ? loadOrderRef()?.qrPayload ?? null : null}
          initial={orderView}
          onStatusChange={() => void refreshOrder()}
          onClose={() => { setOrderView(null); void refreshOrder() }}
          onOpenLoyalty={() => setOrderView(null)}
        />
      ) : null}
    </div>
  )
}
