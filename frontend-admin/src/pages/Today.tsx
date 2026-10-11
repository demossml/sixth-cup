import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import type { Dashboard, StoreHealth } from '../api/types'
import { useSyncStores } from '../api/useStores'
import { ago, fmtDateTime, fmtKop, fmtNum } from '../lib/format'
import { qs } from '../lib/query'
import { Badge, Button, Card, EmptyState, ErrorBox, KpiTile, PageHeader, Select, Skeleton, Tabs, useToast } from '../ui/kit'
import type { Tone } from '../ui/kit'
import { CardRef, DocStatusBadge, opResult, typeLabel } from './shared'

const LEVEL: Record<string, { tone: Tone; label: string }> = {
  ok: { tone: 'ok', label: 'Работает' },
  warn: { tone: 'warn', label: 'Давно не опрашивалась' },
  bad: { tone: 'bad', label: 'Проблема' },
  off: { tone: 'neutral', label: 'Синхронизация выключена' },
}

function TillCard({ s, now, onPoll, polling }: { s: StoreHealth; now: number; onPoll: () => void; polling: boolean }) {
  const l = LEVEL[s.level] ?? LEVEL.off
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold">{s.name ?? s.uuid.slice(0, 8)}</div>
          <div className="text-xs text-ink-secondary">последний успешный опрос: {s.lastFastAt ? `${ago(s.lastFastAt, now)} (${fmtDateTime(s.lastFastAt)})` : 'ещё не было'}</div>
        </div>
        <Badge tone={l.tone}>{l.label}</Badge>
      </div>
      <p className="mt-2 text-sm text-ink-secondary">{s.reason}</p>
      {s.lastError && <p className="mt-1 break-words text-xs text-bad">{s.lastError}</p>}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary">
        <span>Чеки с ошибкой: <b className={s.failedDocs ? 'text-bad' : ''}>{s.failedDocs}</b></span>
        <span>Очередь товаров: <b>{s.outboxPending}</b></span>
        {s.outboxWithError > 0 && <span className="text-bad">С ошибкой: <b>{s.outboxWithError}</b></span>}
      </div>
      {s.enabled && (
        <Button size="sm" variant="secondary" className="mt-3" icon={<RefreshCw size={14} />} onClick={onPoll} loading={polling}>
          Опросить сейчас
        </Button>
      )}
    </Card>
  )
}

