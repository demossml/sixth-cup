import { useState } from 'react'
import { useApi } from '../../api/useApi'
import { api } from '../../api/client'
import { Badge, Button, Card, DataTable, EmptyState, ErrorBox, Field, Select, Skeleton, useToast } from '../../ui/kit'
import type { Column, Tone } from '../../ui/kit'
import { Plus, Trash2, Truck } from 'lucide-react'

type ReturnLine = { stockItemId: number; qty: number; priceKop: number }
type SupplierReturn = {
  id: number
  supplierId: number
  basis: string
  status: string
  notes: string | null
  postedAt: number | null
  createdAt: number
  lines: ReturnLine[]
}
type Supplier = { id: number; name: string }
type StockItem = { id: number; name: string; unit: string }

const BASES = ['Брак', 'Срок', 'Пересорт', 'Прочее'] as const

const STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'черновик', tone: 'neutral' },
  shipped: { label: 'отгружен', tone: 'brand' },
  posted: { label: 'проведён', tone: 'ok' },
  cancelled: { label: 'отменён', tone: 'bad' },
}

const money = (kop: number) => new Intl.NumberFormat('ru-RU').format(kop / 100) + ' ₽'
const day = (ts: number) => new Date(ts).toLocaleDateString('ru-RU')

type Draft = { key: string; stockItemId: string; qty: string; priceRub: string }
const emptyLine = (): Draft => ({ key: String(Date.now()) + Math.random(), stockItemId: '', qty: '1', priceRub: '0' })

export default function ReturnsTab({ suppliers, items }: { suppliers: Supplier[]; items: StockItem[] }) {
  const toast = useToast()
  const list = useApi<{ returns: SupplierReturn[] }>('/purchases/returns')
  const [busy, setBusy] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [basis, setBasis] = useState<string>('Брак')
  const [lines, setLines] = useState<Draft[]>([emptyLine()])

  const nameOf = (id: number) => suppliers.find((s) => s.id === id)?.name ?? `#${id}`
  const itemName = (id: number) => items.find((s) => s.id === id)?.name ?? `#${id}`
  const total = (r: SupplierReturn) => r.lines.reduce((s, l) => s + Math.round(l.qty * l.priceKop), 0)

  const create = async () => {
    const parsed = lines
      .map((l) => ({
        stockItemId: Number(l.stockItemId),
        qty: Number(l.qty) || 0,
        priceKop: Math.round((Number(l.priceRub) || 0) * 100),
      }))
      .filter((l) => l.stockItemId > 0 && l.qty > 0)
    if (!supplierId || !parsed.length) {
      toast.push('Выберите поставщика и хотя бы одну позицию', 'bad')
      return
    }
    setBusy(true)
    try {
      const res = await api<{ id: number }>('/purchases/returns', {
        method: 'POST',
        body: { supplierId: Number(supplierId), basis, lines: parsed },
      })
      toast.push(`Возврат №${res.id} создан (черновик)`)
      setLines([emptyLine()])
      list.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const post = async (r: SupplierReturn) => {
    setBusy(true)
    try {
      await api(`/purchases/returns/${r.id}/post`, { method: 'POST' })
      toast.push('Возврат проведён — склад уменьшен')
      list.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (r: SupplierReturn) => {
    setBusy(true)
    try {
      await api(`/purchases/returns/${r.id}`, { method: 'PATCH', body: { status: 'cancelled' } })
      toast.push('Возврат отменён')
      list.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const cols: Column<SupplierReturn>[] = [
      { key: 'n', header: 'Возврат', render: (r) => `ВЗ-${r.id}`, primary: true },
      { key: 's', header: 'Поставщик', render: (r) => nameOf(r.supplierId) },
      { key: 'b', header: 'Основание', render: (r) => r.basis, hideOnPhone: true },
      {
        key: 'l',
        header: 'Состав',
        render: (r) => (
          <span className="text-ink-secondary">
            {r.lines.map((l) => `${itemName(l.stockItemId)} × ${l.qty}`).join(', ') || '—'}
          </span>
        ),
        hideOnPhone: true,
      },
      { key: 't', header: 'Сумма', align: 'right', render: (r) => money(total(r)) },
      { key: 'd', header: 'Создан', render: (r) => day(r.createdAt), hideOnPhone: true },
      {
        key: 'st',
        header: 'Статус',
        render: (r) => {
          const s = STATUS[r.status] ?? { label: r.status, tone: 'neutral' as Tone }
          return <Badge tone={s.tone}>{s.label}</Badge>
        },
      },
      {
        key: 'a',
        header: '',
        align: 'right',
        render: (r) => (
          <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {r.status !== 'posted' && r.status !== 'cancelled' && (
              <>
                <Button size="sm" icon={<Truck size={14} />} loading={busy} onClick={() => post(r)}>
                  Провести
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Отменить возврат ${r.id}`} onClick={() => cancel(r)}>
                  <Trash2 size={14} />
                </Button>
              </>
            )}
          </span>
        ),
      },
  ]

  return (
    <div className="space-y-3">
      <Card>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Поставщик">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— выберите —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Основание">
            <Select value={basis} onChange={(e) => setBasis(e.target.value)}>
              {BASES.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="mt-3 space-y-2">
          {lines.map((l, i) => (
            <div key={l.key} className="flex flex-wrap items-end gap-2">
              <Field label={i === 0 ? 'Позиция' : ''}>
                <Select
                  value={l.stockItemId}
                  onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, stockItemId: e.target.value } : x)))}
                >
                  <option value="">—</option>
                  {items.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}, {s.unit}</option>
                  ))}
                </Select>
              </Field>
              <Field label={i === 0 ? 'Кол-во' : ''}>
                <input
                  className="w-24 rounded-xl border border-line bg-card px-3 py-2 text-sm"
                  inputMode="decimal"
                  value={l.qty}
                  onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))}
                />
              </Field>
              <Field label={i === 0 ? 'Цена, ₽' : ''}>
                <input
                  className="w-28 rounded-xl border border-line bg-card px-3 py-2 text-sm"
                  inputMode="decimal"
                  value={l.priceRub}
                  onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, priceRub: e.target.value } : x)))}
                />
              </Field>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Убрать позицию"
                onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setLines([...lines, emptyLine()])}>
            Ещё позиция
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button loading={busy} onClick={create}>Создать черновик возврата</Button>
          <span className="text-xs text-ink-secondary">
            Проведение списывает сырьё по FEFO. Долг поставщику не уменьшается автоматически —
            нужна отдельная корректировка оплат.
          </span>
        </div>
      </Card>

      {list.loading && !list.data && (
        <Card>
          <Skeleton className="h-24" />
        </Card>
      )}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data && (
        <DataTable
          rows={list.data.returns}
          columns={cols}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              title="Возвратов нет"
              text="Возврат — документ на брак, срок или пересорт. Склад меняется только после «Провести»."
            />
          }
        />
      )}
    </div>
  )
}
