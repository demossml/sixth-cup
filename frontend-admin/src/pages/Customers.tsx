import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApi } from '../api/useApi'
import type { CustomerRow } from '../api/types'
import { fmtDate, fmtKopFixed, fmtNum } from '../lib/format'
import { qs, setParams } from '../lib/query'
import { Button, DataTable, ErrorBox, Input, PageHeader, Select, Spinner } from '../ui/kit'
import { HelpLink } from '../components/HelpLink'
import type { Column } from '../ui/kit'

const LIMIT = 50

export default function Customers() {
  const [sp, setSp] = useSearchParams()
  const nav = useNavigate()
  const q = sp.get('q') ?? ''
  const sort = sp.get('sort') ?? 'created'
  const dir = sp.get('dir') === 'asc' ? 'asc' : 'desc'
  const page = Math.max(0, Number(sp.get('page') ?? 0) || 0)
  const [qInput, setQInput] = useState(q)
  useEffect(() => setQInput(q), [q])
  const { data, error, loading, reload } = useApi<{ customers: CustomerRow[]; total: number }>(`/customers${qs({ q, sort, dir, limit: LIMIT, offset: page * LIMIT })}`)
  const patch = (p: Record<string, string | number | null>) => setSp(setParams(sp, p), { replace: true })

  const cols: Column<CustomerRow>[] = [
    { key: 'card', header: 'Карта', primary: true, sortKey: 'created', render: (c) => <span className="font-semibold">{c.cardCode ? `№${c.cardCode}` : `#${c.id}`} <span className="font-normal text-ink-secondary">{c.nickname}</span></span> },
    { key: 'cups', header: 'Чашек', align: 'right', sortKey: 'cups', render: (c) => fmtNum(c.cups) },
    { key: 'paid', header: 'Оплачено', align: 'right', sortKey: 'paid', render: (c) => fmtNum(c.paidTotal) },
    { key: 'cb', header: 'Кэшбэк, ₽', align: 'right', sortKey: 'cashback', render: (c) => fmtKopFixed(c.cashbackBalance) },
    { key: 'ref', header: 'Приглашено', align: 'right', sortKey: 'referrals', render: (c) => fmtNum(c.referrals) },
    { key: 'at', header: 'Регистрация', render: (c) => fmtDate(c.createdAt), hideOnPhone: true },
  ]
  const total = data?.total ?? 0
  return (
    <>
      <PageHeader title="Клиенты" subtitle="Гостевая модель: клиент определяется картой, телефон не хранится" actions={<HelpLink article="map" />} />
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <form onSubmit={(e) => { e.preventDefault(); patch({ q: qInput.trim(), page: null }) }}>
          <Input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Номер карты, id, ник или код приглашения" aria-label="Поиск клиента" />
        </form>
        <Select value={`${sort}:${dir}`} onChange={(e) => { const [s, d] = e.target.value.split(':'); patch({ sort: s, dir: d, page: null }) }} aria-label="Сортировка">
          <option value="created:desc">Новые сверху</option>
          <option value="cups:desc">Больше чашек</option>
          <option value="cashback:desc">Больше кэшбэка</option>
          <option value="referrals:desc">Больше приглашений</option>
        </Select>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner />}
      {data && (
        <>
          <DataTable rows={data.customers} columns={cols} rowKey={(c) => c.id} onRowClick={(c) => nav(`/customers/${c.id}`)} />
          <div className="mt-3 flex items-center justify-between text-sm text-ink-secondary">
            <span>{total ? `${page * LIMIT + 1}–${Math.min(total, (page + 1) * LIMIT)} из ${fmtNum(total)}` : ''}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => patch({ page: page - 1 || null })}>Назад</Button>
              <Button size="sm" variant="secondary" disabled={(page + 1) * LIMIT >= total} onClick={() => patch({ page: page + 1 })}>Дальше</Button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
