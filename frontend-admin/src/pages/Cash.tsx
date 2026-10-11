import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import type { EvotorStore, Health } from '../api/types'
import { ago, fmtDateTime } from '../lib/format'
import { Badge, Banner, Button, Card, ConfirmDialog, EmptyState, ErrorBox, PageHeader, Spinner, Toggle, useToast } from '../ui/kit'
import type { Tone } from '../ui/kit'

const LEVEL: Record<string, { tone: Tone; label: string }> = {
  ok: { tone: 'ok', label: 'Работает' }, warn: { tone: 'warn', label: 'Давно не опрашивалась' }, bad: { tone: 'bad', label: 'Проблема' }, off: { tone: 'neutral', label: 'Выключена' },
}
type Drift = { drift: { productId: number; evotorUuid: string; issue: string }[]; count: number }
type Employee = { uuid: string; name: string | null; role: string | null; storeUuid: string | null }

function StoreCard({ s, health, now, onChanged }: { s: EvotorStore; health?: Health['stores'][number]; now: number; onChanged: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const [drift, setDrift] = useState<Drift | null>(null)
  const [wipe, setWipe] = useState(false)
  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key)
    try { toast.push(await fn()); onChanged() } catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad') } finally { setBusy('') }
  }
  const l = LEVEL[health?.level ?? 'off']
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-bold">{s.name ?? s.uuid.slice(0, 8)}</div>
          {s.address && <div className="truncate text-xs text-ink-secondary">{s.address}</div>}
        </div>
        <div className="flex items-center gap-2 text-sm"><span>Синхронизация</span>
          <Toggle checked={s.syncEnabled} label={`Синхронизация: ${s.name ?? ''}`} onChange={(v) => run('toggle', async () => { await api(`/evotor/stores/${s.uuid}`, { method: 'PATCH', body: { syncEnabled: v } }); return v ? 'Точка включена' : 'Точка выключена' })} />
        </div>
      </div>
      {s.syncEnabled && health && (
        <div className="mt-3 space-y-1 text-sm">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={l.tone}>{l.label}</Badge><span className="text-ink-secondary">последний опрос: {health.lastFastAt ? `${ago(health.lastFastAt, now)} (${fmtDateTime(health.lastFastAt)})` : 'не было'}</span></div>
          {health.lastError && <div className="break-words text-xs text-bad">{health.lastError}</div>}
          <div className="text-xs text-ink-secondary">Очередь выгрузки товаров: {health.outboxPending}{health.outboxWithError ? `, с ошибкой: ${health.outboxWithError}` : ''} · чеков с ошибкой: {health.failedDocs}</div>
        </div>
      )}
      {!s.syncEnabled && <p className="mt-3 text-sm text-ink-secondary">Чеки с этой точки не принимаются, товары не выгружаются. Включите, когда точка готова.</p>}
      {s.syncEnabled && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={busy === 'sync'} onClick={() => run('sync', async () => { const r = await api<{ ok: boolean; pulled: unknown; failed: number }>(`/evotor/stores/${s.uuid}/sync`, { method: 'POST' }); return r.ok ? 'Каталог синхронизирован' : `Синхронизация с ошибками: ${r.failed}` })}>Синхронизировать каталог</Button>
          <Button size="sm" variant="secondary" loading={busy === 'push'} onClick={() => run('push', async () => { const r = await api<{ ok: boolean; failed: number }>(`/evotor/stores/${s.uuid}/push-products`, { method: 'POST' }); return r.ok ? 'Товары выгружены' : `Выгружено с ошибками: ${r.failed}` })}>Выгрузить товары</Button>
          <Button size="sm" variant="secondary" loading={busy === 'drift'} onClick={() => run('drift', async () => { const r = await api<Drift>(`/evotor/stores/${s.uuid}/products/drift`); setDrift(r); return r.drift.length ? `Расхождений: ${r.drift.length}` : 'Расхождений нет' })}>Проверить расхождения</Button>
        </div>
      )}
      {drift && (
        <div className="mt-3">
          <Banner tone={drift.drift.length ? 'warn' : 'ok'}>На кассе товаров: {drift.count}. {drift.drift.length ? `Расходится с нашим каталогом: ${drift.drift.length}.` : 'Каталоги совпадают.'}</Banner>
          {drift.drift.length > 0 && (
            <ul className="max-h-40 overflow-auto rounded-xl border border-line text-xs">
              {drift.drift.slice(0, 50).map((d) => <li key={d.productId} className="border-b border-line px-3 py-1.5 last:border-0">Товар #{d.productId}: {d.issue === 'MISSING_IN_EVOTOR' ? 'нет на кассе' : 'поля отличаются'}</li>)}
            </ul>
          )}
        </div>
      )}
      {s.syncEnabled && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-bad">Опасная зона</summary>
          <div className="mt-2"><Button size="sm" variant="danger" onClick={() => setWipe(true)}>Очистить каталог на кассе и выгрузить заново</Button></div>
        </details>
      )}
      <ConfirmDialog open={wipe} danger typed="очистить" confirmLabel="Очистить" busy={busy === 'wipe'} title="Очистить каталог на кассе?"
        onCancel={() => setWipe(false)}
        onConfirm={() => { void run('wipe', async () => { const r = await api<{ ok: boolean }>(`/evotor/stores/${s.uuid}/wipe-catalog`, { method: 'POST' }); return r.ok ? 'Каталог пересоздан' : 'Пересоздан с ошибками' }).finally(() => setWipe(false)) }}>
        Товары нашего каталога на точке «{s.name}» будут удалены в Эвотор и выгружены заново. Во время этого касса может ненадолго остаться без товаров.
      </ConfirmDialog>
    </Card>
  )
}

