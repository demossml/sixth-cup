import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Copy, RefreshCw } from 'lucide-react'
import { api } from '../api/client'
import { useMeta } from '../meta'
import { useApi } from '../api/useApi'
import type { AuditEntry } from '../api/types'
import { fmtDateTime } from '../lib/format'
import { qs, setParams } from '../lib/query'
import { Badge, Banner, Button, Card, Check, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Skeleton, Spinner, Tabs, useToast } from '../ui/kit'
import { HelpLink } from '../components/HelpLink'
import type { Column } from '../ui/kit'

type Tab = 'logs' | 'audit' | 'ai' | 'orgs' | 'danger'

/* ───────── logs ───────── */
function Logs() {
  const toast = useToast()
  const [source, setSource] = useState('all')
  const [level, setLevel] = useState('all')
  const [lines, setLines] = useState(100)
  const [auto, setAuto] = useState(false)
  const [data, setData] = useState<{ lines: string[]; available: number; total: number; generatedAt: number } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const req = useRef(0)
  const load = useCallback(async () => {
    const id = ++req.current
    setBusy(true)
    try {
      const r = await api<NonNullable<typeof data>>(`/logs${qs({ source, level, lines })}`)
      if (id === req.current) { setData(r); setErr('') }
    } catch (e) { if (id === req.current) setErr(e instanceof Error ? e.message : 'Ошибка') } finally { if (id === req.current) setBusy(false) }
  }, [source, level, lines])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (!auto) return; const t = setInterval(load, 5000); return () => clearInterval(t) }, [auto, load])
  const copy = async () => {
    try { await navigator.clipboard.writeText((data?.lines ?? []).join('\n')); toast.push('Скопировано') } catch { toast.push('Не удалось скопировать', 'bad') }
  }
  const lineTone = (l: string) => (l.includes('[error]') ? 'text-red-300' : l.includes('[warn]') ? 'text-amber-300' : 'text-gray-200')
  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Источник"><option value="all">Все источники</option><option value="server">Сервер</option><option value="client">Приложение</option><option value="device">Касса</option></Select>
        <Select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Уровень"><option value="all">Все уровни</option><option value="error">Ошибки</option><option value="warn">Предупреждения</option><option value="info">Инфо</option></Select>
        <Select value={lines} onChange={(e) => setLines(Number(e.target.value))} aria-label="Строк"><option value={50}>50 строк</option><option value={100}>100 строк</option><option value={200}>200 строк</option><option value={500}>500 строк</option></Select>
        <Check checked={auto} onChange={setAuto} label="Автообновление" />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} loading={busy} onClick={load}>Обновить</Button>
        <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={copy} disabled={!data?.lines.length}>Копировать</Button>
        <Button size="sm" variant="ghost" onClick={async () => { try { await api('/logs/test', { method: 'POST' }); toast.push('Тестовая строка записана'); void load() } catch (e) { toast.push(String(e instanceof Error ? e.message : e), 'bad') } }}>Тестовая строка</Button>
      </div>
      {err && <ErrorBox message={err} onRetry={load} />}
      {data && (
        <>
          <p className="mb-2 text-xs text-ink-secondary">Показано {data.lines.length} из {data.available} · всего в буфере {data.total} · обновлено {fmtDateTime(data.generatedAt)}</p>
          {!data.lines.length ? <Card><EmptyState title="Строк нет" text="Попробуйте убрать фильтры." /></Card> : (
            <pre className="max-h-[60vh] overflow-auto rounded-2xl bg-gray-900 p-3 text-[11px] leading-relaxed">
              {data.lines.map((l, i) => <div key={i} className={`whitespace-pre-wrap break-all ${lineTone(l)}`}>{l}</div>)}
            </pre>
          )}
        </>
      )}
    </>
  )
}