export default function Today() {
  const [period, setPeriod] = useState<'24h' | '7d' | '30d'>('24h')
  const [store, setStore] = useState('')
  const [polling, setPolling] = useState(false)
  const toast = useToast()
  const nav = useNavigate()
  const { data, error, loading, reload } = useApi<Dashboard>(`/dashboard${qs({ period, store })}`, { refreshMs: 60_000 })
  const { stores: syncStores } = useSyncStores()

  const poll = async () => {
    setPolling(true)
    try {
      await api('/evotor/poll', { method: 'POST' })
      toast.push('Опрос кассы выполнен')
      reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось опросить кассу', 'bad')
    } finally {
      setPolling(false)
    }
  }

  const enabledStores = (data?.health.stores ?? []).filter((s) => s.enabled)
  const problems = (data?.health.stores ?? []).filter((s) => s.level === 'bad' || s.level === 'warn')

  return (
    <>
      <PageHeader
        title="Сегодня"
        subtitle="Что происходит на кассе и с начислением чашек"
        actions={
          <Select value={store} onChange={(e) => setStore(e.target.value)} aria-label="Точка" className="!w-auto">
            <option value="">Все точки</option>
            {syncStores.map((s) => (
              <option key={s.uuid} value={s.uuid}>{s.name ?? s.uuid.slice(0, 8)}</option>
            ))}
          </Select>
        }
      />
      <Tabs
        items={[{ key: '24h', label: '24 часа' }, { key: '7d', label: '7 дней' }, { key: '30d', label: '30 дней' }]}
        value={period}
        onChange={setPeriod}
      />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      )}
      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiTile label="Продаж обработано" value={fmtNum(data.ops.sells)} sub={`чеков с кассы: ${fmtNum(data.docs.sell)}`} />
            <KpiTile label="Начислено чашек" value={fmtNum(data.ops.cups)} sub={data.ops.cupsReturned ? `возвращено: ${data.ops.cupsReturned}` : undefined} />
            <KpiTile label="Бесплатных выдано" value={fmtNum(data.ops.free)} />
            <KpiTile label="Кэшбэк списан, ₽" value={fmtKop(data.ops.cashbackKopecks)} sub={`сумма чеков: ${fmtNum(data.ops.resultRub)} ₽`} />
            <KpiTile
              label="Чеки с ошибкой"
              value={fmtNum(data.docs.sellFailed + data.docs.paybackFailed)}
              tone={data.docs.sellFailed + data.docs.paybackFailed ? 'bad' : undefined}
              sub="продажи и возвраты"
            />
            <KpiTile
              label="Продажи без карты"
              value={fmtNum(data.sellWithoutCard)}
              tone={data.sellWithoutCard ? 'warn' : undefined}
              sub="чашки не начислены"
            />
            <KpiTile label="Клиентов" value={fmtNum(data.customers)} sub={`новых за период: ${data.newCustomers}`} />
            <KpiTile label="Последняя операция" value={<span className="text-lg">{data.ops.lastOpAt ? ago(data.ops.lastOpAt, data.now) : '—'}</span>} sub={data.ops.lastOpAt ? fmtDateTime(data.ops.lastOpAt) : 'за период не было'} />
          </div>

          {(data.docs.sellFailed + data.docs.paybackFailed > 0 || data.sellWithoutCard > 0) && (
            <div className="mb-4 flex flex-wrap gap-2">
              {data.docs.sellFailed + data.docs.paybackFailed > 0 && (
                <Button size="sm" variant="secondary" onClick={() => nav('/operations?view=errors')}>Показать чеки с ошибкой</Button>
              )}
              {data.sellWithoutCard > 0 && (
                <Button size="sm" variant="secondary" onClick={() => nav('/operations?view=nocard')}>Показать продажи без карты</Button>
              )}
            </div>
          )}

          <h2 className="mb-2 text-base font-bold">Кассы</h2>
          {!data.health.stores.length ? (
            <Card><EmptyState title="Нет точек" text="Точки подтягиваются из Эвотор. Откройте «Касса» и включите синхронизацию нужной точки." action={<Button size="sm" onClick={() => nav('/cash')}>Открыть «Касса»</Button>} /></Card>
          ) : (
            <div className="mb-4 grid gap-3 md:grid-cols-2">
              {(store ? data.health.stores.filter((s) => s.uuid === store) : enabledStores.length ? enabledStores : data.health.stores).map((s) => (
                <TillCard key={s.uuid} s={s} now={data.now} onPoll={poll} polling={polling} />
              ))}
            </div>
          )}
          {problems.length > 0 && null}

          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-bold">Последние операции</h2>
            <Button size="sm" variant="ghost" onClick={() => nav('/operations')}>Все операции</Button>
          </div>
          {!data.recent.length ? (
            <Card><EmptyState title="Операций пока нет" /></Card>
          ) : (
            <Card pad={false}>
              <ul className="divide-y divide-line">
                {data.recent.map((o) => (
                  <li key={`${o.storeUuid}/${o.docId}`}>
                    <button type="button" className="flex min-h-[56px] w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-brand-light" onClick={() => nav(`/operations?open=${o.storeUuid}/${o.docId}`)}>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{typeLabel(o.type)} {o.number ? `№${o.number}` : ''} <span className="font-normal text-ink-secondary">· {fmtDateTime(o.closedAt)}</span></div>
                        <div className="truncate text-xs text-ink-secondary">{opResult(o)}</div>
                      </div>
                      <div className="flex items-center gap-2 text-sm"><CardRef row={o} /><DocStatusBadge status={o.status} /></div>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  )
}
