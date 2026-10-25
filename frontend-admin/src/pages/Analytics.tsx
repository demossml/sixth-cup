import { useMemo, useState } from 'react'
import { useApi } from '../api/useApi'
import { useSyncStores } from '../api/useStores'
import { qs } from '../lib/query'
import { fmtKop, fmtNum } from '../lib/format'
import {
  PageHeader, Card, EmptyState, ErrorBox, KpiTile, Select, Skeleton, Tabs,
} from '../ui/kit'
import { HelpLink } from '../components/HelpLink'
import { SimpleBarChart } from '../components/SimpleChart'

type Period = '24h' | '7d' | '30d' | 'yesterday'

type SeriesPoint = {
  t: string
  sellDocs: number
  sellWithCard?: number
  cups: number
  revenueRub: number
  cashbackKop?: number
  free?: number
}

type SeriesResp = {
  period: string
  grain?: string
  points?: SeriesPoint[]
  series?: SeriesPoint[]
  totals?: {
    sellDocs?: number
    cups?: number
    revenueRub?: number
    cashbackKop?: number
    free?: number
    sellWithCard?: number
  }
}

type ByStoreRow = {
  storeUuid: string
  storeName?: string | null
  name?: string | null
  sellDocs?: number
  cups?: number
  revenueRub?: number
  resultRub?: number
}

type TopProduct = { name: string; category: string; qty: number; revenue: number; trendPct: number | null }
type Overview = {
  revenueRub: number
  checks: number
  cups: number
  avgCheckRub: number
  cashbackKop: number
  freeCups: number
  cardShare: number
  newCustomers: number
  prev: { revenueRub: number; checks: number }
  topProducts: TopProduct[]
  byCategory: { name: string; revenue: number }[]
  note?: string
}
type Heat = { grid: number[][]; days: string[]; total: number }

function pointsOf(data: SeriesResp | null): SeriesPoint[] {
  if (!data) return []
  return data.points ?? data.series ?? []
}

