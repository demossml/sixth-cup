import { cartTotal, type CartLine } from '../../lib/preorderApi'
import { X } from '../../lib/icons'

type StoreOption = { id: number; name: string }

type Props = {
  open: boolean
  lines: CartLine[]
  /** Выбранная кофейня: одна точка — фиксирована, несколько — выбор в корзине. */
  storeId: number | null
  stores: StoreOption[]
  storeName?: string
  onChange: (lines: CartLine[]) => void
  onStoreChange: (id: number) => void
  onClose: () => void
  onSubmit: () => void
  submitting?: boolean
  error?: string | null
  /** Почему заказ нельзя отправить (бан за невыкуп): показываем вместо кнопки-обманки. */
  blocked?: string | null
}

/** Корзина предзаказа: локальная (sessionStorage), оплата и бонусы — на кассе. */
export function CartSheet({ open, lines, storeId, stores, storeName, onChange, onStoreChange, onClose, onSubmit, submitting, error, blocked }: Props) {
  if (!open) return null
  const total = cartTotal(lines)
  const needStore = stores.length !== 1 && storeId == null
  const isBlocked = Boolean(blocked)

  const setQty = (line: CartLine, quantity: number) => {
    if (quantity <= 0) onChange(lines.filter((x) => x.key !== line.key))
    else onChange(lines.map((x) => (x.key === line.key ? { ...x, quantity } : x)))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/45" role="presentation" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Корзина"
        className="w-full max-w-[480px] mx-auto max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-[28px] bg-page shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-page/95 backdrop-blur-sm px-5 pt-4 pb-2 flex items-center justify-between gap-3">
          <h2 className="font-display text-[20px] leading-6 font-semibold text-ink">Корзина</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть корзину"
            className="w-11 h-11 rounded-full bg-white border border-line flex items-center justify-center text-ink"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-5 pb-5">
          {stores.length === 1 ? (
            storeName ? <p className="text-[13px] leading-4 text-ink-secondary mb-3">{storeName}</p> : null
          ) : stores.length > 1 ? (
            <label className="block mb-3">
              <span className="block text-[12px] leading-4 text-ink-secondary mb-1">Кофейня</span>
              <select
                value={storeId ?? ''}
                onChange={(e) => onStoreChange(Number(e.target.value))}
                className="w-full min-h-11 rounded-xl border border-line bg-white px-3 text-[15px] text-ink"
              >
                <option value="">Выберите кофейню…</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          ) : null}

          {lines.length === 0 ? (
            <p className="text-ink-secondary text-sm py-6 text-center">Пусто</p>
          ) : (
            <ul className="space-y-2">
              {lines.map((l) => (
                <li key={l.key} className="bg-white border border-line rounded-2xl px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <b className="text-[15px] leading-5 text-ink min-w-0 break-words">{l.name}</b>
                    <span className="num text-[15px] leading-5 text-ink whitespace-nowrap">{l.unitPriceEstimate * l.quantity} ₽</span>
                  </div>
                  {l.configText ? <div className="text-[12px] leading-4 text-ink-secondary mt-0.5">{l.configText}</div> : null}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Меньше: ${l.name}`}
                      onClick={() => setQty(l, l.quantity - 1)}
                      className="w-9 h-9 rounded-full border border-line bg-page text-ink text-[18px] leading-none"
                    >
                      −
                    </button>
                    <span className="num text-[15px] w-6 text-center">{l.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Больше: ${l.name}`}
                      onClick={() => setQty(l, Math.min(99, l.quantity + 1))}
                      className="w-9 h-9 rounded-full border border-line bg-page text-ink text-[18px] leading-none"
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-[12px] leading-4 text-ink-secondary">
            Финальная цена и чек — на кассе. Стаканы и кэшбэк начисляются там же, по карте лояльности.
          </p>
          <div className="mt-2 font-display text-[20px] leading-6 font-semibold text-ink num">Итого — оценка {total} ₽</div>

          {blocked && (
            <p role="status" className="mt-2 rounded-xl bg-warn-bg text-warn px-3 py-2 text-[13px] leading-[18px]">
              {blocked}
            </p>
          )}
          {error && <p role="alert" className="mt-2 text-[13px] leading-[18px] text-bad">{error}</p>}

          <button
            type="button"
            disabled={!lines.length || submitting || needStore || isBlocked}
            onClick={onSubmit}
            className="btn min-h-12 w-full mt-3 disabled:opacity-50"
          >
            {submitting ? 'Создаём…' : 'Собрать заказ'}
          </button>
        </div>
      </section>
    </div>
  )
}
