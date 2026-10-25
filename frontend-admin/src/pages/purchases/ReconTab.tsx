import { useState } from 'react'
import { useApi } from '../../api/useApi'
import { api } from '../../api/client'
import { Badge, Button, Card, DataTable, EmptyState, ErrorBox, Field, Select, Skeleton, useToast } from '../../ui/kit'
import type { Column, Tone } from '../../ui/kit'

type Recon = {
  id: number
  supplierId: number
  periodFrom: number
  periodTo: number
  theirBalanceKop: number | null
  status: string
  notes: string | null
  turnoverKop: number
  paidKop: number
  ourBalanceKop: number
  diffKop: number | null
}

type Supplier = { id: number; name: string }

const money = (kop: number) => new Intl.NumberFormat('ru-RU').format(kop / 100) + ' ₽'
const day = (ts: number) => new Date(ts).toLocaleDateString('ru-RU')
const isoDay = (ts: number) => new Date(ts).toISOString().slice(0, 10)

const STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'черновик', tone: 'neutral' },
  sent: { label: 'отправлена', tone: 'brand' },
  agreed: { label: 'согласована', tone: 'ok' },
  mismatch: { label: 'расхождение', tone: 'bad' },
}

export default function ReconTab({ suppliers }: { suppliers: Supplier[] }) {
  const toast = useToast()
  const list = useApi<{ reconciliations: Recon[] }>('/purchases/reconciliations')
  const [supplierId, setSupplierId] = useState('')
  const [from, setFrom] = useState(() => isoDay(Date.now() - 30 * 86400000))
  const [to, setTo] = useState(() => isoDay(Date.now()))
  const [busy, setBusy] = useState(false)

  const nameOf = (id: number) => suppliers.find((s) => s.id === id)?.name ?? `#${id}`

  const create = async () => {
    if (!supplierId) {
      toast.push('Выберите поставщика', 'bad')
      return
    }
    const periodFrom = Date.parse(`${from}T00:00:00`)
    const periodTo = Date.parse(`${to}T23:59:59`)
    if (Number.isNaN(periodFrom) || Number.isNaN(periodTo)) {
      toast.push('Проверьте даты периода', 'bad')
      return
    }
    setBusy(true)
    try {
      await api('/purchases/reconciliations', {
        method: 'POST',
        body: { supplierId: Number(supplierId), periodFrom, periodTo },
      })
      toast.push('Сверка создана — введите сумму поставщика')
      list.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const patch = async (r: Recon, body: { status?: string; theirBalanceKop?: number | null }) => {
    setBusy(true)
    try {
      await api(`/purchases/reconciliations/${r.id}`, { method: 'PATCH', body })
      toast.push('Сверка обновлена')
      list.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const cols: Column<Recon>[] = [
    { key: 's', header: 'Поставщик', render: (r) => nameOf(r.supplierId), primary: true },
    {
      key: 'p',
      header: 'Период',
      render: (r) => `${day(r.periodFrom)} — ${day(r.periodTo)}`,
      hideOnPhone: true,
    },
    { key: 't', header: 'Оборот', align: 'right', render: (r) => money(r.turnoverKop), hideOnPhone: true },
    { key: 'o', header: 'Наш долг', align: 'right', render: (r) => money(r.ourBalanceKop) },
    {
      key: 'th',
      header: 'По данным поставщика',
      align: 'right',
      render: (r) => (
        <input
          className="w-28 rounded-lg border border-line bg-card px-2 py-1 text-right text-sm"
          inputMode="decimal"
          defaultValue={r.theirBalanceKop == null ? '' : String(r.theirBalanceKop / 100)}
          placeholder="0"
          aria-label={`Сумма поставщика для сверки ${r.id}`}
          onBlur={(e) => {
            const raw = e.target.value.trim()
            if (!raw) return
            const kop = Math.round(Number(raw.replace(/\s/g, '').replace(',', '.')) * 100)
            if (!Number.isFinite(kop) || kop === r.theirBalanceKop) return
            patch(r, { theirBalanceKop: kop })
          }}
        />
      ),
    },
    {
      key: 'd',
      header: 'Расхождение',
      align: 'right',
      render: (r) =>
        r.diffKop == null ? (
          <span className="text-ink-tertiary">—</span>
        ) : r.diffKop === 0 ? (
          <Badge tone="ok">сходится</Badge>
        ) : (
          <Badge tone="bad">{money(r.diffKop)}</Badge>
        ),
    },
    {
      key: 'st',
      header: 'Статус',
      render: (r) => {
        const s = STATUS[r.status] ?? { label: r.status, tone: 'neutral' as Tone }
        return (
          <Select
            value={r.status}
            aria-label={`Статус сверки ${r.id}`}
            onChange={(e) => patch(r, { status: e.target.value })}
          >
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
            {!STATUS[r.status] && <option value={r.status}>{s.label}</option>}
          </Select>
        )
      },
    },
  ]

  return (
    <div className="space-y-3">
      <Card>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Поставщик">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— выберите —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Период с">
            <input
              type="date"
              className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="по">
            <input
              type="date"
              className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button loading={busy} onClick={create}>Создать сверку</Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-secondary">
          Оборот и наш долг считаются по проведённым накладным и оплатам за период. Сумма поставщика
          сравнивается с ними автоматически.
        </p>
      </Card>

      {list.loading && !list.data && (
        <Card>
          <Skeleton className="h-24" />
        </Card>
      )}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data && (
        <DataTable
          rows={list.data.reconciliations}
          columns={cols}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              title="Сверок пока нет"
              text="Сверка фиксирует расхождение с поставщиком за период: наш долг против его данных."
            />
          }
        />
      )}
    </div>
  )
}
