import { useState } from 'react'
import { useApi } from '../api/useApi'
import { qs } from '../lib/query'
import { fmtNum } from '../lib/format'
import { Card, ErrorBox, KpiTile, PageHeader, Select, Spinner } from '../ui/kit'

type Summary = {
  kpi: { invited: number; active: number; bonusKop: number; bonusRub: number }
  rows: { inviterCard: string; inviteeCard: string; status: string; createdAt: number | null }[]
}

export default function Referrals() {
  const [period, setPeriod] = useState('30d')
  const { data, error, loading } = useApi<Summary>(`/referrals/summary${qs({ period })}`)
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} />
  const k = data?.kpi
  return (
    <>
      <PageHeader
        title="Рефералка"
        subtitle="3% кэшбэка пригласившему после покупок друга"
        actions={
          <Select value={period} onChange={(e) => setPeriod(e.target.value)} className="!w-auto">
            <option value="7d">7 дн</option>
            <option value="30d">30 дн</option>
            <option value="24h">24 ч</option>
          </Select>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiTile label="Приглашено" value={fmtNum(k?.invited ?? 0)} />
        <KpiTile label="С покупкой" value={fmtNum(k?.active ?? 0)} />
        <KpiTile label="Бонус, ₽" value={fmtNum(k?.bonusRub ?? 0)} />
        <KpiTile label="Бонус, коп." value={fmtNum(k?.bonusKop ?? 0)} />
      </div>
      <Card>
        <div className="mb-2 text-sm font-semibold">Связки (до 100)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-ink-secondary">
                <th className="py-1">Пригласивший</th>
                <th>Приглашённый</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5">••{r.inviterCard}</td>
                  <td>••{r.inviteeCard}</td>
                  <td>{r.status === 'active' ? 'покупка была' : 'ожидание'}</td>
                </tr>
              ))}
              {!data?.rows?.length && (
                <tr><td colSpan={3} className="py-4 text-ink-secondary">Пока нет приглашений</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
