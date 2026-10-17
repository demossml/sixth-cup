import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import type { EvotorStore, Health } from '../api/types'
import { ago, fmtDateTime } from '../lib/format'
import { Badge, Banner, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, Input, PageHeader, Spinner, Toggle, useToast } from '../ui/kit'
import type { Tone } from '../ui/kit'

const LEVEL: Record<string, { tone: Tone; label: string }> = {
  ok: { tone: 'ok', label: 'Работает' }, warn: { tone: 'warn', label: 'Давно не опрашивалась' }, bad: { tone: 'bad', label: 'Проблема' }, off: { tone: 'neutral', label: 'Выключена' },
}
type Drift = { drift: { productId: number; evotorUuid: string; issue: string }[]; count: number }
type Employee = { uuid: string; name: string | null; role: string | null; storeUuid: string | null }
type TokenRow = { id: number; label: string; tokenHint: string; active: boolean; storeUuids: string[]; createdAt: number; updatedAt: number }

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
          <div className="mt-1 font-mono text-[10px] text-ink-secondary">{s.uuid}</div>
        </div>
        <div className="flex items-center gap-2 text-sm"><span>Синхронизация</span>
          <Toggle checked={!!s.syncEnabled} label={`Синхронизация: ${s.name ?? ''}`} onChange={(v) => run('toggle', async () => { await api(`/evotor/stores/${s.uuid}`, { method: 'PATCH', body: { syncEnabled: v } }); return v ? 'Точка включена' : 'Точка выключена' })} />
        </div>
      </div>
      {s.syncEnabled && health && (
        <div className="mt-3 space-y-1 text-sm">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={l.tone}>{l.label}</Badge><span className="text-ink-secondary">последний опрос: {health.lastFastAt ? `${ago(health.lastFastAt, now)} (${fmtDateTime(health.lastFastAt)})` : 'не было'}</span></div>
          {health.lastError && <div className="text-sm text-danger">{health.lastError}</div>}
        </div>
      )}
      {!s.syncEnabled && <p className="mt-3 text-sm text-ink-secondary">Чеки с этой точки не принимаются, товары не выгружаются. Выключите мёртвые точки (404 в логах) — оставьте только актуальный магазин.</p>}
      {s.syncEnabled && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={busy === 'sync'} onClick={() => run('sync', async () => { const r = await api<{ ok: boolean; pulled: unknown; failed: number }>(`/evotor/stores/${s.uuid}/sync`, { method: 'POST' }); return r.ok ? 'Каталог синхронизирован' : `Синхронизация с ошибками: ${r.failed}` })}>Синхронизировать каталог</Button>
          <Button size="sm" variant="secondary" loading={busy === 'push'} onClick={() => run('push', async () => { const r = await api<{ ok: boolean; failed: number }>(`/evotor/stores/${s.uuid}/push-products`, { method: 'POST' }); return r.ok ? 'Товары выгружены' : `Выгружено с ошибками: ${r.failed}` })}>Выгрузить товары</Button>
          <Button size="sm" variant="secondary" loading={busy === 'drift'} onClick={() => run('drift', async () => { const r = await api<Drift>(`/evotor/stores/${s.uuid}/products/drift`); setDrift(r); return r.drift.length ? `Расхождений: ${r.drift.length}` : 'Расхождений нет' })}>Проверить расхождения</Button>
          <Button size="sm" variant="secondary" onClick={() => setWipe(true)}>Пересоздать каталог…</Button>
        </div>
      )}
      {drift && drift.count > 0 && (
        <ul className="mt-2 max-h-32 overflow-auto text-xs text-ink-secondary">
          {drift.drift.slice(0, 20).map((d) => <li key={`${d.productId}-${d.evotorUuid}`}>{d.productId}: {d.issue}</li>)}
        </ul>
      )}
      <ConfirmDialog open={wipe} title="Пересоздать каталог на точке?"
        onCancel={() => setWipe(false)}
        onConfirm={() => { void run('wipe', async () => { const r = await api<{ ok: boolean }>(`/evotor/stores/${s.uuid}/wipe-catalog`, { method: 'POST' }); return r.ok ? 'Каталог пересоздан' : 'Пересоздан с ошибками' }).finally(() => setWipe(false)) }}>
        Товары нашего каталога на точке «{s.name}» будут удалены в Эвотор и выгружены заново.
      </ConfirmDialog>
    </Card>
  )
}

