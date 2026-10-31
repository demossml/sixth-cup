import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import type { EvotorStore, Health } from '../api/types'
import { ago, fmtDateTime } from '../lib/format'
import { Badge, Banner, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, Input, PageHeader, Spinner, StatusDot, Toggle, useToast } from '../ui/kit'
import { HelpLink } from '../components/HelpLink'
import CashierMenuPanel from './cash/CashierMenuPanel'
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
  const [purge, setPurge] = useState(false)
  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key)
    try { toast.push(await fn()); onChanged() } catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad') } finally { setBusy('') }
  }
  const l = LEVEL[health?.level ?? 'off']
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot level={(health?.level as 'ok' | 'warn' | 'bad' | 'off') ?? 'off'} label={l.label} />
            <div className="truncate text-base font-bold text-ink">{s.name ?? s.uuid.slice(0, 8)}</div>
          </div>
          {s.address && <div className="truncate text-[12px] text-ink-secondary">{s.address}</div>}
          <div className="mt-1 font-mono text-[10px] text-ink-tertiary">{s.uuid}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[11px] font-medium text-ink-tertiary">Синхронизация</span>
          <Toggle checked={!!s.syncEnabled} label={`Синхронизация: ${s.name ?? ''}`} onChange={(v) => run('toggle', async () => { await api(`/evotor/stores/${s.uuid}`, { method: 'PATCH', body: { syncEnabled: v } }); return v ? 'Точка включена' : 'Точка выключена' })} />
        </div>
      </div>
      {s.syncEnabled && health && (
        <div className="mt-3 space-y-1.5 rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={l.tone}>{l.label}</Badge>
            <span className="font-mono text-[12px] text-ink-secondary">
              опрос: {health.lastFastAt ? `${ago(health.lastFastAt, now)}` : 'не было'}
            </span>
          </div>
          {health.catalogPaused && (
            <div className="rounded-lg border border-warn/40 bg-warn-soft/60 px-2 py-1 text-[12px] text-ink">
              Прайс удалён на точке: товары не выгружаются автоматически. Верните кнопкой «Выгрузить товары».
            </div>
          )}
          {health.lastError && <div className="break-words text-[12px] text-bad">{health.lastError}</div>}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-tertiary">
            <span>ошибки чеков: <b className={health.failedDocs ? 'text-bad' : ''}>{health.failedDocs ?? 0}</b></span>
            <span>очередь: <b>{health.outboxPending ?? 0}</b></span>
          </div>
        </div>
      )}
      {!s.syncEnabled && <p className="mt-3 text-[13px] text-ink-secondary">Чеки не принимаются, каталог не выгружается. Выключите мёртвые точки (404) — оставьте актуальные.</p>}
      {s.syncEnabled && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={busy === 'sync'} onClick={() => run('sync', async () => { const r = await api<{ ok: boolean; pulled: unknown; failed: number }>(`/evotor/stores/${s.uuid}/sync`, { method: 'POST' }); return r.ok ? 'Каталог синхронизирован' : `Синхронизация с ошибками: ${r.failed}` })}>Синхронизировать каталог</Button>
          <Button size="sm" variant="secondary" loading={busy === 'push'} onClick={() => run('push', async () => { const r = await api<{ ok: boolean; failed: number }>(`/evotor/stores/${s.uuid}/push-products`, { method: 'POST' }); return r.ok ? 'Товары выгружены' : `Выгружено с ошибками: ${r.failed}` })}>Выгрузить товары</Button>
          <Button size="sm" variant="secondary" loading={busy === 'drift'} onClick={() => run('drift', async () => { const r = await api<Drift>(`/evotor/stores/${s.uuid}/products/drift`); setDrift(r); return r.drift.length ? `Расхождений: ${r.drift.length}` : 'Расхождений нет' })}>Проверить расхождения</Button>
          <Button size="sm" variant="secondary" onClick={() => setWipe(true)}>Пересоздать каталог…</Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => setPurge(true)}
          >
            Удалить прайс-лист…
          </Button>
        </div>
      )}
      {drift && drift.count > 0 && (
        <ul className="mt-2 max-h-32 overflow-auto text-xs text-ink-secondary">
          {drift.drift.slice(0, 20).map((d) => <li key={`${d.productId}-${d.evotorUuid}`}>{d.productId}: {d.issue}</li>)}
        </ul>
      )}
      <CashierMenuPanel storeUuid={s.uuid} storeName={s.name ?? s.uuid.slice(0, 8)} />

      <ConfirmDialog
        open={purge}
        danger
        typed="удалить"
        confirmLabel="Удалить прайс-лист"
        busy={busy === 'purge'}
        title="Удалить весь прайс-лист на точке?"
        onCancel={() => setPurge(false)}
        onConfirm={() => { void run('purge', async () => {
          const r = await api<{ ok: boolean; deleted: number; listed: number; groups: number; errors: string[] }>(
            `/evotor/stores/${s.uuid}/purge-catalog`,
            { method: 'POST', body: { confirm: 'удалить' } },
          )
          return r.ok
            ? `Удалено: ${r.deleted} из ${r.listed}${r.groups ? ` (групп: ${r.groups})` : ''}`
            : `Удалено ${r.deleted} из ${r.listed}, ошибок: ${r.errors.length}`
        }).finally(() => setPurge(false)) }}
      >
        В Эвотор будут удалены <b>все товары и группы</b> этой точки — касса останется без товаров.
        Наш каталог в 6.7 не пострадает. Синхронизация чеков продолжится, но товары сами не вернутся:
        автовыгрузка ставится на паузу до нажатия «Выгрузить товары».
        Для подтверждения введите слово <b>удалить</b>.
      </ConfirmDialog>
      <ConfirmDialog open={wipe} title="Пересоздать каталог на точке?"
        busy={busy === 'wipe'}
        onCancel={() => setWipe(false)}
        onConfirm={() => { void run('wipe', async () => {
          // Двойной клик по «Пересоздать» запускал два wipe параллельно: удаление и выгрузка
          // гонялись за одни товары, Эвотор отвечал 400. Сервер тоже отдаёт 409 на второй вызов.
          const r = await api<{ ok: boolean; partial?: boolean; pushed?: number; pushErrors?: string[] }>(`/evotor/stores/${s.uuid}/wipe-catalog`, { method: 'POST' })
          if (r.ok) return 'Каталог пересоздан'
          return `Пересоздан с ошибками: ${r.pushErrors?.length ?? 0} из ${(r.pushErrors?.length ?? 0) + (r.pushed ?? 0)}`
        }).finally(() => setWipe(false)) }}>
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

