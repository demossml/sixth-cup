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
        className="guest-sheet w-full max-w-[480px] mx-auto max-h-[85vh] overflow-y-auto"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div
          className="sticky top-0 flex items-start justify-between gap-3 px-5 pt-4 pb-2"
          style={{ background: 'var(--c-paper)' }}
        >
          <div>
            <h2 className="text-[28px] leading-8 font-medium text-[color:var(--c-fg-ink)]">Добавки</h2>
            <p className="mt-1 text-[15px] leading-5 text-[color:var(--c-fg-secondary)]">
              Обязательные параметры — на карточке. Здесь только по желанию.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-[color:var(--c-fg-ink)] shrink-0"
            style={{ boxShadow: 'var(--shadow-btn)' }}
          >
            <X size={20} strokeWidth={1.75} />
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
                      className={`min-h-11 rounded-full px-4 py-2 text-[17px] leading-6 border-2 transition-colors ${
                        active
                          ? 'bg-white text-[color:var(--c-blue)] border-[color:var(--c-blue-ring)] shadow-[inset_0_0_0_1px_var(--c-blue-ring)]'
                          : 'bg-white text-[color:var(--c-fg-ink)] border-[color:var(--c-line)]'
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
                    className={`min-h-11 rounded-full px-4 py-2 text-[17px] leading-6 border-2 transition-colors ${
                      groupEmpty
                        ? 'bg-white text-[color:var(--c-blue)] border-[color:var(--c-blue-ring)] shadow-[inset_0_0_0_1px_var(--c-blue-ring)]'
                        : 'bg-white text-[color:var(--c-fg-ink)] border-[color:var(--c-line)]'
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
                      className={`flex items-center justify-between gap-3 rounded-2xl px-4 py-3 ${
                        o.available ? 'bg-white' : 'bg-[color:var(--c-app)]/5 opacity-60'
                      }`}
                      style={{ boxShadow: 'inset 0 0 0 1px var(--c-line-strong)' }}
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
                            className="w-11 h-11 rounded-full bg-white flex items-center justify-center disabled:opacity-40"
                          >
                            <Minus size={16} strokeWidth={2} />
                          </button>
                          <span className="w-5 text-center text-[15px] num">{qty}</span>
                          <button
                            type="button"
                            aria-label={`Добавить ${o.name}`}
                            disabled={qty >= o.maxCount}
                            onClick={() => onChange(bumpAddon(cfg, sel, o.id, 1))}
                            className="w-11 h-11 rounded-full bg-white flex items-center justify-center disabled:opacity-40"
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

        <div className="sticky bottom-0 px-5 pt-2 pb-3" style={{ background: 'var(--c-paper)', borderTop: '1px solid var(--c-line)' }}>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-full text-white"
            style={{ height: 64, background: 'var(--c-blue)', font: '500 19px/24px var(--font-ui)', boxShadow: 'var(--shadow-btn)' }}
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  )
}
