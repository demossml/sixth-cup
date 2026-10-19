import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { api, download } from '../api/client'
import { useApi } from '../api/useApi'
import type { OperationRow } from '../api/types'
import { useSyncStores } from '../api/useStores'
import { fmtDateTime, fmtKop, shortId } from '../lib/format'
import { qs, setParams } from '../lib/query'
import { Banner, Button, Card, DataTable, Drawer, EmptyState, ErrorBox, Input, PageHeader, Select, Spinner, Tabs, useToast } from '../ui/kit'
import { HelpLink } from '../components/HelpLink'
import type { Column } from '../ui/kit'
import { CardRef, DocStatusBadge, opResult, typeLabel } from './shared'

type View = '' | 'credited' | 'nocard' | 'errors' | 'disputes'
const PERIODS: Record<string, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }

type Detail = { op: OperationRow; documentData: unknown }

function OpDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [store, doc] = (id ?? '').split('/')
  const { data, error, loading } = useApi<Detail>(id ? `/operations/${encodeURIComponent(store)}/${encodeURIComponent(doc)}` : null)
  const o = data?.op
  return (
    <Drawer open={!!id} onClose={onClose} title={o ? `${typeLabel(o.type)} ${o.number ? `№${o.number}` : ''}` : 'Документ'} wide>
      {loading && <Spinner />}
      {error && <ErrorBox message={error} />}
      {o && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><DocStatusBadge status={o.status} /><span className="text-ink-secondary">{o.storeName ?? shortId(o.storeUuid)}</span></div>
          <Banner tone={o.status === 'FAILED' ? 'bad' : o.cardId && o.opKind ? 'ok' : 'warn'}>{opResult(o)}</Banner>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-ink-secondary">Закрыт</dt><dd>{fmtDateTime(o.closedAt)}</dd>
            <dt className="text-ink-secondary">Получен нами</dt><dd>{fmtDateTime(o.receivedAt)}</dd>
            <dt className="text-ink-secondary">Обработан</dt><dd>{fmtDateTime(o.processedAt)}</dd>
            <dt className="text-ink-secondary">Источник</dt><dd>{o.source}</dd>
            <dt className="text-ink-secondary">Попыток</dt><dd>{o.attempts}</dd>
            <dt className="text-ink-secondary">Карта</dt><dd><CardRef row={o} /></dd>
            {o.opKind && (<>
              <dt className="text-ink-secondary">Чашек засчитано</dt><dd>{o.cups ?? 0}</dd>
              <dt className="text-ink-secondary">Заявлено на кассе</dt><dd>{o.opClaimed ?? '—'}{o.qClaimed != null ? ` · ${o.qClaimed}` : ''}</dd>
              <dt className="text-ink-secondary">Бесплатных</dt><dd>{o.free ?? 0}</dd>
              <dt className="text-ink-secondary">Кэшбэк списан, ₽</dt><dd>{fmtKop(o.cashbackKopecks)}</dd>
              <dt className="text-ink-secondary">Сумма чека, ₽</dt><dd>{o.resultRub ?? '—'}</dd>
            </>)}
            <dt className="text-ink-secondary">Документ</dt><dd className="break-all font-mono text-xs">{o.docId}</dd>
          </dl>
          {o.lastError && <div className="break-words rounded-xl bg-red-50 p-3 text-xs text-bad">{o.lastError}</div>}
          {data?.documentData != null && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-brand">Позиции чека (как пришли с кассы)</summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-gray-50 p-3 text-xs">{JSON.stringify(data.documentData, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </Drawer>
  )
}

function Disputes() {
  const { data, error, loading, reload } = useApi<{ disputes: Record<string, unknown>[] }>('/disputes')
  if (loading) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data?.disputes.length) return <Card><EmptyState title="Споров нет" /></Card>
  return (
    <div className="space-y-2">
      {data.disputes.map((d, i) => (
        <Card key={String(d.id ?? i)}>
          <pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(d, null, 2)}</pre>
        </Card>
      ))}
    </div>
  )
}

export default function Operations() {
  const [sp, setSp] = useSearchParams()
  const view = (sp.get('view') ?? '') as View
  const store = sp.get('store') ?? ''
  const period = sp.get('period') ?? '7d'
  const [qInput, setQInput] = useState(sp.get('q') ?? '')
  const q = sp.get('q') ?? ''
  const open = sp.get('open')
  const toast = useToast()
  const { stores: syncStores } = useSyncStores()

  const [rows, setRows] = useState<OperationRow[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const from = period === 'all' ? undefined : Date.now() - (PERIODS[period] ?? PERIODS['7d'])
  // `from` is minute-rounded so the query key stays stable between renders.
  const fromKey = from ? Math.floor(from / 60_000) * 60_000 : undefined
  const base = qs({ view: view === 'disputes' ? '' : view, store, q, from: fromKey, limit: 50 })

  const load = useCallback(async (cursor?: string) => {
    setLoading(true)
    setError('')
    try {
      const r = await api<{ ops: OperationRow[]; next: string | null }>(`/operations${base}${cursor ? `${base ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : ''}`)
      setRows((prev) => (cursor ? [...prev, ...r.ops] : r.ops))
      setNext(r.next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => { if (view !== 'disputes') void load() }, [load, view])
  useEffect(() => setQInput(q), [q])

  const patch = (p: Record<string, string | null>) => setSp(setParams(sp, p), { replace: true })
  const cols: Column<OperationRow>[] = [
    { key: 'time', header: 'Время', render: (o) => <span className="whitespace-nowrap">{fmtDateTime(o.closedAt)}</span>, primary: true },
    { key: 'type', header: 'Тип', render: (o) => <>{typeLabel(o.type)}{o.number ? ` №${o.number}` : ''}</> },
    { key: 'store', header: 'Точка', render: (o) => o.storeName ?? shortId(o.storeUuid), hideOnPhone: !!store },
    { key: 'card', header: 'Карта', render: (o) => <CardRef row={o} /> },
    { key: 'res', header: 'Результат', render: (o) => <span className="text-ink-secondary">{opResult(o)}</span> },
    { key: 'st', header: 'Статус', render: (o) => <DocStatusBadge status={o.status} /> },
  ]

  return (
    <section className="view is-active" data-view="operations">
      <div className="page-head">
        <div>
          <h1>Операции</h1>
          <p className="page-sub">Каждый чек с кассы и что с ним сделала система</p>
        </div>
        <div className="head-actions">
          <HelpLink article="principles" />
          {view !== 'disputes' && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => download(`/operations.csv${base.replace(/limit=\d+&?/, '')}`, 'operations.csv').catch((e) => toast.push(String(e.message ?? e), 'bad'))}
            >
              CSV
            </button>
          )}
        </div>
      </div>
      <Tabs
        items={[{ key: '', label: 'Все' }, { key: 'credited', label: 'Начислено' }, { key: 'nocard', label: 'Без карты' }, { key: 'errors', label: 'Ошибки' }, { key: 'disputes', label: 'Споры' }]}
        value={view}
        onChange={(k) => patch({ view: k })}
      />
      {view !== 'disputes' ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto]">
            <form className="col-span-2 sm:col-span-1" onSubmit={(e) => { e.preventDefault(); patch({ q: qInput.trim() }) }}>
              <Input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Номер карты, номер чека или начало id документа" aria-label="Поиск по операциям" />
            </form>
            <Select value={store} onChange={(e) => patch({ store: e.target.value })} aria-label="Точка">
              <option value="">Все точки</option>
              {syncStores.map((s) => <option key={s.uuid} value={s.uuid}>{s.name ?? shortId(s.uuid)}</option>)}
            </Select>
            <Select value={period} onChange={(e) => patch({ period: e.target.value })} aria-label="Период">
              <option value="24h">24 часа</option><option value="7d">7 дней</option><option value="30d">30 дней</option><option value="all">Всё время</option>
            </Select>
          </div>
          {error && <ErrorBox message={error} onRetry={() => load()} />}
          {!error && (
            <DataTable
              rows={rows}
              columns={cols}
              rowKey={(o) => `${o.storeUuid}/${o.docId}`}
              onRowClick={(o) => patch({ open: `${o.storeUuid}/${o.docId}` })}
              empty={loading ? <Spinner /> : <EmptyState title="Операций не найдено" text="Попробуйте другой период или уберите фильтры." />}
            />
          )}
          {rows.length > 0 && (
            <div className="mt-3 flex justify-center">
              {loading ? <Spinner /> : next ? <Button variant="secondary" onClick={() => load(next)}>Ещё</Button> : <span className="text-sm text-ink-tertiary">Это всё за выбранный период</span>}
            </div>
          )}
        </>
      ) : <Disputes />}
      <OpDrawer id={open} onClose={() => patch({ open: null })} />
    </section>
  )
}