export default function Analytics() {
  const [period, setPeriod] = useState<Period>('7d')
  const [store, setStore] = useState('')
  const { stores: syncStores } = useSyncStores()

  const path = useMemo(
    () => `/analytics/series?${qs({ period, storeUuid: store || undefined })}`,
    [period, store],
  )
  const byStorePath = useMemo(
    () => `/analytics/by-store?${qs({ period })}`,
    [period],
  )

  const series = useApi<SeriesResp>(path)
  const byStore = useApi<{ stores?: ByStoreRow[]; rows?: ByStoreRow[] }>(byStorePath)
  const overviewPath = useMemo(() => `/analytics/overview?${qs({ period, storeUuid: store || undefined })}`, [period, store])
  const heatmapPath = useMemo(() => `/analytics/heatmap?${qs({ period, storeUuid: store || undefined })}`, [period, store])
  const overview = useApi<Overview>(overviewPath)
  const heat = useApi<Heat>(heatmapPath)

  const pts = pointsOf(series.data)
  const totals = series.data?.totals
  const sum = (key: keyof SeriesPoint) =>
    totals?.[key as keyof typeof totals] != null
      ? Number(totals[key as keyof typeof totals])
      : pts.reduce((s, p) => s + (Number(p[key]) || 0), 0)

  const chartData = pts.map((p) => ({
    t: p.t,
    value: Number(p.revenueRub) || Number(p.sellDocs) || 0,
  }))

  const storeRows = byStore.data?.stores ?? byStore.data?.rows ?? []

  return (
    <section className="view is-active" data-view="analytics">
      <div className="page-head">
        <div>
          <h1>Аналитика</h1>
          <p className="page-sub">Выручка, чеки, чашки по периоду и точкам</p>
        </div>
        <div className="head-actions">
          <HelpLink article="principles" />
          <select className="btn btn-ghost" style={{ height: 35 }} value={store} onChange={(e) => setStore(e.target.value)} aria-label="Точка">
            <option value="">Все точки</option>
            {syncStores.map((s) => (
              <option key={s.uuid} value={s.uuid}>{s.name ?? s.uuid.slice(0, 8)}</option>
            ))}
          </select>
        </div>
      </div>

      <Tabs
        items={[
          { key: 'yesterday', label: 'Вчера' },
          { key: '24h', label: '24 часа' },
          { key: '7d', label: '7 дней' },
          { key: '30d', label: '30 дней' },
        ]}
        value={period}
        onChange={(k) => setPeriod(k as Period)}
      />

      {series.loading && <Skeleton className="mb-4 h-28" />}
      {series.error && <div className="mb-4"><ErrorBox message={series.error} onRetry={series.reload} /></div>}

      {!series.loading && !series.error && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiTile label="Чеки SELL" value={fmtNum(sum('sellDocs'))} />
          <KpiTile label="Чашки" value={fmtNum(sum('cups'))} />
          <KpiTile label="Выручка" value={`${fmtNum(sum('revenueRub'))} ₽`} />
          <KpiTile label="Кэшбэк" value={fmtKop(sum('cashbackKop'))} sub="начислено" />
        </div>
      )}

      <Card className="mb-4">
        <div className="mb-2 text-[14px] font-semibold">Динамика</div>
        {series.loading && <Skeleton className="h-40" />}
        {!series.loading && !pts.length && (
          <EmptyState title="Нет точек ряда" text="За период нет продаж или синк ещё не подтянул документы." />
        )}
        {!!chartData.length && (
          <SimpleBarChart points={chartData} height={180} color="#0f172a" label="Выручка / чеки" />
        )}
      </Card>

      <Card pad={false}>
        <div className="border-b border-line px-4 py-3 text-[14px] font-semibold">По точкам</div>
        {byStore.loading && <div className="p-4"><Skeleton className="h-20" /></div>}
        {byStore.error && <div className="p-4"><ErrorBox message={byStore.error} /></div>}
        {byStore.data && !storeRows.length && (
          <EmptyState title="Нет разбивки по точкам" text="Включите синхронизацию магазинов в разделе Касса." />
        )}
        {!!storeRows.length && (
          <div className="admin-scroll-x">
            <table className="w-full min-w-[480px] text-left text-[13px]">
              <thead className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-ink-tertiary">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Точка</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Чеки</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Чашки</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Выручка</th>
                </tr>
              </thead>
              <tbody>
                {storeRows.map((r) => (
                  <tr key={r.storeUuid} className="border-b border-line/70 last:border-0">
                    <td className="px-4 py-2.5 font-medium">{r.storeName ?? r.name ?? r.storeUuid.slice(0, 8)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmtNum(r.sellDocs ?? 0)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmtNum(r.cups ?? 0)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {fmtNum(r.revenueRub ?? r.resultRub ?? 0)} ₽
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <div className="mb-3 text-[14px] font-semibold">Обзор периода</div>
        {overview.loading && <Skeleton className="h-24" />}
        {overview.error && <ErrorBox message={overview.error} onRetry={overview.reload} />}
        {overview.data && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KpiTile label="Средний чек" value={`${fmtNum(Math.round(overview.data.avgCheckRub))} ₽`} />
              <KpiTile label="Доля с картой" value={`${Math.round(overview.data.cardShare * 100)}%`} sub="от чеков SELL" />
              <KpiTile label="Бесплатных" value={fmtNum(overview.data.freeCups)} sub="чашек по карте" />
              <KpiTile label="Новых клиентов" value={fmtNum(overview.data.newCustomers)} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-2 text-[13px] font-semibold">Топ товаров</div>
                {!overview.data.topProducts.length && (
                  <p className="text-xs text-ink-secondary">Нет продаж с позициями за период.</p>
                )}
                <ul className="space-y-1.5">
                  {overview.data.topProducts.slice(0, 7).map((p) => (
                    <li key={p.name} className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="min-w-0 truncate">
                        {p.name}
                        <span className="ml-1 text-[11px] text-ink-tertiary">{p.category}</span>
                      </span>
                      <span className="shrink-0 font-mono">
                        {fmtNum(Math.round(p.revenue))} ₽
                        {p.trendPct != null && (
                          <span className={p.trendPct >= 0 ? ' ml-2 text-[11px] text-ink-secondary' : ' ml-2 text-[11px] text-ink-secondary'}>
                            {p.trendPct >= 0 ? '+' : ''}{p.trendPct}%
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-2 text-[13px] font-semibold">По группам</div>
                {!overview.data.byCategory.length && (
                  <p className="text-xs text-ink-secondary">Нет данных за период.</p>
                )}
                <ul className="space-y-1.5">
                  {overview.data.byCategory.slice(0, 7).map((c) => {
                    const max = Math.max(...overview.data!.byCategory.map((x) => Number(x.revenue) || 0), 1)
                    const w = Math.round((Number(c.revenue) / max) * 100)
                    return (
                      <li key={c.name} className="text-[13px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">{c.name}</span>
                          <span className="shrink-0 font-mono">{fmtNum(Math.round(Number(c.revenue)))} ₽</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                          <div className="h-1.5 rounded-full bg-brand" style={{ width: `${w}%` }} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
            {overview.data.note && <p className="mt-3 text-[11px] text-ink-tertiary">{overview.data.note}</p>}
          </>
        )}
      </Card>

      <Card className="mt-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[14px] font-semibold">Теплокарта по часам</div>
          {heat.data && <span className="text-[11px] text-ink-secondary">чеков с картой: {heat.data.total}</span>}
        </div>
        {heat.loading && <Skeleton className="h-32" />}
        {heat.error && <ErrorBox message={heat.error} onRetry={heat.reload} />}
        {heat.data && !heat.data.total && (
          <p className="text-xs text-ink-secondary">Нет чеков с картой за период — теплокарта пустая.</p>
        )}
        {!!heat.data?.total && (
          <div className="overflow-x-auto">
            <table className="min-w-[560px] border-separate border-spacing-[2px] text-[10px]">
              <thead>
                <tr>
                  <th />
                  {Array.from({ length: 24 }, (_, h) => (
                    <th key={h} className="font-normal text-ink-tertiary">{h % 3 === 0 ? h : ''}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heat.data.grid.map((row, d) => {
                  const max = Math.max(1, ...heat.data!.grid.flat())
                  return (
                    <tr key={d}>
                      <td className="pr-1 text-right text-ink-secondary">{heat.data!.days[d]}</td>
                      {row.map((v, h) => (
                        <td key={h}>
                          <div
                            title={`${heat.data!.days[d]}, ${h}:00 — ${v}`}
                            className="h-5 w-5 rounded-[3px]"
                            style={{ backgroundColor: v ? `rgba(11,74,141,${0.12 + 0.8 * (v / max)})` : 'rgba(0,0,0,0.05)' }}
                          />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  )
}
