/**
 * F12: «Прибыльность» — меню-инжиниринг по реальным чекам.
 *
 * Владелец видит не «сколько стоит чашка», а «что кормит, а что съедает маржу»:
 * позиции раскладываются на звёзды / лошадки / загадки / собак и получают ABC
 * по выручке и по прибыли. Себестоимость берётся из карт — полная, если включены
 * постоянные расходы.
 */
import { useEffect, useMemo, useState } from 'react'

import { Badge, Button, Card, EmptyState, ErrorBox, Select, Skeleton } from '../../ui/kit'
import { Download, RefreshCw } from 'lucide-react'

import { costApi, type MenuEngineering } from '../../lib/costApi'
import { money, pct } from '../../lib/costMath'
import { downloadCsv, csvName } from '../../lib/csv'
import {
  ABC_TONES,
  MENU_CATEGORY_HINTS,
  MENU_CATEGORY_LABELS,
  MENU_CATEGORY_TONES,
  countByCategory,
  filterMenuRows,
  menuCsvHead,
  menuCsvRows,
  type MenuFilter,
} from '../../lib/menuEngineering'

const DAYS: { value: number; label: string }[] = [
  { value: 7, label: '7 дней' },
  { value: 30, label: '30 дней' },
  { value: 90, label: '90 дней' },
]

const FILTERS: MenuFilter[] = ['all', 'star', 'plowhorse', 'puzzle', 'dog', 'none']

export default function MenuTab({
  reloadKey = 0,
  onOpenCard,
}: {
  reloadKey?: number
  onOpenCard: (id: number) => void
}) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<MenuEngineering | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [filter, setFilter] = useState<MenuFilter>('all')

  const load = () => {
    setError(null)
    costApi
      .menuEngineering({ days })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e : new Error('Не удалось загрузить анализ меню')))
  }

  useEffect(load, [reloadKey, days])

  const counts = useMemo(() => (data ? countByCategory(data.rows) : null), [data])
  const rows = useMemo(() => (data ? filterMenuRows(data.rows, filter) : []), [data, filter])

  if (error) return <ErrorBox message={error.message} />
  if (!data) return <Skeleton />

  const empty = data.totals.counted === 0

  return (
    <div>
      {empty && (
        <Card className="mb-3 border-l-4 border-amber">
          <div className="text-sm font-semibold">Пока нечего анализировать</div>
          <div className="text-[12px] text-ink-secondary">{data.note}</div>
        </Card>
      )}

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Продано за период</div>
          <div className="text-lg font-bold">{data.totals.qtySold} шт</div>
          <div className="text-[11px] text-ink-tertiary">
            позиций в анализе: {data.totals.counted} из {data.totals.cards}
          </div>
        </Card>
        <Card className="px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Выручка</div>
          <div className="text-lg font-bold">{money(data.totals.revenueRub)}</div>
        </Card>
        <Card className="px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Прибыль</div>
          <div className="text-lg font-bold">{money(data.totals.profitRub)}</div>
          <div className="text-[11px] text-ink-tertiary">
            {data.overheadEnabled ? 'после сырья и постоянных расходов' : 'после сырья'}
          </div>
        </Card>
        <Card className="px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Маржинальность</div>
          <div className="text-lg font-bold">{pct(data.totals.marginPct)}</div>
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          className="w-36"
          aria-label="Период анализа"
          value={String(days)}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {DAYS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </Select>
        <div className="seg-wrap">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`seg-item ${filter === f ? 'is-on' : ''}`}
            >
              {f === 'all' ? 'Все' : MENU_CATEGORY_LABELS[f]}
              {counts ? ` · ${counts[f]}` : ''}
            </button>
          ))}
        </div>
        <Button variant="secondary" className="ml-auto" onClick={load} aria-label="Обновить анализ">
          <RefreshCw size={14} />
        </Button>
        <Button
          variant="secondary"
          aria-label="Выгрузить анализ в CSV"
          onClick={() => downloadCsv(csvName('прибыльность-меню'), menuCsvHead(), menuCsvRows(rows))}
        >
          <Download size={14} /> CSV
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="В этой категории пусто"
          text={
            filter === 'all'
              ? 'Проверьте период: за выбранные дни чеков нет.'
              : 'Попробуйте другую категорию или увеличьте период.'
          }
        />
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-tertiary">
                  <th className="px-3 py-2">Позиция</th>
                  <th className="px-3 py-2">Категория</th>
                  <th className="px-3 py-2">ABC</th>
                  <th className="px-3 py-2 text-right">Продано</th>
                  <th className="px-3 py-2 text-right">Выручка</th>
                  <th className="px-3 py-2 text-right">Маржа/порция</th>
                  <th className="px-3 py-2 text-right">Маржин.</th>
                  <th className="px-3 py-2 text-right">Доля прибыли</th>
                  <th className="px-3 py-2">Совет</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.cardId}
                    className="cursor-pointer border-b border-line/60 hover:bg-surface-2"
                    onClick={() => onOpenCard(r.cardId)}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-[11px] text-ink-tertiary">
                        {r.qtySold > 0
                          ? `средняя цена ${money(r.avgPriceRub)} · себестоимость ${money(r.costPerUnitRub)}`
                          : (r.reason ?? '—')}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={MENU_CATEGORY_TONES[r.category]}>{MENU_CATEGORY_LABELS[r.category]}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {r.abcRevenue && (
                          <Badge tone={ABC_TONES[r.abcRevenue]}>{`выручка ${r.abcRevenue}`}</Badge>
                        )}
                        {r.abcProfit && <Badge tone={ABC_TONES[r.abcProfit]}>{`прибыль ${r.abcProfit}`}</Badge>}
                        {!r.abcRevenue && <span className="text-ink-tertiary">—</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">{r.qtySold || '—'}</td>
                    <td className="px-3 py-2 text-right">{money(r.revenueRub)}</td>
                    <td
                      className={`px-3 py-2 text-right ${r.marginPerUnitRub != null && r.marginPerUnitRub <= 0 ? 'font-semibold text-bad' : ''}`}
                    >
                      {money(r.marginPerUnitRub)}
                    </td>
                    <td className="px-3 py-2 text-right">{pct(r.marginPct)}</td>
                    <td className="px-3 py-2 text-right">{r.qtySold > 0 ? pct(r.shareProfitPct) : '—'}</td>
                    <td className="max-w-[280px] px-3 py-2 text-[12px] text-ink-secondary">{r.advice}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="mt-3 text-[11px] text-ink-tertiary">
        {data.note} Порог популярности:{' '}
        {data.thresholds.popularityQty == null ? '—' : data.thresholds.popularityQty.toFixed(1).replace('.', ',')} шт за{' '}
        {data.window.days} дн. · средняя маржа {money(data.thresholds.marginPerUnitRub)} на порцию.
      </div>
      <div className="mt-1 text-[11px] text-ink-tertiary">
        {(['star', 'plowhorse', 'puzzle', 'dog'] as const)
          .map((c) => `${MENU_CATEGORY_LABELS[c]} — ${MENU_CATEGORY_HINTS[c]}`)
          .join(' · ')}
      </div>
    </div>
  )
}
