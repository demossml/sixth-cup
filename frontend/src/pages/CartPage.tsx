import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Minus, Plus, Ticket, Gift } from 'lucide-react'
import { useApp } from '../lib/app'
import { formatPrice, storeHours, type MenuDirectory } from '../lib/menuModel'
import {
  clearCart,
  createOrder,
  loadCart,
  saveCart,
  saveOrderRef,
  type CartLine,
  type OrderOut,
} from '../lib/preorderApi'
import { OrderQrScreen } from '../components/order/OrderQrScreen'
import { useActiveOrder } from '../lib/useActiveOrder'
import { banLeftSec, banText } from '../lib/orderBanner'
import { benefitLabel, fetchQuote, type BenefitChoice, type QuoteResponse } from '../lib/menuConfig'
import { useNow } from '../lib/useNow'

/**
 * Состав заказа отдельным экраном (как в макете): точка выдачи, бонусы, строки с составом,
 * «Изменить»/«Удалить», итог и отправка в кофейню.
 *
 * Бонусы PWA не списывает — касса применяет их при оплате; здесь только показываем, что доступно.
 */
export default function CartPage() {
  const nav = useNavigate()
  const { dir: rawDir, me, online } = useApp()
  const dir = rawDir as MenuDirectory | null
  const [lines, setLines] = useState<CartLine[]>(() => loadCart())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blockNote, setBlockNote] = useState<string | null>(null)
  const [placed, setPlaced] = useState<{ orderId: string; qrPayload: string | null; order: OrderOut } | null>(null)
  const [benefit, setBenefit] = useState<BenefitChoice>(null)
  const [quote, setQuote] = useState<QuoteResponse | null>(null)
  const [quoteErr, setQuoteErr] = useState<string | null>(null)
  const { order: activeOrder, bannedUntil, refresh: refreshOrder } = useActiveOrder()
  const clock = useNow(30_000)
  const banLeft = banLeftSec(bannedUntil, clock)

  const storeId = useMemo(() => {
    try { return Number(localStorage.getItem('sc_store_id')) || null } catch { return null }
  }, [])
  const store = dir?.stores.find((s) => s.id === storeId) ?? null
  const hours = store ? storeHours(store) : null

  const update = useCallback((next: CartLine[]) => {
    setLines(next)
    if (next.length) saveCart(next)
    else clearCart()
  }, [])

  useEffect(() => {
    if (!lines.length && !placed) setError(null)
  }, [lines.length, placed])

  // Серверный расчёт: сумма, скидка по бонусу и подпись, которую примет создание заказа.
  useEffect(() => {
    if (!storeId || !lines.length) { setQuote(null); return }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    let alive = true
    const t = setTimeout(() => {
      void fetchQuote(
        storeId,
        lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          volumeId: l.volumeId ?? null,
          // Молоко и платные добавки влияют на сумму — считаем их на сервере, а не на клиенте.
          modifiers: (l.modifiers ?? []).map((m) => ({ modifierId: String(m.modifierId) })),
        })),
        benefit,
      ).then((r) => {
        if (!alive) return
        if (r.ok) { setQuote(r); setQuoteErr(null) }
        else {
          setQuoteErr(r.message || 'Не удалось пересчитать корзину')
          // Бонус мог устареть (ваучер истёк) — снимаем выбор, чтобы не обещать скидку.
          if (r.error === 'benefit_stale' || r.error === 'benefit_not_available') setBenefit(null)
        }
      })
    }, 150)
    return () => { alive = false; clearTimeout(t) }
  }, [storeId, lines, benefit])

  const total = lines.reduce((s, l) => s + l.unitPriceEstimate * l.quantity, 0)
  const count = lines.reduce((s, l) => s + l.quantity, 0)
  const blocked = activeOrder != null || banLeft > 0 || !store || !online

  const bump = (key: string, delta: number) => {
    update(
      lines
        .map((l) => (l.key === key ? { ...l, quantity: Math.max(0, Math.min(99, l.quantity + delta)) } : l))
        .filter((l) => l.quantity > 0),
    )
  }

  async function submit() {
    if (!store || !lines.length) return
    setBusy(true)
    setError(null)
    setBlockNote(null)
    const r = await createOrder({
      storeId: store.id,
      cardId: me?.cardCode ? String(me.cardCode) : null,
      items: lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        volumeId: l.volumeId,
        modifiers: l.modifiers.map((m) => ({
          groupKey: m.groupKey,
          modifierId: m.modifierId,
          name: m.name ?? null,
          priceRub: m.price ?? null,
        })),
      })),
      quoteToken: quote?.quoteToken ?? null,
    })
    setBusy(false)
    if (!r.ok) {
      if (r.error === 'active_order_exists') {
        setBlockNote('У вас уже есть активный заказ — сначала заберите его.')
        await refreshOrder()
        return
      }
      if (r.error === 'preorder_banned') {
        setBlockNote(r.message || 'Новый заказ пока недоступен: прошлый не был забран и оплачен.')
        await refreshOrder()
        return
      }
      setError(r.message || 'Не удалось отправить заказ')
      return
    }
    saveOrderRef({ orderId: r.order.id, qrPayload: r.qrPayload })
    setPlaced({ orderId: r.order.id, qrPayload: r.qrPayload, order: r.order })
    update([])
    void refreshOrder()
  }

  const pad = { paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }
  const available = quote?.available ?? null

  return (
    <main className="pb-40">
      <div className="px-4" style={pad}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => nav('/menu')}
            aria-label="Назад"
            className="w-11 h-11 rounded-full bg-white border border-line flex items-center justify-center text-ink shrink-0"
          >
            <ArrowLeft size={18} strokeWidth={1.75} />
          </button>
          <h1 className="font-display text-[26px] leading-8 font-semibold text-ink">Корзина</h1>
        </div>
        {store ? <p className="mt-2 text-[13px] leading-[18px] text-ink-secondary">{store.address}</p> : null}

        <section className="mt-3 rounded-2xl border border-line bg-white px-3.5 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] leading-4 uppercase tracking-wide text-ink-secondary">Где заберёте</p>
            <p className="text-[15px] leading-5 font-semibold text-ink truncate">
              {store ? store.name : 'Кофейня не выбрана'}
            </p>
            {hours?.label ? <p className="text-[12px] leading-4 text-ink-secondary">{hours.open ? `Открыто · ${hours.label}` : `Закрыто · ${hours.label}`}</p> : null}
          </div>
          <button type="button" onClick={() => nav('/pick-store?from=cart')} className="shrink-0 text-[13px] font-semibold text-brand underline">
            Изменить
          </button>
        </section>

        {lines.length > 0 && (available?.gift || (available?.vouchers.length ?? 0) > 0 || (available?.cashbackRub ?? 0) > 0) && (
          <section className="mt-2 rounded-2xl border border-line bg-white px-3.5 py-3">
            <p className="text-[11px] leading-4 uppercase tracking-wide text-ink-secondary">Скидки и бонусы</p>
            <div className="mt-2 space-y-1.5">
              <BenefitRow
                active={benefit == null}
                icon={<span className="w-5" />}
                title="Без бонуса"
                hint=""
                onClick={() => setBenefit(null)}
              />
              {available?.gift && (
                <BenefitRow
                  active={benefit?.kind === 'gift'}
                  icon={<Gift size={16} strokeWidth={1.75} className="text-brand" aria-hidden="true" />}
                  title="Подарок — 6-й стакан"
                  hint={quote?.benefit?.kind === 'gift' ? `−${quote.benefit.amountRub} ₽` : ''}
                  onClick={() => setBenefit({ kind: 'gift' })}
                />
              )}
              {available?.vouchers.map((v) => (
                <BenefitRow
                  key={v.id}
                  active={benefit?.kind === 'voucher' && benefit.voucherId === v.id}
                  icon={<Ticket size={16} strokeWidth={1.75} className="text-brand" aria-hidden="true" />}
                  title={v.title}
                  hint={v.kind === 'p' ? `−${v.value}%` : `−${v.value} ₽`}
                  onClick={() => setBenefit({ kind: 'voucher', voucherId: v.id })}
                />
              ))}
              {(available?.cashbackRub ?? 0) > 0 && (
                <BenefitRow
                  active={benefit?.kind === 'cashback'}
                  icon={<span className="w-5 text-[11px] font-semibold text-brand">₽</span>}
                  title={`Кэшбэк ${available?.cashbackRub} ₽`}
                  hint=""
                  onClick={() => setBenefit({ kind: 'cashback' })}
                />
              )}
            </div>
            <p className="mt-1.5 text-[12px] leading-4 text-ink-secondary">
              Одно правило за раз. Финально применяет касса при оплате.
            </p>
            {quoteErr && <p className="mt-1 text-[12px] leading-4 text-bad">{quoteErr}</p>}
          </section>
        )}

        <ul className="mt-3 space-y-2">
          {lines.map((l) => (
            <li key={l.key} className="rounded-2xl border border-line bg-white px-3.5 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] leading-5 font-semibold text-ink truncate">{l.name}</p>
                  {l.configText && l.configText !== l.name ? (
                    <p className="mt-0.5 text-[12px] leading-4 text-ink-secondary">{l.configText}</p>
                  ) : null}
                </div>
                <span className="text-[15px] leading-5 font-semibold num text-ink whitespace-nowrap">
                  {formatPrice(l.unitPriceEstimate * l.quantity)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Меньше: ${l.name}`}
                    onClick={() => bump(l.key, -1)}
                    className="w-9 h-9 rounded-full border border-line bg-white flex items-center justify-center"
                  >
                    <Minus size={16} strokeWidth={2} />
                  </button>
                  <span className="w-6 text-center text-[15px] num">{l.quantity}</span>
                  <button
                    type="button"
                    aria-label={`Больше: ${l.name}`}
                    onClick={() => bump(l.key, 1)}
                    className="w-9 h-9 rounded-full border border-line bg-white flex items-center justify-center"
                  >
                    <Plus size={16} strokeWidth={2} />
                  </button>
                </div>
                <div className="flex items-center gap-3 text-[13px] leading-4">
                  <button type="button" onClick={() => nav(`/menu/${l.productId}?line=${encodeURIComponent(l.key)}`)} className="font-semibold text-brand underline">
                    Изменить
                  </button>
                  <button type="button" onClick={() => update(lines.filter((x) => x.key !== l.key))} className="font-semibold text-ink-secondary underline">
                    Удалить
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {!lines.length && (
          <div className="mt-4 rounded-2xl border border-line bg-white px-4 py-6 text-center">
            <p className="text-[15px] leading-5 font-semibold text-ink">Корзина пуста</p>
            <p className="mt-1 text-[13px] leading-[18px] text-ink-secondary">Добавьте напиток или еду из меню.</p>
            <button type="button" onClick={() => nav('/menu')} className="btn min-h-11 mt-3 px-5">В меню</button>
          </div>
        )}

        {lines.length > 0 && (
          <section className="mt-3 rounded-2xl border border-line bg-white px-3.5 py-3">
            <div className="flex items-center justify-between text-[14px] leading-5 text-ink-secondary">
              <span>Позиции</span>
              <span className="num">{count}</span>
            </div>
            {quote && quote.discount > 0 && (
              <div className="mt-1 flex items-center justify-between text-[13px] leading-5 text-ok">
                <span>{benefitLabel(quote.benefit)}</span>
                <span className="num">−{formatPrice(quote.discount)}</span>
              </div>
            )}
            <div className="mt-1.5 flex items-baseline justify-between gap-3">
              <span className="text-[15px] leading-5 font-semibold text-ink">
                {quote && quote.discount > 0 ? 'Итого со скидкой' : 'Итого — оценка'}
              </span>
              <span className="font-display text-[22px] leading-7 font-semibold num text-ink">
                {formatPrice(quote ? quote.total : total)}
              </span>
            </div>
          </section>
        )}

        <p className="mt-3 text-[12px] leading-[18px] text-ink-secondary text-center">
          Финальная цена и чек — на кассе. После создания QR состав не меняется.
        </p>
        {banLeft > 0 && (
          <div role="status" className="mt-2 rounded-2xl bg-warn-bg text-warn px-3.5 py-2.5 text-[13px] leading-[18px]">
            {`Прошлый заказ не был забран и оплачен. Новый заказ будет доступен через ${banText(banLeft)}.`}
          </div>
        )}
        {activeOrder && (
          <div role="status" className="mt-2 rounded-2xl bg-warn-bg text-warn px-3.5 py-2.5 text-[13px] leading-[18px]">
            У вас уже есть активный заказ — сначала заберите его.
          </div>
        )}
        {blockNote && (
          <div role="status" className="mt-2 rounded-2xl bg-warn-bg text-warn px-3.5 py-2.5 text-[13px] leading-[18px]">{blockNote}</div>
        )}
        {error && <p role="alert" className="mt-2 text-[13px] leading-[18px] text-bad text-center">{error}</p>}
        {!online && (
          <p role="status" className="mt-2 text-[13px] leading-[18px] text-ink-secondary text-center">
            Нет сети — заказ можно отправить, когда появится соединение.
          </p>
        )}
      </div>

      {lines.length > 0 && (
        <div
          className="fixed left-0 right-0 max-w-[480px] mx-auto px-4 z-40 space-y-2"
          style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || blocked}
            className="btn min-h-14 w-full disabled:opacity-50"
          >
            {busy ? 'Отправляем…' : 'Отправить в кофейню'}
          </button>
          <button type="button" onClick={() => nav('/menu')} className="btn-ghost min-h-12 w-full bg-white">
            Добавить ещё
          </button>
        </div>
      )}

      {placed && (
        <OrderQrScreen
          orderId={placed.orderId}
          qrPayload={placed.qrPayload}
          initial={placed.order}
          onStatusChange={() => void refreshOrder()}
          onClose={() => { setPlaced(null); void refreshOrder() }}
          onOpenLoyalty={() => { setPlaced(null); nav('/') }}
        />
      )}
    </main>
  )
}

/** Строка выбора бонуса: радио-стиль, крупная зона нажатия. */
function BenefitRow({
  active,
  icon,
  title,
  hint,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  hint?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`w-full flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${
        active ? 'border-brand bg-brand-tint/40' : 'border-line bg-white'
      }`}
    >
      <span
        className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
          active ? 'border-brand bg-brand text-white' : 'border-line text-transparent'
        }`}
        aria-hidden="true"
      >
        <Check size={13} strokeWidth={3} />
      </span>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 text-[14px] leading-5 text-ink truncate">{title}</span>
      {hint ? <span className="shrink-0 text-[13px] leading-4 num text-ink-secondary">{hint}</span> : null}
    </button>
  )
}