export default function Cash() {
  const stores = useApi<{ stores: EvotorStore[] }>('/evotor/stores')
  const health = useApi<Health & { now: number }>('/evotor/health', { refreshMs: 60_000 })
  const emp = useApi<{ employees: Employee[] }>('/evotor/employees')
  const toast = useToast()
  const [syncing, setSyncing] = useState(false)
  const reloadAll = () => { stores.reload(); health.reload() }
  const syncAll = async () => {
    setSyncing(true)
    try { await api('/evotor/sync', { method: 'POST', body: {} }); toast.push('Синхронизация выполнена'); reloadAll() }
    catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad') } finally { setSyncing(false) }
  }
  return (
    <>
      <PageHeader title="Касса" subtitle="Точки берутся из Эвотор. Мы работаем только с теми, у кого включена синхронизация"
        actions={<Button variant="secondary" loading={syncing} onClick={syncAll}>Синхронизировать все включённые</Button>} />
      {stores.error && <ErrorBox message={stores.error} onRetry={stores.reload} />}
      {stores.loading && !stores.data && <Spinner />}
      {stores.data && !stores.data.stores.length && <Card><EmptyState title="Точек нет" text="Эвотор не вернул ни одной точки." /></Card>}
      <div className="grid gap-3 lg:grid-cols-2">
        {(stores.data?.stores ?? []).map((s) => (
          <StoreCard key={s.uuid} s={s} health={health.data?.stores.find((h) => h.uuid === s.uuid)} now={health.data?.now ?? Date.now()} onChanged={reloadAll} />
        ))}
      </div>
      <h2 className="mb-2 mt-6 text-base font-bold">Сотрудники</h2>
      {emp.loading && !emp.data && <Spinner />}
      {emp.error && <ErrorBox message={emp.error} onRetry={emp.reload} />}
      {emp.data && (!emp.data.employees.length ? <Card><EmptyState title="Сотрудников нет" /></Card> : (
        <Card pad={false}><ul className="divide-y divide-line text-sm">{emp.data.employees.map((e) => <li key={String(e.uuid)} className="flex justify-between gap-2 px-4 py-2.5"><span>{e.name ?? '—'}</span><span className="text-ink-secondary">{e.role ?? ''}</span></li>)}</ul></Card>
      ))}
    </>
  )
}
