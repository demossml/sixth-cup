import { useEffect, useState } from 'react'
import { adminFetch } from '../../api/client'
import { PageHeader } from '../../ui/PageHeader'
import { EmptyState } from '../../ui/EmptyState'

export function MarketingPage() {
  const [promos, setPromos] = useState<any[]>([])
  const [err, setErr] = useState('')

  useEffect(() => {
    adminFetch<{ promos?: any[] } | any[]>('/promos')
      .then((r) => setPromos(Array.isArray(r) ? r : (r as any).promos ?? []))
      .catch((e) => setErr(e.message))
  }, [])

  return (
    <div className="space-y-4">
      <PageHeader title="Маркетинг" subtitle="Акции (CRUD API уже есть). Ваучеры — через Legacy или карточку клиента." />
      {err ? <p className="text-red-600 text-sm">{err}</p> : null}
      {!promos.length ? (
        <EmptyState title="Нет акций" description="Создайте через Legacy или API POST /promos" />
      ) : (
        <ul className="space-y-2">
          {promos.map((p) => (
            <li key={p.id} className="rounded-2xl border border-line bg-white p-4 text-sm">
              <div className="font-semibold">{p.title}</div>
              <div className="text-ink-secondary">{p.body}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
