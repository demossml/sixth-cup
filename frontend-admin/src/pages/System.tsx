import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Copy, RefreshCw } from 'lucide-react'
import { api } from '../api/client'
import { useMeta } from '../meta'
import { useApi } from '../api/useApi'
import type { AuditEntry } from '../api/types'
import { fmtDateTime } from '../lib/format'
import { qs, setParams } from '../lib/query'
import { Badge, Banner, Button, Card, Check, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorBox, PageHeader, Select, Spinner, Tabs, useToast } from '../ui/kit'
import type { Column } from '../ui/kit'

type Tab = 'logs' | 'audit' | 'danger'

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

export default function System() {
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') ?? 'logs') as Tab
  const meta = useMeta()
  return (
    <>
      <PageHeader title="Система" subtitle={meta.production ? 'Рабочий сервер' : 'Режим разработки'} />
      <Tabs items={[{ key: 'logs', label: 'Логи' }, { key: 'audit', label: 'Журнал действий' }, { key: 'danger', label: 'Опасная зона' }]} value={tab} onChange={(k) => setSp(setParams(sp, { tab: k }), { replace: true })} />
      {tab === 'logs' ? <Logs /> : tab === 'audit' ? <Audit /> : <Danger />}
    </>
  )
}
