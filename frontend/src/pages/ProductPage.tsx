import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Minus, Plus } from 'lucide-react'
import AddonsSheet from '../components/menu/AddonsSheet'
import ProductPhoto from '../components/menu/ProductPhoto'
import Badge from '../components/menu/Badge'
import { useApp } from '../lib/app'
import {
  fetchProductConfig,
  initialSelection,
  selectionPrice,
  selectionText,
  toCartLine,
  validateSelection,
  type ProductConfig,
  type Selection,
} from '../lib/menuConfig'
import { buildMenuItems, isOrderable, type MenuDirectory } from '../lib/menuModel'
import { formatPrice } from '../lib/menuModel'
import { saveCart, loadCart, type CartLine } from '../lib/preorderApi'
import { restoreSelection } from '../lib/menuConfig'

const KBJU = [
  { key: 'calories', label: 'ккал', digits: 0 },
  { key: 'proteinG', label: 'белки', digits: 1 },
  { key: 'fatG', label: 'жиры', digits: 1 },
  { key: 'carbsG', label: 'углеводы', digits: 1 },
] as const

const fmtNum = (v: number, digits: number) =>
  digits === 0 ? String(Math.round(v)) : v.toLocaleString('ru-RU', { maximumFractionDigits: digits })

/**
 * Карточка товара: фото 4:5, КБЖУ, объём, молоко, добавки и sticky-кнопка «В заказ».
 * Число позиции в кнопке — подпись как в макете: «В заказ · 370 ₽».
 */
