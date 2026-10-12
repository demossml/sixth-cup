import { useApi } from '../api/useApi'
import { fmtDateTime } from '../lib/format'
import { Card, EmptyState, ErrorBox, PageHeader, Spinner } from '../ui/kit'

type Ev = { at: number; kind: string; title: string; ref?: string }

export default function BusinessEvents() {
  const { data, error, loading, reload } = useApi<{ events: Ev[] }>('/business-events?limit=50')
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  const events = data?.events ?? []
  return (
    <>
      <PageHeader title="События" subtitle="Документы Эвотор и начисления лояльности (read-only)" />
      {!events.length ? (
        <Card><EmptyState title="Пока тихо" text="Появятся после опроса кассы и обработки SELL." /></Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line text-sm">
            {events.map((e, i) => (
              <li key={`${e.at}-${i}`} className="py-2">
                <div className="text-xs text-ink-secondary">{fmtDateTime(e.at)} · {e.kind}</div>
                <div className="font-medium">{e.title}</div>
                {e.ref && <div className="text-xs text-ink-tertiary">{e.ref}</div>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
