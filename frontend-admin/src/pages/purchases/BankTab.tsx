import { useMemo, useState } from 'react'
import { useApi } from '../../api/useApi'
import { api } from '../../api/client'
import { Badge, Button, Card, DataTable, EmptyState, ErrorBox, Field, Skeleton, useToast } from '../../ui/kit'
import type { Column } from '../../ui/kit'
import { Trash2, Upload } from 'lucide-react'

type BankRow = {
  id: number
  dateAt: number
  party: string | null
  purpose: string | null
  amountKop: number
  supplierId: number | null
  supplierName: string | null
  invoiceId: number | null
  invoiceNumber: string | null
  paymentId: number | null
  paid: boolean
  matched: boolean
}

type InvoiceOption = { id: number; number: string | null; supplierName: string; totalKop: number }

const money = (kop: number) => new Intl.NumberFormat('ru-RU').format(kop / 100) + ' ₽'
const day = (ts: number) => new Date(ts).toLocaleDateString('ru-RU')

type Parsed = { dateAt: number; party: string | null; purpose: string | null; amountKop: number }

/** Одна строка выписки: `дата; контрагент; назначение; сумма` (разделитель `;` или таб). */
export function parseBankLine(line: string): Parsed | string {
  const parts = line.split(/[;\t]/).map((s) => s.trim())
  if (parts.length < 2) return 'нужно минимум «дата; сумма»'
  const [rawDate, ...rest] = parts
  const amountRaw = rest.pop() ?? ''
  const dateAt = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? `${rawDate}T12:00:00` : rawDate)
  if (Number.isNaN(dateAt)) return `дата не распознана: «${rawDate}»`
  let normalized = amountRaw.replace(/\s/g, '').replace(/[₽рР]/g, '')
  // «12.500,00» — точка как разделитель тысяч; «12,50» и «12.50» — обычные дроби
  if (normalized.includes(',')) normalized = normalized.replace(/\./g, '').replace(',', '.')
  const amount = Number(normalized.replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(amount) || amount === 0) return `сумма не распознана: «${amountRaw}»`
  return {
    dateAt,
    party: rest[0] || null,
    purpose: rest[1] || null,
    amountKop: Math.round(amount * 100),
  }
}

/** Оплату из строки можно провести, когда есть привязанная накладная и платежа ещё нет. */
export function canPayRow(row: Pick<BankRow, 'invoiceId' | 'paymentId'>): boolean {
  return row.invoiceId != null && row.paymentId == null
}

export function parseBankText(text: string): { rows: Parsed[]; errors: string[] } {
  const rows: Parsed[] = []
  const errors: string[] = []
  text.split('\n').forEach((line, i) => {
    const t = line.trim()
    if (!t) return
    const r = parseBankLine(t)
    if (typeof r === 'string') errors.push(`Строка ${i + 1}: ${r}`)
    else rows.push(r)
  })
  return { rows, errors }
}

