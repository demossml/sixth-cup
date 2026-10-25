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
  invoiceId: number | null
  matched: boolean
}

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
  const amount = Number(amountRaw.replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(amount) || amount === 0) return `сумма не распознана: «${amountRaw}»`
  return {
    dateAt,
    party: rest[0] || null,
    purpose: rest[1] || null,
    amountKop: Math.round(amount * 100),
  }
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

export default function BankTab() {
  const toast = useToast()
  const rows = useApi<{ rows: BankRow[] }>('/purchases/bank-rows')
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
          <Badge tone="ok">накладная #{r.invoiceId}</Badge>
        ) : r.supplierId ? (
          <Badge tone="warn">поставщик без накладной</Badge>
        ) : (
          <Badge tone="neutral">не найдено</Badge>
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