export default function ProductPage() {
  const { productId } = useParams()
  const [params] = useSearchParams()
  const lineKey = params.get('line')
  const nav = useNavigate()
  const { dir: rawDir } = useApp()
  const dir = rawDir as MenuDirectory | null
  const [cfg, setCfg] = useState<ProductConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<Selection | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [addonsOpen, setAddonsOpen] = useState(false)

  useEffect(() => {
    let alive = true
    setCfg(null)
    setError(null)
    void fetchProductConfig(String(productId)).then((r) => {
      if (!alive) return
      if ((r as ProductConfig).ok) {
        const c = r as ProductConfig
        setCfg(c)
        // «Изменить» из корзины: поднимаем прежний выбор (объём/молоко/корица/добавки).
        const line = lineKey ? loadCart().find((l) => l.key === lineKey) : null
        const restored = line ? restoreSelection(c, line) : null
        setSel(restored ?? initialSelection(c))
        if (line) setQuantity(line.quantity)
      } else {
        setError((r as { error: string }).error)
      }
    })
    return () => { alive = false }
  }, [productId, lineKey])

  const item = useMemo(() => {
    if (!dir || !cfg) return null
    return buildMenuItems(dir).find((i) => i.product.id === cfg.productId) ?? null
  }, [dir, cfg])

  const soldOut = cfg?.available === false || !isOrderable(item)
  const check = cfg && sel ? validateSelection(cfg, sel) : { ok: false }
  const price = cfg && sel ? selectionPrice(cfg, sel) : 0
  const addonCount = sel ? Object.values(sel.addons).reduce((s, n) => s + n, 0) : 0
  const addonSum = cfg && sel ? price - (cfg.volumes.find((v) => v.id === sel.volumeId)?.priceRub ?? cfg.priceRub) - (cfg.milk?.options.find((o) => o.id === sel.milkId)?.priceRub ?? 0) : 0

  const add = () => {
    if (!cfg || !sel || !check.ok) return
    const line = toCartLine(cfg, sel, quantity)
    const prev = loadCart()
    // Правка существующей строки: заменяем её, а не плодим дубликат.
    const next: CartLine[] = lineKey
      ? prev.map((l) => (l.key === lineKey ? { ...line, quantity } : l))
      : prev.some((l) => l.key === line.key)
        ? prev.map((l) => (l.key === line.key ? { ...l, quantity: Math.min(99, l.quantity + line.quantity) } : l))
        : [...prev, line]
    saveCart(next)
    nav('/cart')
  }

  const pad = { paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }

  if (error) {
    return (
      <main className="px-4 pb-6" style={pad}>
        <button type="button" onClick={() => nav(-1)} className="mb-4 inline-flex items-center gap-1.5 text-[14px] text-brand">
          <ArrowLeft size={18} strokeWidth={1.75} /> Назад
        </button>
        <div className="rounded-3xl bg-white border border-line p-6 text-center shadow-card">
          <h1 className="font-display text-lg font-semibold text-ink">Товар недоступен</h1>
          <p className="mt-2 text-sm text-ink-secondary">{error}</p>
        </div>
      </main>
    )
  }

  if (!cfg || !sel) {
    return (
      <main className="px-4 pb-6" style={pad} aria-busy="true">
        <div className="aspect-[4/5] w-full rounded-3xl bg-pale animate-pulse motion-reduce:animate-none" />
        <div className="mt-4 h-7 w-2/3 rounded-lg bg-pale animate-pulse motion-reduce:animate-none" />
        <div className="mt-2 h-4 w-1/2 rounded bg-pale animate-pulse motion-reduce:animate-none" />
      </main>
    )
  }

  const volume = cfg.volumes.find((v) => v.id === sel.volumeId) ?? null
  const kbju = KBJU.map((k) => ({ ...k, value: cfg[k.key as keyof ProductConfig] as number | null })).filter(
    (k) => k.value != null && Number(k.value) >= 0,
  )

  return (
    <main className="pb-40">
      <div className="px-4" style={pad}>
        <button
          type="button"
          onClick={() => nav(-1)}
          aria-label="Назад"
          className="w-11 h-11 rounded-full bg-white border border-line flex items-center justify-center text-ink"
        >
          <ArrowLeft size={18} strokeWidth={1.75} />
        </button>

        <div className="mt-3 relative rounded-3xl overflow-hidden bg-pale">
          <ProductPhoto
            name={cfg.name}
            icon={item?.product.icon ?? 'Coffee'}
            imageUrl={cfg.imageUrl}
            mediaType={cfg.mediaType ?? null}
            videoUrl={cfg.videoUrl ?? null}
            posterUrl={cfg.posterUrl ?? null}
            ratio="poster"
            eager
          />
          {item?.badge ? <Badge kind={item.badge} className="absolute left-3 top-3" /> : null}
        </div>

        <div className="mt-4 flex items-start justify-between gap-3">
          <h1 className="font-display text-[26px] leading-8 font-semibold text-ink min-w-0 break-words">{cfg.name}</h1>
          <span className="font-display text-[26px] leading-8 font-semibold num text-ink whitespace-nowrap">{formatPrice(price)}</span>
        </div>
        {cfg.description ? <p className="mt-1.5 text-[15px] leading-[22px] text-ink-secondary">{cfg.description}</p> : null}

        {kbju.length > 0 && (
          <div className="mt-4 grid grid-cols-4 gap-2 rounded-2xl border border-line bg-white px-3 py-3">
            {kbju.map((k) => (
              <div key={k.label} className="text-center">
                <div className="font-display text-[15px] leading-5 font-semibold num text-ink" aria-label={`${k.label}: ${fmtNum(Number(k.value), k.digits)}${k.digits === 1 ? ' грамма' : ''}`}>
                  {fmtNum(Number(k.value), k.digits)}
                  {k.digits === 1 ? ' г' : ''}
                </div>
                <div className="text-[11px] leading-4 text-ink-secondary" aria-hidden="true">{k.label}</div>
              </div>
            ))}
          </div>
        )}

        {cfg.volumes.length > 1 && (
          <section className="mt-5" aria-label="Объём">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[12px] leading-4 font-semibold uppercase tracking-wide text-ink-secondary">Объём</h2>
              <span className="text-[12px] leading-4 text-brand font-semibold">обязательно</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cfg.volumes.map((v) => {
                const active = sel.volumeId === v.id
                return (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={active}
                    disabled={!v.available}
                    onClick={() => setSel({ ...sel, volumeId: v.id })}
                    className={`rounded-full px-3.5 py-2 text-[14px] leading-5 border num transition-colors disabled:opacity-40 ${
                      active ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line active:bg-brand-tint'
                    }`}
                  >
                    {v.label || 'Стандарт'}
                    <span className={active ? 'text-white/80' : 'text-ink-secondary'}>{` · ${formatPrice(v.priceRub)}`}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {cfg.milk && cfg.milk.options.length > 0 && (
          <section className="mt-5" aria-label="Молоко">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[12px] leading-4 font-semibold uppercase tracking-wide text-ink-secondary">Молоко</h2>
              <span className="text-[12px] leading-4 text-brand font-semibold">обязательно</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cfg.milk.options.map((o) => {
                const active = sel.milkId === o.id
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={active}
                    disabled={!o.available}
                    onClick={() => setSel({ ...sel, milkId: o.id })}
                    className={`rounded-2xl px-3.5 py-2 text-[14px] leading-5 border text-left transition-colors disabled:opacity-40 ${
                      active ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line active:bg-brand-tint'
                    }`}
                  >
                    <span className="block">{o.label}</span>
                    <span className={`block text-[12px] leading-4 num ${active ? 'text-white/80' : 'text-ink-secondary'}`}>
                      {o.priceRub > 0 ? `+${o.priceRub} ₽` : '0 ₽'}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {(cfg.addons?.length || cfg.choice) && (
          <section className="mt-5" aria-label="Добавки">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[12px] leading-4 font-semibold uppercase tracking-wide text-ink-secondary">Добавки</h2>
              <span className="text-[12px] leading-4 text-ink-secondary">по желанию</span>
            </div>
            <button
              type="button"
              onClick={() => setAddonsOpen(true)}
              className="mt-2 w-full flex items-center justify-between gap-3 rounded-2xl border border-line bg-white px-3.5 py-3 text-left"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-7 h-7 rounded-full bg-brand-tint text-brand flex items-center justify-center shrink-0">
                  <Plus size={16} strokeWidth={2} />
                </span>
                <span className="text-[14px] leading-5 text-ink truncate">
                  {addonCount > 0 ? `${addonCount} выбрано` : optionSummary(cfg)}
                </span>
              </span>
              <span className="text-[13px] leading-4 num text-ink-secondary shrink-0">
                {addonSum > 0 ? `+${addonSum} ₽` : 'от 0 ₽'}
              </span>
            </button>
          </section>
        )}

        {soldOut ? (
          <div className="mt-4 rounded-2xl border border-line bg-pale px-3.5 py-3">
            <p className="text-[14px] leading-5 font-semibold text-ink">Сейчас нет в наличии</p>
            <p className="mt-0.5 text-[13px] leading-[18px] text-ink-secondary">
              Позиция закончилась на этой точке. Выберите другую кофейню или вернитесь позже.
            </p>
          </div>
        ) : null}
        <p className="mt-4 text-[13px] leading-[18px] text-ink-secondary">
          Оплата на кассе. Платные добавки касса добавит отдельными позициями.
        </p>
        {!check.ok && check.reason ? (
          <p className="mt-2 text-[13px] leading-[18px] text-bad">{check.reason}</p>
        ) : null}
        {volume && selectionText(cfg, sel) ? (
          <p className="mt-2 text-[12px] leading-4 text-ink-tertiary">{selectionText(cfg, sel)}</p>
        ) : null}
      </div>

      <AddonsSheet cfg={cfg} sel={sel} visible={addonsOpen} onChange={setSel} onClose={() => setAddonsOpen(false)} />

      <div
        className="fixed left-0 right-0 max-w-[480px] mx-auto px-4 z-40"
        style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-2xl bg-white border border-line px-1.5 py-1">
            <button
              type="button"
              aria-label="Меньше"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-40"
            >
              <Minus size={16} strokeWidth={2} />
            </button>
            <span className="w-6 text-center text-[15px] num">{quantity}</span>
            <button
              type="button"
              aria-label="Больше"
              onClick={() => setQuantity((q) => Math.min(20, q + 1))}
              className="w-9 h-9 rounded-xl flex items-center justify-center"
            >
              <Plus size={16} strokeWidth={2} />
            </button>
          </div>
          <button
            type="button"
            onClick={add}
            disabled={!check.ok || soldOut}
            className="btn min-h-14 flex-1 flex items-center justify-between gap-3 px-4 disabled:opacity-50"
          >
            <span className="text-[15px] leading-5 font-semibold">
              {lineKey ? 'Сохранить' : 'В заказ'} · {formatPrice(price * quantity)}
            </span>
            <span className="text-[13px] leading-4 opacity-80">{quantity} шт.</span>
          </button>
        </div>
      </div>
    </main>
  )
}

/** «Корица, сиропы, добавки» — подсказка, пока ничего не выбрано. */
function optionSummary(cfg: ProductConfig): string {
  const names = [
    ...(cfg.choice ? cfg.choice.options.map((o) => o.label) : []),
    ...(cfg.addons ?? []).flatMap((g) => g.options.filter((o) => !o.zeroOption).slice(0, 2).map((o) => o.name)),
  ]
  if (!names.length) return 'Добавки'
  return names.slice(0, 3).join(', ')
}
