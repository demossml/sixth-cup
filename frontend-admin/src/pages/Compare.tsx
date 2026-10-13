import { useState } from 'react'
import { useApi } from '../api/useApi'
import { qs } from '../lib/query'
import { fmtNum } from '../lib/format'
import { Card, ErrorBox, KpiTile, PageHeader, Select, Spinner } from '../ui/kit'
import type { Dashboard } from '../api/types'
import { SimpleBarChart } from '../components/SimpleChart'

type Series = {
  points: { t: string; sellDocs: number; cups: number; revenueRub: number }[]
  totals: { sellDocs: number; sellWithCard: number; cups: number; revenueRub: number; cashbackKop: number; free: number }
  coverage?: { note?: string }
}

function Kpis({ data }: { data: Dashboard | null | undefined }) {
  if (!data) return null
  const ops = (data as any).ops || {}
  const docs = (data as any).docs || {}
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <KpiTile label="Чеки SELL" value={fmtNum(docs.sell ?? 0)} />
      <KpiTile label="С картой (ops)" value={fmtNum(ops.sells ?? 0)} />
      <KpiTile label="Чашки" value={fmtNum(ops.cups ?? 0)} />
      <KpiTile label="Выручка ops, ₽" value={fmtNum(ops.resultRub ?? 0)} />
      <KpiTile label="Без карты" value={fmtNum((data as any).sellWithoutCard ?? 0)} />
      <KpiTile label="Кэшбэк, коп." value={fmtNum(ops.cashbackKopecks ?? 0)} />
    </div>
  )
}

function pct(a: number, b: number): string {
  if (!b) return a ? '+\u221e' : '0%'
  const d = ((a - b) / Math.abs(b)) * 100
  const sign = d > 0 ? '+' : ''
  return `${sign}${d.toFixed(1)}%`
}

export default function Compare() {
  const [left, setLeft] = useState<'24h' | 'yesterday' | '7d' | '30d'>('yesterday')
  const [right, setRight] = useState<'24h' | 'yesterday' | '7d' | '30d'>('24h')
  const a = useApi<Dashboard>(`/dashboard${qs({ period: left })}`)
  const b = useApi<Dashboard>(`/dashboard${qs({ period: right })}`)
  const sa = useApi<Series>(`/analytics/series${qs({ period: left })}`)
  const sb = useApi<Series>(`/analytics/series${qs({ period: right })}`)
  if ((a.loading && !a.data) || (b.loading && !b.data)) return <Spinner />
  if (a.error || b.error) return <ErrorBox message={a.error || b.error || ''} />
  const ta = sa.data?.totals
  const tb = sb.data?.totals
  return (
    <>
      <PageHeader title="Сравнение периодов" subtitle="KPI и динамика. Выручка — по интеграции 6.7, не полная касса Эвотор." />
      {ta && tb && (
        <Card className="mb-4">
          <div className="mb-2 text-sm font-semibold">Δ% (B относительно A)</div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div>Чеки: <b>{pct(tb.sellDocs, ta.sellDocs)}</b></div>
            <div>С картой: <b>{pct(tb.sellWithCard, ta.sellWithCard)}</b></div>
            <div>Чашки: <b>{pct(tb.cups, ta.cups)}</b></div>
            <div>Выручка: <b>{pct(tb.revenueRub, ta.revenueRub)}</b></div>
            <div>Кэшбэк: <b>{pct(tb.cashbackKop, ta.cashbackKop)}</b></div>
            <div>Подарки: <b>{pct(tb.free, ta.free)}</b></div>
          </div>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-semibold">A</span>
            <Select value={left} onChange={(e) => setLeft(e.target.value as typeof left)} className="!w-auto">
              <option value="yesterday">Вчера</option>
              <option value="24h">24 ч</option>
              <option value="7d">7 дн</option>
              <option value="30d">30 дн</option>
            </Select>
          </div>
          <Kpis data={a.data} />
          {sa.data?.points && (
            <div className="mt-3">
              <SimpleBarChart points={sa.data.points.map((p) => ({ t: p.t, value: p.sellDocs }))} label="Чеки" />
            </div>
          )}
        </Card>
        <Card>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-semibold">B</span>
            <Select value={right} onChange={(e) => setRight(e.target.value as typeof right)} className="!w-auto">
              <option value="yesterday">Вчера</option>
              <option value="24h">24 ч</option>
              <option value="7d">7 дн</option>
              <option value="30d">30 дн</option>
            </Select>
          </div>
          <Kpis data={b.data} />
          {sb.data?.points && (
            <div className="mt-3">
              <SimpleBarChart points={sb.data.points.map((p) => ({ t: p.t, value: p.sellDocs }))} label="Чеки" color="#0d9488" />
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