type DeviceRow = {
  id: number; name: string; storeId: number; storeName: string
  revoked: number; enrollCode: string | null; enrolled: number; createdAt: number
}
type LocalStore = { id: number; name: string; address: string | null; organizationId: number | null }

/** Кассовые устройства: код регистрации для терминала, отзыв и удаление (R-05). */
function DevicesPanel() {
  const toast = useToast()
  const devices = useApi<{ devices: DeviceRow[] }>('/devices')
  const stores = useApi<{ stores: LocalStore[] }>('/stores')
  const [name, setName] = useState('')
  const [storeId, setStoreId] = useState('')
  const [busy, setBusy] = useState('')
  const [enroll, setEnroll] = useState<{ name: string; code: string } | null>(null)
  const [del, setDel] = useState<DeviceRow | null>(null)

  const list = devices.data?.devices ?? []
  const localStores = stores.data?.stores ?? []

  const create = async () => {
    if (!name.trim() || !storeId) return
    setBusy('create')
    try {
      const res = await api<{ id: number; enrollCode: string }>('/devices', {
        method: 'POST',
        body: { storeId: Number(storeId), name: name.trim() },
      })
      setEnroll({ name: name.trim(), code: res.enrollCode })
      setName('')
      devices.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy('')
    }
  }

  const revoke = async (d: DeviceRow) => {
    setBusy(`revoke-${d.id}`)
    try {
      await api(`/devices/${d.id}/revoke`, { method: 'POST' })
      toast.push('Устройство отозвано — терминал больше не авторизуется')
      devices.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy('')
    }
  }

  const remove = async () => {
    if (!del) return
    setBusy('delete')
    try {
      await api(`/devices/${del.id}`, { method: 'DELETE' })
      toast.push('Устройство удалено')
      setDel(null)
      devices.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <h2 className="mb-2 mt-6 text-base font-bold">Устройства</h2>
      <p className="mb-2 text-[12px] text-ink-secondary">
        Код регистрации вводится на терминале один раз (экрана «Касса» → регистрация). Код виден только владельцу и только
        до регистрации.
      </p>
      {!localStores.length && (
        <Banner tone="warn">
          Нет локальных точек — устройство привязывается к точке из справочника. Сначала заведите точку (или дождитесь
          синхронизации точек Эвотор).
        </Banner>
      )}
      {localStores.length > 0 && (
        <Card className="mb-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Точка">
              <select
                className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                aria-label="Точка для устройства"
              >
                <option value="">— выберите —</option>
                {localStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Название устройства">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Касса на Ленина" />
            </Field>
            <div className="flex items-end">
              <Button loading={busy === 'create'} disabled={!name.trim() || !storeId} onClick={() => void create()}>
                Создать код
              </Button>
            </div>
          </div>
        </Card>
      )}

      {enroll && (
        <Card className="mb-3">
          <div className="text-[13px]">
            Код регистрации для «{enroll.name}»: <b className="font-mono text-base">{enroll.code}</b>
          </div>
          <p className="mt-1 text-[12px] text-ink-secondary">
            Введите его на терминале при первом запуске. Код одноразовый: после регистрации он исчезает.
          </p>
          <div className="mt-2"><Button size="sm" variant="ghost" onClick={() => setEnroll(null)}>Скрыть</Button></div>
        </Card>
      )}

      {devices.loading && !devices.data && <Spinner />}
      {devices.error && <ErrorBox message={devices.error} onRetry={devices.reload} />}
      {devices.data && !list.length && <Card><EmptyState title="Устройств нет" text="Создайте устройство и введите код регистрации на терминале." /></Card>}
      {!!list.length && (
        <Card pad={false}>
          <ul className="divide-y divide-line text-sm">
            {list.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="font-medium">{d.name}</div>
                  <div className="text-[12px] text-ink-secondary">
                    {d.storeName} · {d.enrolled ? 'зарегистрировано' : 'код не использован'} · {fmtDateTime(d.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {d.revoked ? <Badge tone="bad">отозвано</Badge> : <Badge tone="ok">активно</Badge>}
                  {d.enrollCode && <Badge tone="brand">код {d.enrollCode}</Badge>}
                  {!d.revoked && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy === `revoke-${d.id}`}
                      aria-label={`Отозвать устройство ${d.name}`}
                      onClick={() => void revoke(d)}
                    >
                      Отозвать
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" aria-label={`Удалить устройство ${d.name}`} onClick={() => setDel(d)}>
                    Удалить
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={!!del}
        danger
        busy={busy === 'delete'}
        title="Удалить устройство?"
        confirmLabel="Удалить"
        onCancel={() => setDel(null)}
        onConfirm={remove}
      >
        {del && `«${del.name}» будет удалено из справочника. Если терминал ещё используется — вместо удаления лучше «Отозвать».`}
      </ConfirmDialog>
    </>
  )
}

export default function Cash() {
  const stores = useApi<{ stores: EvotorStore[]; stale?: boolean; error?: string }>('/evotor/stores')
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
    <section className="view is-active" data-view="cash">
      <div className="page-head">
        <div>
          <h1>Касса</h1>
          <p className="page-sub">Включайте sync только у актуальных точек. Мёртвые uuid (404) — выключите.</p>
        </div>
        <div className="head-actions">
          <HelpLink article="map" label="Разделы" />
          <button type="button" className="btn btn-primary" disabled={syncing} onClick={syncAll}>Синхронизировать все</button>
        </div>
      </div>
      {stores.error && <ErrorBox message={stores.error} onRetry={stores.reload} />}
      {stores.data?.stale && (
        <Banner tone="warn">
          Эвотор недоступен — список точек показан из кэша. Настройки меню и синхронизации продолжат работать,
          данные обновятся при следующем успешном запросе.
        </Banner>
      )}
      {stores.loading && !stores.data && <Spinner />}
      {stores.data && !list.length && <Card><EmptyState title="Точек нет" text="Эвотор не вернул ни одной точки. Добавьте токен ниже или проверьте EVOTOR_API_TOKEN." /></Card>}
      <div className="mb-3">
        <CashierMenuPanel storeUuid={null} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((s) => (
          <StoreCard key={s.uuid} s={s} health={health.data?.stores.find((h) => h.uuid === s.uuid)} now={health.data?.now ?? Date.now()} onChanged={reloadAll} />
        ))}
      </div>
      <TokensPanel allStoreUuids={list.map((s) => s.uuid)} />
      <DevicesPanel />
      <h2 className="mb-2 mt-6 text-base font-bold">Сотрудники</h2>
      {emp.loading && !emp.data && <Spinner />}
      {emp.error && <ErrorBox message={emp.error} onRetry={emp.reload} />}
      {emp.data && (!emp.data.employees.length ? <Card><EmptyState title="Сотрудников нет" /></Card> : (
        <Card pad={false}><ul className="divide-y divide-line text-sm">{emp.data.employees.map((e) => <li key={String(e.uuid)} className="flex justify-between gap-2 px-4 py-2.5"><span>{e.name ?? '—'}</span><span className="text-ink-secondary">{e.role ?? ''}</span></li>)}</ul></Card>
      ))}
    </section>
  )
}
