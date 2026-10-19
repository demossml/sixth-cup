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
    </section>
  )
}
