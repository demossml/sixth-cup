/** F9: «Сводка» на модели v2 — фудкост и маржа по всем картам, а не по старым рецептам. */
import { useEffect, useState } from 'react'

import { Badge, Button, Card, EmptyState, ErrorBox, Skeleton } from '../../ui/kit'
import { RefreshCw } from 'lucide-react'

import { costApi } from '../../lib/costApi'
import { KIND_LABELS, money, pct } from '../../lib/costMath'
import { csvName } from '../../lib/csv'

type Overview = Awaited<ReturnType<typeof costApi.overview>>

export default function OverviewTab({ onOpenCard, reloadKey = 0 }: { onOpenCard: (id: number) => void; reloadKey?: number }) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const load = () => {
    setError(null)
    costApi
      .overview()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e : new Error('Не удалось загрузить сводку')))
  }

  useEffect(load, [reloadKey])

  if (error) return <ErrorBox message={error.message} />
  if (!data) return <Skeleton />

  if (data.cardsTotal === 0) {
    return <EmptyState title="Пока нечего считать" text="Заведите техкарты — здесь появится фудкост и маржа по меню." />
  }

  const sorted = [...data.cards].sort((a, b) => (b.foodCostPct ?? -1) - (a.foodCostPct ?? -1))

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Card className="px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Карт</div>
          <div className="text-lg font-bold">{data.cardsTotal}</div>
        </Card>
        <Card className="px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Средний фудкост</div>
          <div className="text-lg font-bold">{pct(data.avgFoodCostPct)}</div>
        </Card>
        <Card className="px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">С замечаниями</div>
          <div className="text-lg font-bold">{data.problems}</div>
        </Card>
        <Button variant="secondary" className="ml-auto" onClick={load} aria-label="Обновить сводку">
          <RefreshCw size={14} />
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            // Свой файл: у сводки «своя» шапка и русские числа с запятой.
            const head = ['Техкарта', 'Тип', 'Себестоимость, ₽', 'Цена, ₽', 'Фудкост, %', 'Маржа, ₽', 'Замечания']
            const rows = sorted.map((c) => [
              c.name,
              KIND_LABELS[c.kind] ?? c.kind,
              c.costPerUnitRub == null ? '' : c.costPerUnitRub.toFixed(2).replace('.', ','),
              c.retailRub == null ? '' : c.retailRub.toFixed(2).replace('.', ','),
              c.foodCostPct == null ? '' : String(c.foodCostPct).replace('.', ','),
              c.marginRub == null ? '' : c.marginRub.toFixed(2).replace('.', ','),
              c.insights.map((i) => i.text).join(' · '),
            ])
            const csv = [head, ...rows]
              .map((r) => r.map((v) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(';'))
              .join('\n')
            const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = csvName('себестоимость-меню')
            document.body.appendChild(a)
            a.click()
            a.remove()
            URL.revokeObjectURL(url)
          }}
          aria-label="Выгрузить сводку в CSV"
        >
          CSV
        </Button>
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-tertiary">
                <th className="px-3 py-2">Техкарта</th>
                <th className="px-3 py-2">Себестоимость</th>
                <th className="px-3 py-2">Цена</th>
                <th className="px-3 py-2">Фудкост</th>
                <th className="px-3 py-2">Маржа</th>
                <th className="px-3 py-2">Замечания</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id} className="cursor-pointer border-b border-line/60 hover:bg-surface-2" onClick={() => onOpenCard(c.id)}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-[11px] text-ink-tertiary">{KIND_LABELS[c.kind] ?? c.kind}</div>
                  </td>
                  <td className="px-3 py-2">{money(c.costPerUnitRub)}</td>
                  <td className="px-3 py-2">{money(c.retailRub)}</td>
                  <td className={`px-3 py-2 ${c.foodCostPct != null && c.foodCostPct > 35 ? 'font-semibold text-bad' : ''}`}>{pct(c.foodCostPct)}</td>
                  <td className="px-3 py-2">{money(c.marginRub)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {c.insights.map((i) => (
                        <Badge key={i.code} tone={i.tone === 'bad' ? 'bad' : 'warn'}>
                          {i.text}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
