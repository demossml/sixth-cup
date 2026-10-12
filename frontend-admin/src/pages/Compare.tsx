import { useState } from 'react'
import { useApi } from '../api/useApi'
import { qs } from '../lib/query'
import { fmtNum } from '../lib/format'
import { Card, ErrorBox, KpiTile, PageHeader, Select, Spinner, Tabs } from '../ui/kit'
import type { Dashboard } from '../api/types'

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

export default function Compare() {
  const [left, setLeft] = useState<'24h' | 'yesterday' | '7d' | '30d'>('yesterday')
  const [right, setRight] = useState<'24h' | 'yesterday' | '7d' | '30d'>('24h')
  const a = useApi<Dashboard>(`/dashboard${qs({ period: left })}`)
  const b = useApi<Dashboard>(`/dashboard${qs({ period: right })}`)
  if ((a.loading && !a.data) || (b.loading && !b.data)) return <Spinner />
  if (a.error || b.error) return <ErrorBox message={a.error || b.error || ''} />
  return (
    <>
      <PageHeader title="Сравнение периодов" subtitle="Одинаковые KPI для двух интервалов. Выручка — по интеграции 6.7, не полная касса Эвотор." />
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
          {a.data?.coverage?.note && <p className="mt-2 text-xs text-ink-secondary">{(a.data as any).coverage.note}</p>}
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
        </Card>
      </div>
    </>
  )
}
