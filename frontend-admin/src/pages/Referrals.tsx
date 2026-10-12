import { useApi } from '../api/useApi'
import { fmtNum } from '../lib/format'
import { Card, EmptyState, ErrorBox, PageHeader, Spinner } from '../ui/kit'

type Row = {
  referrerId: number
  referrerCard: string
  invited: number
  withPurchase: number
  cashbackKop: number
}

export default function Referrals() {
  const { data, error, loading, reload } = useApi<{ referrers: Row[] }>('/referrals')
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  const rows = data?.referrers ?? []
  return (
    <>
      <PageHeader title="Рефералка" subtitle="Приглашённые и кэшбэк с покупок друзей (только серверные данные)" />
      {!rows.length ? (
        <Card><EmptyState title="Пока нет приглашений" text="Появятся, когда гость создаст карту по invite-ссылке и друг совершит покупку." /></Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line">
                <th className="py-2">Карта</th>
                <th>Пригласил</th>
                <th>С покупкой</th>
                <th>Кэшбэк, ₽</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.referrerId} className="border-b border-line/60">
                  <td className="py-2 font-semibold">#{r.referrerCard}</td>
                  <td>{fmtNum(r.invited)}</td>
                  <td>{fmtNum(r.withPurchase)}</td>
                  <td>{(r.cashbackKop / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  )
}
