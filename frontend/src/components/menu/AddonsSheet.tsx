import { Minus, Plus, X } from 'lucide-react'
import { bumpAddon, clearAddonGroup, type ProductConfig, type Selection } from '../../lib/menuConfig'

type Props = {
  cfg: ProductConfig
  sel: Selection
  visible: boolean
  onChange: (sel: Selection) => void
  onClose: () => void
}

/**
 * Параметры «по желанию»: обязательный выбор без цены (radio) и добавки со степперами.
 * Обязательные параметры (объём, молоко) остаются на карточке товара.
 */
export default function AddonsSheet({ cfg, sel, visible, onChange, onClose }: Props) {
  if (!visible) return null
  const hasChoice = !!cfg.choice && cfg.choice.options.length > 0
  const groups = cfg.addons ?? []
  if (!hasChoice && !groups.length) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-ink/40" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Добавки"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] mx-auto bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="sticky top-0 bg-white px-5 pt-4 pb-2 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[20px] leading-6 font-semibold text-ink">Добавки</h2>
            <p className="mt-1 text-[13px] leading-[18px] text-ink-secondary">
              Обязательные параметры — на карточке. Здесь только по желанию.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="w-10 h-10 rounded-full bg-white border border-line flex items-center justify-center text-ink shrink-0"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-5 pb-4 space-y-4">
          {hasChoice && cfg.choice && (
            <section>
              <h3 className="text-[13px] leading-[18px] font-semibold text-ink mb-2">{cfg.choice.title}</h3>
              <div className="flex flex-wrap gap-1.5">
                {cfg.choice.options.map((o) => {
                  const active = sel.choiceId === o.id
                  return (
                    <button
                      key={o.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onChange({ ...sel, choiceId: o.id })}
                      className={`rounded-full px-3.5 py-2 text-[14px] leading-5 border transition-colors ${
                        active ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line active:bg-brand-tint'
                      }`}
                    >
                      {o.label}
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {groups.map((g) => {
            const zero = g.options.filter((o) => o.zeroOption)
            const addons = g.options.filter((o) => !o.zeroOption)
            const groupEmpty = addons.every((o) => !(sel.addons[o.id] ?? 0))
            return (
            <section key={g.key}>
              <h3 className="text-[13px] leading-[18px] font-semibold text-ink mb-2">{g.label}</h3>
              {zero.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <button
                    type="button"
                    aria-pressed={groupEmpty}
                    onClick={() => onChange(clearAddonGroup(cfg, sel, g.key))}
                    className={`rounded-full px-3.5 py-2 text-[14px] leading-5 border transition-colors ${
                      groupEmpty ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line'
                    }`}
                  >
                    Без
                  </button>
                </div>
              )}
              <ul className="space-y-2">
                {addons.map((o) => {
                  const qty = sel.addons[o.id] ?? 0
                  return (
                    <li
                      key={o.id}
                      className={`flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-3 ${
                        o.available ? 'border-line bg-white' : 'border-line bg-pale/60 opacity-60'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-[15px] leading-5 text-ink truncate">{o.name}</div>
                        <div className="text-[12px] leading-4 text-ink-secondary num">
                          {o.priceRub > 0 ? `${o.priceRub} ₽` : 'бесплатно'}
                          {o.maxCount > 1 ? ` · до ${o.maxCount}` : ''}
                        </div>
                      </div>
                      {o.available ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            aria-label={`Убрать ${o.name}`}
                            disabled={qty === 0}
                            onClick={() => onChange(bumpAddon(cfg, sel, o.id, -1))}
                            className="w-9 h-9 rounded-full border border-line bg-white flex items-center justify-center disabled:opacity-40"
                          >
                            <Minus size={16} strokeWidth={2} />
                          </button>
                          <span className="w-5 text-center text-[15px] num">{qty}</span>
                          <button
                            type="button"
                            aria-label={`Добавить ${o.name}`}
                            disabled={qty >= o.maxCount}
                            onClick={() => onChange(bumpAddon(cfg, sel, o.id, 1))}
                            className="w-9 h-9 rounded-full border border-line bg-white flex items-center justify-center disabled:opacity-40"
                          >
                            <Plus size={16} strokeWidth={2} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-[12px] leading-4 text-ink-secondary shrink-0">закончилось</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
            )
          })}
        </div>

        <div className="sticky bottom-0 bg-white px-5 pt-2 pb-3 border-t border-line">
          <button type="button" onClick={onClose} className="btn min-h-12 w-full">
            Готово
          </button>
        </div>
      </div>
    </div>
  )
}