export default function BankTab({ onPaid }: { onPaid?: () => void } = {}) {
  const toast = useToast()
  const rows = useApi<{ rows: BankRow[] }>('/purchases/bank-rows')
  const invoices = useApi<{ invoices: InvoiceOption[] }>('/purchases/invoices')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState<BankRow | null>(null)

  const parsed = useMemo(() => parseBankText(text), [text])

  const importRows = async () => {
    if (!parsed.rows.length) {
      toast.push('Нет строк для импорта', 'bad')
      return
    }
    setBusy(true)
    try {
      const res = await api<{ imported: number; matched: number }>('/purchases/bank-rows', {
        method: 'POST',
        body: { rows: parsed.rows },
      })
      toast.push(`Загружено ${res.imported}, сопоставлено с накладными ${res.matched}`)
      setText('')
      rows.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const link = async (row: BankRow, invoiceId: number | null) => {
    setBusy(true)
    try {
      await api(`/purchases/bank-rows/${row.id}`, {
        method: 'PATCH',
        body: invoiceId == null ? { invoiceId: null, supplierId: null } : { invoiceId },
      })
      toast.push(invoiceId == null ? 'Привязка снята' : 'Строка привязана к накладной')
      rows.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const pay = async (row: BankRow) => {
    setBusy(true)
    try {
      const res = await api<{ paymentId: number; idempotent?: boolean }>(`/purchases/bank-rows/${row.id}/pay`, {
        method: 'POST',
      })
      toast.push(res.idempotent ? 'Оплата уже проведена' : 'Оплата проведена — долг уменьшился')
      rows.reload()
      onPaid?.()
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
      await api(`/purchases/bank-rows/${del.id}`, { method: 'DELETE' })
      toast.push('Строка удалена')
      setDel(null)
      rows.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const cols: Column<BankRow>[] = [
    { key: 'd', header: 'Дата', render: (r) => day(r.dateAt), primary: true },
    { key: 'p', header: 'Контрагент', render: (r) => r.party ?? '—' },
    {
      key: 'u',
      header: 'Назначение',
      render: (r) => <span className="text-ink-secondary">{r.purpose ?? '—'}</span>,
      hideOnPhone: true,
    },
    { key: 'm', header: 'Сумма', align: 'right', render: (r) => money(r.amountKop) },
    {
      key: 's',
      header: 'Сопоставление',
      render: (r) =>
        r.matched ? (
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="ok">накладная {r.invoiceNumber ?? `#${r.invoiceId}`}</Badge>
            {r.paid ? (
              <Badge tone="brand">оплачено</Badge>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                aria-label={`Провести оплату по строке от ${day(r.dateAt)}`}
                onClick={() => pay(r)}
              >
                Провести оплату
              </Button>
            )}
            <button
              type="button"
              className="text-xs text-ink-secondary underline"
              aria-label={`Снять привязку строки от ${day(r.dateAt)}`}
              onClick={() => link(r, null)}
            >
              отвязать
            </button>
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            {r.supplierId ? (
              <Badge tone="warn">{r.supplierName ?? 'поставщик'} без накладной</Badge>
            ) : (
              <Badge tone="neutral">не найдено</Badge>
            )}
            <select
              className="max-w-[220px] rounded-lg border border-line bg-card px-2 py-1 text-xs"
              defaultValue=""
              aria-label={`Привязать строку от ${day(r.dateAt)} к накладной`}
              onChange={(e) => {
                const id = Number(e.target.value)
                if (id > 0) link(r, id)
                e.currentTarget.value = ''
              }}
            >
              <option value="">привязать к накладной…</option>
              {[...(invoices.data?.invoices ?? [])]
                .sort((a, b) => Number(b.supplierName === r.supplierName) - Number(a.supplierName === r.supplierName))
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number ?? `#${i.id}`} · {i.supplierName}
                  </option>
                ))}
            </select>
          </span>
        ),
    },
    {
      key: 'x',
      header: '',
      align: 'right',
      render: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" aria-label={`Удалить строку от ${day(r.dateAt)}`} onClick={() => setDel(r)}>
            <Trash2 size={14} />
          </Button>
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-ink-secondary">
        Два шага: <b>сопоставить</b> строку с накладной (долг не меняется), затем{' '}
        <b>«Провести оплату»</b> — только она создаёт платёж и уменьшает долг в «Долгах» и «Сверках».
      </p>

      <Card>
        <Field
          label="Импорт выписки"
          hint="По одной строке на платёж: дата; контрагент; назначение; сумма. Разделитель «;» или таб. Сумма в рублях, минус — расход."
        >
          <textarea
            className="min-h-[120px] w-full rounded-xl border border-line bg-card px-3 py-2 font-mono text-xs"
            placeholder={'2026-10-24; ООО Ромашка; Оплата по счёту 154; 12 500,00'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button icon={<Upload size={16} />} loading={busy} onClick={importRows} disabled={!parsed.rows.length}>
            Загрузить{parsed.rows.length ? ` (${parsed.rows.length})` : ''}
          </Button>
          {parsed.errors.length > 0 && (
            <span className="text-xs text-ink-secondary">
              {parsed.errors[0]}
              {parsed.errors.length > 1 ? ` и ещё ${parsed.errors.length - 1}` : ''}
            </span>
          )}
        </div>
      </Card>

      {del && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              Удалить строку от {day(del.dateAt)} на {money(del.amountKop)}?
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDel(null)}>Отмена</Button>
              <Button size="sm" loading={busy} onClick={remove}>Удалить</Button>
            </span>
          </div>
        </Card>
      )}

      {rows.loading && !rows.data && (
        <Card>
          <Skeleton className="h-24" />
        </Card>
      )}
      {rows.error && <ErrorBox message={rows.error} onRetry={rows.reload} />}
      {rows.data && (
        <DataTable
          rows={rows.data.rows}
          columns={cols}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              title="Выписки ещё нет"
              text="Вставьте строки из банка выше — система сама найдёт поставщика и накладную по номеру в назначении."
            />
          }
        />
      )}
    </div>
  )
}