function TokensPanel({ allStoreUuids }: { allStoreUuids: string[] }) {
  const tokens = useApi<{ tokens: TokenRow[] }>('/evotor/tokens')
  const toast = useToast()
  const [label, setLabel] = useState('')
  const [token, setToken] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await api('/evotor/tokens', { method: 'POST', body: { label: label || 'Токен', token, storeUuids: selected } })
      toast.push('Токен сохранён')
      setLabel(''); setToken(''); setSelected([])
      tokens.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally { setBusy(false) }
  }

  const probe = async (id: number) => {
    try {
      const r = await api<{ ok: boolean; stores: number }>(`/evotor/tokens/${id}/probe`, { method: 'POST' })
      toast.push(r.ok ? `OK, точек в облаке: ${r.stores}` : 'Probe failed')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка probe', 'bad')
    }
  }

  const deactivate = async (id: number) => {
    try {
      await api(`/evotor/tokens/${id}`, { method: 'DELETE' })
      toast.push('Токен отключён')
      tokens.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  const toggleStore = (uuid: string) => {
    setSelected((prev) => prev.includes(uuid) ? prev.filter((x) => x !== uuid) : [...prev, uuid])
  }

  return (
    <div className="mt-8">
      <h2 className="mb-2 text-base font-bold">Токены Эвотор (облако)</h2>
      <p className="mb-3 text-sm text-ink-secondary">
        Несколько токенов для разных юрлиц/кабинетов. Карты лояльности общие на всю сеть.
        Токен хранится зашифрованным; в списке видны только последние 4 символа.
      </p>
      {tokens.error && <ErrorBox message={tokens.error} onRetry={tokens.reload} />}
      {tokens.loading && !tokens.data && <Spinner />}
      <div className="mb-4 grid gap-2">
        {(tokens.data?.tokens ?? []).map((t) => (
          <Card key={t.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-bold">{t.label} <span className="font-mono text-xs text-ink-secondary">{t.tokenHint}</span></div>
                <div className="text-xs text-ink-secondary">точек: {t.storeUuids.length || 'не привязаны'} · {t.active ? 'активен' : 'выключен'}</div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => void probe(t.id)}>Проверить</Button>
                {t.active && <Button size="sm" variant="secondary" onClick={() => void deactivate(t.id)}>Отключить</Button>}
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <div className="text-sm font-bold mb-2">Добавить токен</div>
        <Field label="Название"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ИП / точка" /></Field>
        <Field label="Токен (X-Authorization)"><Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="вставьте из кабинета Эвотор" /></Field>
        <div className="mb-2 text-xs text-ink-secondary">Привязка к точкам (uuid из списка выше):</div>
        <div className="mb-3 flex flex-wrap gap-2">
          {allStoreUuids.map((u) => (
            <button key={u} type="button" onClick={() => toggleStore(u)}
              className={`rounded-lg border px-2 py-1 text-xs font-mono ${selected.includes(u) ? 'border-brand bg-brand/10' : 'border-line'}`}>
              {u.slice(0, 8)}…
            </button>
          ))}
          {!allStoreUuids.length && <span className="text-xs text-ink-secondary">Сначала обновите список точек (нужен хотя бы один рабочий токен в env или уже сохранённый).</span>}
        </div>
        <Button loading={busy} disabled={token.trim().length < 8} onClick={() => void save()}>Сохранить токен</Button>
      </Card>
    </div>
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
  const list = stores.data?.stores ?? []
  return (
    <>
      <PageHeader title="Касса" subtitle="Включайте sync только у актуальных точек. Мёртвые uuid (404) — выключите."
        actions={<Button variant="secondary" loading={syncing} onClick={syncAll}>Синхронизировать все включённые</Button>} />
      {stores.error && <ErrorBox message={stores.error} onRetry={stores.reload} />}
      {stores.loading && !stores.data && <Spinner />}
      {stores.data && !list.length && <Card><EmptyState title="Точек нет" text="Эвотор не вернул ни одной точки. Добавьте токен ниже или проверьте EVOTOR_API_TOKEN." /></Card>}
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((s) => (
          <StoreCard key={s.uuid} s={s} health={health.data?.stores.find((h) => h.uuid === s.uuid)} now={health.data?.now ?? Date.now()} onChanged={reloadAll} />
        ))}
      </div>
      <TokensPanel allStoreUuids={list.map((s) => s.uuid)} />
      <h2 className="mb-2 mt-6 text-base font-bold">Сотрудники</h2>
      {emp.loading && !emp.data && <Spinner />}
      {emp.error && <ErrorBox message={emp.error} onRetry={emp.reload} />}
      {emp.data && (!emp.data.employees.length ? <Card><EmptyState title="Сотрудников нет" /></Card> : (
        <Card pad={false}><ul className="divide-y divide-line text-sm">{emp.data.employees.map((e) => <li key={String(e.uuid)} className="flex justify-between gap-2 px-4 py-2.5"><span>{e.name ?? '—'}</span><span className="text-ink-secondary">{e.role ?? ''}</span></li>)}</ul></Card>
      ))}
    </>
  )
}
