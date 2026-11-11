/** F5: вкладка «Сигналы» — где деньги теряются: нет цены, нулевая себестоимость, низкая маржа. */
import { useEffect, useState } from 'react'

import { Badge, Button, Card, EmptyState, ErrorBox, Input, Skeleton, useToast } from '../../ui/kit'
import { RefreshCw, ArrowRight } from 'lucide-react'

import { costApi, type CostItem } from '../../lib/costApi'
import { COST_SOURCE_LABELS, UNIT_LABELS, money } from '../../lib/costMath'

const CODE_LABELS: Record<string, string> = {
  no_cost: 'себестоимость не посчитана',
  no_price: 'нет цены у сырья',
  no_retail: 'не задана цена продажи',
  high_food_cost: 'высокий фудкост',
  negative_margin: 'отрицательная маржа',
}

export default function SignalsTab({ onOpenCard }: { onOpenCard: (id: number) => void }) {
  const toast = useToast()
  /** Черновики «ручной цены»: правим здесь, чтобы не уходить в склад. */
  const [manual, setManual] = useState<Record<number, string>>({})
  const [rows, setRows] = useState<Awaited<ReturnType<typeof costApi.insights>> | null>(null)
  const [items, setItems] = useState<CostItem[] | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const load = () => {
    setError(null)
    Promise.all([costApi.insights(), costApi.items({ problems: true })])
      .then(([i, it]) => {
        setRows(i)
        setItems(it.items)
      })
      .catch((e) => setError(e instanceof Error ? e : new Error('Не удалось загрузить сигналы')))
  }

  useEffect(load, [])

  if (error) return <ErrorBox message={error.message} />
  if (!rows || !items) return <Skeleton />

  const empty = rows.rows.length === 0 && items.length === 0

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm text-ink-secondary">
          Карт с замечаниями: {new Set(rows.rows.map((r) => r.cardId)).size} · позиций склада без цены: {items.length}
        </span>
        <Button variant="secondary" className="ml-auto" onClick={load} aria-label="Обновить сигналы">
          <RefreshCw size={14} />
        </Button>
      </div>

      {empty && <EmptyState title="Всё заполнено" text="Ни одной карты с проблемами: цены, маржа и фудкост в порядке." />}

      {rows.rows.length > 0 && (
        <Card className="mb-3">
          <div className="mb-2 text-sm font-semibold">Техкарты</div>
          <div className="grid gap-1.5">
            {rows.rows.map((r) => (
              <button
                key={`${r.cardId}-${r.code}-${r.text}`}
                type="button"
                onClick={() => onOpenCard(r.cardId)}
                className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-brand/40"
              >
                <Badge tone={r.tone === 'bad' ? 'bad' : 'warn'}>{CODE_LABELS[r.code] ?? r.code}</Badge>
                <span className="font-medium">{r.name}</span>
                <span className="text-ink-tertiary">{r.text}</span>
                <ArrowRight size={14} className="ml-auto text-ink-tertiary" />
              </button>
            ))}
          </div>
        </Card>
      )}

      {items.length > 0 && (
        <Card>
          <div className="mb-2 text-sm font-semibold">Ингредиенты склада</div>
          <div className="grid gap-1.5">
            {items.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <span className="font-medium">{i.name}</span>
                <span className="text-[11px] text-ink-tertiary">
                  {money(i.costRub)}/{UNIT_LABELS[i.unit]} · {COST_SOURCE_LABELS[i.costSource]}
                </span>
                {i.problems.map((p) => (
                  <Badge key={p} tone="warn">
                    {p}
                  </Badge>
                ))}
                <div className="ml-auto flex items-center gap-1.5">
                  <Input
                    className="w-24"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="цена, ₽"
                    aria-label={`Ручная цена: ${i.name}`}
                    value={manual[i.id] ?? ''}
                    onChange={(e) => setManual((m) => ({ ...m, [i.id]: e.target.value }))}
                  />
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      const raw = manual[i.id]
                      if (raw == null || raw === '') return
                      try {
                        await costApi.updateItem(i.id, { manualCostRub: Number(raw) })
                        toast.push(`Цена «${i.name}» сохранена`, 'ok')
                        setManual((m) => ({ ...m, [i.id]: '' }))
                        load()
                      } catch (e) {
                        toast.push(e instanceof Error ? e.message : 'Не удалось сохранить цену', 'bad')
                      }
                    }}
                  >
                    Сохранить
                  </Button>
                  <span className="text-[11px] text-ink-tertiary">в картах: {i.cards}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
