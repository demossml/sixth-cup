import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { adminFetch } from '../../api/client'
import { formatKopToRub, formatMoneyRub, formatTs } from '../../lib/format'
import { PageHeader } from '../../ui/PageHeader'
import { EmptyState } from '../../ui/EmptyState'

type Row = {
  id: number
  cardCode: string | null
  nickname: string
  paidTotal: number
  cashbackBalance: number
  createdAt: number
}

export function CustomersPage() {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Row[]>([])
  const [err, setErr] = useState('')

  function load(query = q) {
    const params = new URLSearchParams({ limit: '50' })
    if (query.trim()) params.set('q', query.trim())
    adminFetch<{ items: Row[] }>(`/customers?${params}`)
      .then((r) => setItems(r.items))
      .catch((e) => setErr(e.message))
  }

  useEffect(() => {
    load('')
  }, [])

  return (
    <div className="space-y-4">
      <PageHeader title="Клиенты" subtitle="Поиск по коду карты или нику (без телефонов в списке)" />
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-xl border border-line px-3 py-2 text-sm"
          placeholder="12 или ник"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <button type="button" onClick={() => load()} className="rounded-xl bg-brand text-white px-4 py-2 text-sm">
          Найти
        </button>
      </div>
      {err ? <p className="text-red-600 text-sm">{err}</p> : null}
      {!items.length ? (
        <EmptyState title="Никого не найдено" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line">
                <th className="p-3">Карта</th>
                <th>Ник</th>
                <th className="text-right">Стаканы</th>
                <th className="text-right pr-3">Кэшбэк</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b border-line/50">
                  <td className="p-3">
                    <Link className="text-brand font-medium" to={`/customers/${it.id}`}>
                      {it.cardCode ?? it.id}
                    </Link>
                  </td>
                  <td>{it.nickname}</td>
                  <td className="text-right tabular-nums">{it.paidTotal}</td>
                  <td className="text-right pr-3 tabular-nums">{formatKopToRub(it.cashbackBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function CustomerDetailPage() {
  const { id = '' } = useParams()
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    adminFetch(`/customers/${id}`)
      .then(setData)
      .catch((e) => setErr(e.message))
  }, [id])

  if (err) return <p className="text-red-600 text-sm">{err}</p>
  if (!data) return <p className="text-sm text-ink-secondary">Загрузка…</p>
  const c = data.customer

  return (
    <div className="space-y-4">
      <PageHeader title={`Карта ${c.cardCode ?? c.id}`} subtitle={c.nickname} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-white border border-line p-3">
          <div className="text-xs text-ink-secondary">Оплачено стаканов</div>
          <div className="text-xl font-bold">{c.paidTotal}</div>
        </div>
        <div className="rounded-2xl bg-white border border-line p-3">
          <div className="text-xs text-ink-secondary">Бесплатных использовано</div>
          <div className="text-xl font-bold">{c.freeUsed}</div>
        </div>
        <div className="rounded-2xl bg-white border border-line p-3">
          <div className="text-xs text-ink-secondary">Кэшбэк</div>
          <div className="text-xl font-bold">{formatKopToRub(c.cashbackBalance)}</div>
        </div>
        <div className="rounded-2xl bg-white border border-line p-3">
          <div className="text-xs text-ink-secondary">С</div>
          <div className="text-sm">{formatTs(c.createdAt)}</div>
        </div>
      </div>
      {data.explain?.length ? (
        <ul className="text-sm text-ink-secondary list-disc pl-5">
          {data.explain.map((x: string) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : null}
      <div className="rounded-2xl bg-white border border-line p-4">
        <h2 className="font-semibold mb-2">Операции</h2>
        {!data.ops?.length ? (
          <EmptyState title="Нет операций" />
        ) : (
          <ul className="text-sm space-y-1">
            {data.ops.map((o: any) => (
              <li key={o.docId + o.createdAt}>
                <Link className="text-brand" to={`/operations/${encodeURIComponent(o.storeUuid)}/${encodeURIComponent(o.docId)}`}>
                  {o.docId?.slice(0, 8)}
                </Link>{' '}
                · cups {o.cups} · {formatMoneyRub(o.resultRub)} · {formatTs(o.createdAt)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-2xl bg-white border border-line p-4">
        <h2 className="font-semibold mb-2">Кэшбэк ledger</h2>
        {!data.cashback?.length ? (
          <p className="text-sm text-ink-secondary">Пусто</p>
        ) : (
          <ul className="text-sm space-y-1">
            {data.cashback.map((r: any, i: number) => (
              <li key={i}>
                {r.amount > 0 ? '+' : ''}
                {formatKopToRub(r.amount)} · receipt {r.receiptId?.slice?.(0, 8)} · {formatTs(r.createdAt)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link to="/customers" className="text-brand text-sm">
        ← К списку
      </Link>
    </div>
  )
}