/* ───────── audit ───────── */
function Audit() {
  const [only, setOnly] = useState(false)
  const [entity, setEntity] = useState('')
  const [rows, setRows] = useState<AuditEntry[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<AuditEntry | null>(null)
  const base = qs({ onlyErrors: only ? '1' : '', entity, limit: 50 })
  const load = useCallback(async (cursor?: string) => {
    setLoading(true)
    try {
      const r = await api<{ entries: AuditEntry[]; next: string | null }>(`/audit${base}${cursor ? `${base ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : ''}`)
      setRows((p) => (cursor ? [...p, ...r.entries] : r.entries)); setNext(r.next); setErr('')
    } catch (e) { setErr(e instanceof Error ? e.message : 'Ошибка') } finally { setLoading(false) }
  }, [base])
  useEffect(() => { void load() }, [load])
  const cols: Column<AuditEntry>[] = [
    { key: 't', header: 'Когда', primary: true, render: (a) => fmtDateTime(a.at) },
    { key: 's', header: 'Что', render: (a) => a.summary ?? `${a.method} ${a.path}` },
    { key: 'e', header: 'Раздел', render: (a) => a.entity ?? '—', hideOnPhone: true },
    { key: 'r', header: 'Итог', render: (a) => <Badge tone={a.ok ? 'ok' : 'bad'}>{a.ok ? 'OK' : `Ошибка ${a.status}`}</Badge> },
  ]
  const pretty = (s: string | null) => { if (!s) return null; try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s } }
  return (
    <>
      <div className="mb-3 grid gap-2 sm:grid-cols-[auto_auto_1fr]">
        <Select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Раздел"><option value="">Все разделы</option><option value="products">Товары</option><option value="customers">Клиенты</option><option value="categories">Группы</option><option value="promos">Акции</option><option value="evotor">Касса</option></Select>
        <Check checked={only} onChange={setOnly} label="Только ошибки" />
      </div>
      {err && <ErrorBox message={err} onRetry={() => load()} />}
      <DataTable rows={rows} columns={cols} rowKey={(a) => a.id} onRowClick={setOpen} empty={loading ? <Spinner /> : <EmptyState title="Записей нет" text="Здесь появляются все изменения, сделанные в админке." />} />
      {rows.length > 0 && <div className="mt-3 flex justify-center">{loading ? <Spinner /> : next ? <Button variant="secondary" onClick={() => load(next)}>Ещё</Button> : null}</div>}
      <Drawer open={!!open} onClose={() => setOpen(null)} title="Запись журнала" wide>
        {open && (
          <div className="space-y-3 text-sm">
            <div>{fmtDateTime(open.at)} · {open.actor} · {open.ip ?? ''}</div>
            <div className="break-all font-mono text-xs">{open.method} {open.path} → {open.status}</div>
            {open.summary && <p className="font-semibold">{open.summary}</p>}
            {open.before && <div><div className="mb-1 text-xs font-semibold text-ink-secondary">Было</div><pre className="overflow-auto rounded-xl bg-gray-50 p-3 text-xs">{pretty(open.before)}</pre></div>}
            {open.after && <div><div className="mb-1 text-xs font-semibold text-ink-secondary">Стало</div><pre className="overflow-auto rounded-xl bg-gray-50 p-3 text-xs">{pretty(open.after)}</pre></div>}
          </div>
        )}
      </Drawer>
    </>
  )
}


/* ───────── AI / DeepSeek ───────── */
function AiSettings() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [model, setModel] = useState('deepseek-chat')
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [keyHint, setKeyHint] = useState('')
  const [models, setModels] = useState<string[]>(['deepseek-chat', 'deepseek-reasoner'])
  const [ready, setReady] = useState(false)
  const load = useCallback(async () => {
    try {
      const r = await api<{
        enabled: boolean
        model: string
        hasKey: boolean
        keyHint: string
        models: string[]
        ready: boolean
      }>('/ai/settings')
      setEnabled(!!r.enabled)
      setModel(r.model || 'deepseek-chat')
      setHasKey(!!r.hasKey)
      setKeyHint(r.keyHint || '')
      setModels(r.models?.length ? r.models : ['deepseek-chat'])
      setReady(!!r.ready)
      setApiKey('')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось загрузить настройки ИИ', 'bad')
    }
  }, [toast])
  useEffect(() => { void load() }, [load])
  const save = async (clearKey = false) => {
    setBusy(true)
    try {
      const body: Record<string, unknown> = { enabled, model }
      if (clearKey) body.clearKey = true
      else if (apiKey.trim()) body.apiKey = apiKey.trim()
      const r = await api<{ ready: boolean; hasKey: boolean; keyHint: string }>('/ai/settings', { method: 'PUT', body })
      setHasKey(!!r.hasKey)
      setKeyHint(r.keyHint || '')
      setReady(!!r.ready)
      setApiKey('')
      toast.push(r.ready ? 'ИИ готов: DeepSeek подключён' : 'Сохранено. Включите ИИ и укажите ключ, чтобы Помощник работал.')
      await load()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка сохранения', 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Banner tone={ready ? 'ok' : 'warn'}>
        {ready
          ? 'DeepSeek подключён. Раздел «Помощник» отвечает живой моделью.'
          : 'Пока ключ не сохранён, Помощник не вызывает модель. Ключ хранится только на сервере, в интерфейс не отдаётся.'}
      </Banner>
      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Включить ИИ</div>
            <div className="text-xs text-ink-secondary">Без галочки эндпоинты /ai/* отвечают 503</div>
          </div>
          <Check checked={enabled} onChange={setEnabled} label="ИИ" />
        </div>
        <label className="mb-1 block text-sm font-medium">Провайдер</label>
        <Select value="deepseek" disabled aria-label="Провайдер">
          <option value="deepseek">DeepSeek</option>
        </Select>
        <label className="mb-1 mt-3 block text-sm font-medium">Модель</label>
        <Select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Модель">
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </Select>
        <label className="mb-1 mt-3 block text-sm font-medium">API-ключ DeepSeek</label>
        <Input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasKey ? `Сохранён: ${keyHint}` : 'sk-… из platform.deepseek.com'}
          aria-label="API-ключ DeepSeek"
        />
        <p className="mb-3 text-xs text-ink-secondary">
          Ключ берётся на platform.deepseek.com. В git и в браузерный бандл не попадает — только в app_settings на сервере.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button loading={busy} onClick={() => save(false)} className="w-full sm:w-auto">Сохранить</Button>
          {hasKey && (
            <Button loading={busy} variant="secondary" onClick={() => save(true)} className="w-full sm:w-auto">Удалить ключ</Button>
          )}
          <Button variant="ghost" onClick={() => void load()} className="w-full sm:w-auto">Обновить статус</Button>
        </div>
      </Card>
    </>
  )
}

/* ───────── danger zone ───────── */
function Danger() {
  const meta = useMeta()
  const toast = useToast()
  const [mode, setMode] = useState<'loyalty' | 'catalog' | 'full' | null>(null)
  const [busy, setBusy] = useState(false)
  const stats = useApi<{ users: number; receipts: number }>('/stats')
  if (!meta.resetAllowed) {
    return <Card><EmptyState title="Сброс данных отключён" text="На этом сервере сброс запрещён (ADMIN_ALLOW_RESET). Это защита от случайного удаления клиентов и истории." /></Card>
  }
  const LABEL = { loyalty: 'Сбросить лояльность', catalog: 'Сбросить каталог', full: 'Сбросить всё' } as const
  const TEXT = {
    loyalty: 'Будут стёрты карты, чашки, кэшбэк и история операций.',
    catalog: 'Будут стёрты товары, группы и добавки.',
    full: 'Будут стёрты лояльность и каталог.',
  } as const
  const run = async () => {
    if (!mode) return
    setBusy(true)
    try { await api('/reset', { method: 'POST', body: { mode, confirm: true } }); toast.push('Данные сброшены'); stats.reload(); setMode(null) }
    catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad') } finally { setBusy(false) }
  }
  return (
    <>
      <Banner tone="bad">Сброс необратим. Сейчас в базе клиентов: {stats.data?.users ?? '…'}. Включён только потому, что сервер запущен в режиме разработки или с ADMIN_ALLOW_RESET=1.</Banner>
      <div className="flex flex-wrap gap-2">
        {(['loyalty', 'catalog', 'full'] as const).map((m) => <Button key={m} variant="danger" onClick={() => setMode(m)}>{LABEL[m]}</Button>)}
      </div>
      <ConfirmDialog open={!!mode} danger typed="сбросить" confirmLabel="Сбросить" busy={busy} title={mode ? LABEL[mode] + '?' : ''} onCancel={() => setMode(null)} onConfirm={run}>{mode && TEXT[mode]} Восстановить нельзя.</ConfirmDialog>
    </>
  )
}

/* ───────── organizations (R-04) ───────── */
type Organization = {
  id: number; name: string; legalName: string; inn: string; kpp: string | null
  taxRegime: string; vatRate: number; active: number
}

const TAX_REGIMES = [
  { value: 'usn_income', label: 'УСН доходы' },
  { value: 'usn_income_expense', label: 'УСН доходы−расходы' },
  { value: 'osn', label: 'ОСН' },
  { value: 'patent', label: 'Патент' },
] as const

type OrgForm = { id?: number; name: string; legalName: string; inn: string; kpp: string; taxRegime: string; vatRate: string; active: boolean }
const emptyOrg = (): OrgForm => ({ name: '', legalName: '', inn: '', kpp: '', taxRegime: 'usn_income', vatRate: '0', active: true })

function Organizations() {
  const toast = useToast()
  const list = useApi<{ organizations: Organization[] }>('/organizations')
  const [form, setForm] = useState<OrgForm | null>(null)
  const [del, setDel] = useState<Organization | null>(null)
  const [busy, setBusy] = useState(false)

  const open = (o?: Organization) => setForm(o
    ? { id: o.id, name: o.name, legalName: o.legalName, inn: o.inn, kpp: o.kpp ?? '', taxRegime: o.taxRegime, vatRate: String(o.vatRate), active: !!o.active }
    : emptyOrg())

  const save = async () => {
    if (!form) return
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        legalName: form.legalName.trim(),
        inn: form.inn.trim(),
        kpp: form.kpp.trim() || null,
        taxRegime: form.taxRegime,
        vatRate: Number(form.vatRate) || 0,
        active: form.active,
      }
      if (form.id) await api(`/organizations/${form.id}`, { method: 'PATCH', body })
      else await api('/organizations', { method: 'POST', body })
      toast.push(form.id ? 'Юрлицо сохранено' : 'Юрлицо создано')
      setForm(null)
      list.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!del) return
    setBusy(true)
    try {
      await api(`/organizations/${del.id}`, { method: 'DELETE' })
      toast.push('Юрлицо удалено')
      setDel(null)
      list.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const cols: Column<Organization>[] = [
    { key: 'n', header: 'Юрлицо', primary: true, render: (o) => <span className="font-medium">{o.name}</span> },
    { key: 'ln', header: 'Полное название', render: (o) => <span className="text-ink-secondary">{o.legalName}</span>, hideOnPhone: true },
    { key: 'inn', header: 'ИНН', render: (o) => <span className="font-mono text-[12px]">{o.inn}</span> },
    { key: 'tax', header: 'СНО', render: (o) => TAX_REGIMES.find((t) => t.value === o.taxRegime)?.label ?? o.taxRegime, hideOnPhone: true },
    { key: 'vat', header: 'НДС', align: 'right', render: (o) => `${o.vatRate}%` },
    { key: 'st', header: 'Статус', render: (o) => (o.active ? <Badge tone="ok">активно</Badge> : <Badge tone="neutral">выкл</Badge>) },
    {
      key: 'x',
      header: '',
      align: 'right',
      render: (o) => (
        <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="secondary" aria-label={`Изменить юрлицо ${o.name}`} onClick={() => open(o)}>Изменить</Button>
          <Button size="sm" variant="ghost" aria-label={`Удалить юрлицо ${o.name}`} onClick={() => setDel(o)}>Удалить</Button>
        </span>
      ),
    },
  ]

  return (
    <>
      <div className="mb-3">
        <Button icon={<RefreshCw size={14} />} onClick={() => open()}>Новое юрлицо</Button>
      </div>

      {form && (
        <Card className="mb-4">
          <div className="mb-3 text-[14px] font-semibold">{form.id ? 'Юрлицо' : 'Новое юрлицо'}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Короткое название">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ИП Иванов" />
            </Field>
            <Field label="Полное название">
              <Input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} placeholder="Индивидуальный предприниматель Иванов И. И." />
            </Field>
            <Field label="ИНН" hint="10 или 12 цифр">
              <Input value={form.inn} onChange={(e) => setForm({ ...form, inn: e.target.value })} placeholder="7700000000" />
            </Field>
            <Field label="КПП" hint="необязательно">
              <Input value={form.kpp} onChange={(e) => setForm({ ...form, kpp: e.target.value })} placeholder="—" />
            </Field>
            <Field label="СНО">
              <Select value={form.taxRegime} onChange={(e) => setForm({ ...form, taxRegime: e.target.value })}>
                {TAX_REGIMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Ставка НДС, %">
              <Input type="number" min={0} max={22} value={form.vatRate} onChange={(e) => setForm({ ...form, vatRate: e.target.value })} />
            </Field>
          </div>
          <div className="mt-2"><Check checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Активно" /></div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button loading={busy} onClick={save} disabled={!form.name.trim() || !form.legalName.trim() || form.inn.trim().length < 10}>Сохранить</Button>
            <Button variant="ghost" onClick={() => setForm(null)}>Отмена</Button>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={!!del}
        danger
        busy={busy}
        title="Удалить юрлицо?"
        confirmLabel="Удалить"
        onCancel={() => setDel(null)}
        onConfirm={remove}
      >
        {del && `«${del.name}» будет удалено. Если к нему привязаны точки — удаление запрещено: сначала переназначьте точки.`}
      </ConfirmDialog>

      {list.loading && !list.data && <Card><Skeleton className="h-20" /></Card>}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data && (
        <DataTable
          rows={list.data.organizations}
          columns={cols}
          rowKey={(o) => o.id}
          empty={<EmptyState title="Юрлиц ещё нет" text="Реквизиты нужны кассе для чеков: СНО и НДС попадают в каталог устройства." />}
        />
      )}
    </>
  )
}

export default function System() {
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') ?? 'logs') as Tab
  const meta = useMeta()
  return (
    <>
      <PageHeader title="Система" subtitle={meta.production ? 'Рабочий сервер' : 'Режим разработки'} actions={<HelpLink article="roles" label="Роли" />} />
      <Tabs items={[{ key: 'logs', label: 'Логи' }, { key: 'audit', label: 'Журнал' }, { key: 'ai', label: 'ИИ' }, { key: 'orgs', label: 'Юрлица' }, { key: 'danger', label: 'Опасная зона' }]} value={tab} onChange={(k) => setSp(setParams(sp, { tab: k }), { replace: true })} />
      {tab === 'logs' ? <Logs /> : tab === 'audit' ? <Audit /> : tab === 'ai' ? <AiSettings /> : tab === 'orgs' ? <Organizations /> : <Danger />}
    </>
  )
}
