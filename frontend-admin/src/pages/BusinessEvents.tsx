import { useMemo, useState } from 'react'
import { useApi } from '../api/useApi'
import { qs } from '../lib/query'
import { fmtDateTime } from '../lib/format'
import { Card, ErrorBox, PageHeader, Select, Spinner } from '../ui/kit'

type Ev = { at: number; kind: string; title: string; ref?: string }

export default function BusinessEvents() {
  const [kind, setKind] = useState('all')
  const [limit, setLimit] = useState('60')
  const { data, error, loading, reload } = useApi<{ events: Ev[] }>(`/business-events${qs({ limit })}`, { refreshMs: 30_000 })
  const filtered = useMemo(() => {
    const list = data?.events ?? []
    if (kind === 'all') return list
    return list.filter((e) => e.kind.startsWith(kind))
  }, [data, kind])
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  return (
    <>
      <PageHeader
        title="События"
        subtitle="Документы Эвотор и начисления лояльности"
        actions={
          <div className="flex gap-2">
            <Select value={kind} onChange={(e) => setKind(e.target.value)} className="!w-auto">
              <option value="all">Все типы</option>
              <option value="doc_">Документы</option>
              <option value="loyalty_">Лояльность</option>
            </Select>
            <Select value={limit} onChange={(e) => setLimit(e.target.value)} className="!w-auto">
              <option value="40">40</option>
              <option value="60">60</option>
              <option value="100">100</option>
            </Select>
          </div>
        }
      />
      <Card>
        <ul className="divide-y divide-line">
          {filtered.map((e, i) => (
            <li key={i} className="py-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{e.title}</span>
                <span className="text-xs text-ink-secondary">{e.at ? fmtDateTime(e.at) : '—'}</span>
              </div>
              <div className="text-xs text-ink-secondary">{e.kind}{e.ref ? ` · ${e.ref}` : ''}</div>
            </li>
          ))}
          {!filtered.length && <li className="py-6 text-ink-secondary">Нет событий</li>}
        </ul>
      </Card>
    </>
  )
}
