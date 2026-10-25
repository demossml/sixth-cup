import { useMemo, useState } from 'react'
import { useApi } from '../../api/useApi'
import { api } from '../../api/client'
import { Badge, Button, Card, DataTable, EmptyState, ErrorBox, Field, Select, Skeleton, useToast } from '../../ui/kit'
import type { Column, Tone } from '../../ui/kit'
import { Check, FileInput, Plus, Trash2, Wand2 } from 'lucide-react'

type OrderLine = { lineId: number; stockItemId: number; qty: number; priceKop: number; receivedQty: number }
type Order = {
  id: number
  supplierId: number
  status: string
  deliveryAt: number | null
  notes: string | null
  createdAt: number
  lines: OrderLine[]
}
type Supplier = { id: number; name: string }
type StockItem = { id: number; name: string; unit: string }
type Helper = { items: { id: number; name: string; suggestQty: number; priceKop: number }[] }

const money = (kop: number) => new Intl.NumberFormat('ru-RU').format(kop / 100) + ' ₽'
const day = (ts: number) => new Date(ts).toLocaleDateString('ru-RU')

const STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'черновик', tone: 'neutral' },
  confirmed: { label: 'подтверждён', tone: 'brand' },
  sent: { label: 'отправлен', tone: 'brand' },
  partial: { label: 'частично принят', tone: 'warn' },
  closed: { label: 'закрыт', tone: 'ok' },
}

type Draft = { key: string; stockItemId: string; qty: string; priceRub: string }
const emptyLine = (): Draft => ({ key: String(Date.now()) + Math.random(), stockItemId: '', qty: '1', priceRub: '0' })

export default function OrdersTab({ suppliers, items, onInvoiceCreated }: {
  suppliers: Supplier[]
  items: StockItem[]
  /** Накладная создана из заказа — списку накладных и долгам нужно обновиться. */
  onInvoiceCreated?: () => void
}) {
  const toast = useToast()
  const list = useApi<{ orders: Order[] }>('/purchases/orders')
  const [busy, setBusy] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [deliveryAt, setDeliveryAt] = useState('')
  const [lines, setLines] = useState<Draft[]>([emptyLine()])
  const [del, setDel] = useState<Order | null>(null)

  const nameOf = (id: number) => suppliers.find((s) => s.id === id)?.name ?? `#${id}`
  const itemName = (id: number) => items.find((s) => s.id === id)?.name ?? `#${id}`
  const total = (o: Order) => o.lines.reduce((s, l) => s + Math.round(l.qty * l.priceKop), 0)

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
      const res = await api<{ id: number }>('/purchases/orders', {
        method: 'POST',
        body: {
          supplierId: Number(supplierId),
          deliveryAt: deliveryAt ? Date.parse(`${deliveryAt}T12:00:00`) : null,
          lines: parsed,
        },
      })
      toast.push(`Заказ ЗК-${res.id} создан (черновик)`)
      setLines([emptyLine()])
      setDeliveryAt('')
      list.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const fillFromHelper = async () => {
    setBusy(true)
    try {
      const res = await api<Helper>('/purchases/order-helper?horizon=7')
      const useful = res.items.slice(0, 20)
      if (!useful.length) {
        toast.push('Подсказок нет: нет продаж или остатки выше минимума', 'bad')
        return
      }
      setLines(
        useful.map((i) => ({
          key: `h${i.id}`,
          stockItemId: String(i.id),
          qty: String(i.suggestQty),
          priceRub: String(i.priceKop / 100),
        })),
      )
      toast.push(`Подставлено ${useful.length} позиций на 7 дней`)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const patchStatus = async (o: Order, status: string) => {
    setBusy(true)
    try {
      await api(`/purchases/orders/${o.id}`, { method: 'PATCH', body: { status } })
      toast.push(`Заказ ЗК-${o.id}: ${STATUS[status]?.label ?? status}`)
      list.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const toInvoice = async (o: Order) => {
    setBusy(true)
    try {
      const res = await api<{ invoiceId: number }>(`/purchases/orders/${o.id}/to-invoice`, { method: 'POST' })
      toast.push(`Создана накладная №${res.invoiceId} — проведите её во вкладке «Накладные»`)
      list.reload()
      onInvoiceCreated?.()
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
      await api(`/purchases/orders/${del.id}`, { method: 'DELETE' })
      toast.push('Черновик удалён')
      setDel(null)
      list.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const cols: Column<Order>[] = useMemo(
    () => [
      { key: 'n', header: 'Заказ', render: (o) => `ЗК-${o.id}`, primary: true },
      { key: 's', header: 'Поставщик', render: (o) => nameOf(o.supplierId) },
      {
        key: 'd',
        header: 'Поставка',
        render: (o) => (o.deliveryAt ? day(o.deliveryAt) : '—'),
        hideOnPhone: true,
      },
      {
        key: 'l',
        header: 'Состав',
        render: (o) => (
          <span className="text-ink-secondary">
            {o.lines.map((l) => `${itemName(l.stockItemId)} × ${l.qty}`).join(', ') || '—'}
          </span>
        ),
        hideOnPhone: true,
      },
      { key: 't', header: 'Сумма', align: 'right', render: (o) => money(total(o)) },
      {
        key: 'st',
        header: 'Статус',
        render: (o) => {
          const s = STATUS[o.status] ?? { label: o.status, tone: 'neutral' as Tone }
          return <Badge tone={s.tone}>{s.label}</Badge>
        },
      },
      {
        key: 'a',
        header: '',
        align: 'right',
        render: (o) => (
          <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {o.status === 'draft' && (
              <>
                <Button size="sm" variant="secondary" icon={<Check size={14} />} onClick={() => patchStatus(o, 'confirmed')}>
                  Подтвердить
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Удалить заказ ${o.id}`} onClick={() => setDel(o)}>
                  <Trash2 size={14} />
                </Button>
              </>
            )}
            {o.status !== 'draft' && o.status !== 'closed' && (
              <Button size="sm" icon={<FileInput size={14} />} onClick={() => toInvoice(o)}>
                В накладную
              </Button>
            )}
          </span>
        ),
      },
    ],
    [suppliers, items],
  )

  return (
    <div className="space-y-3">
      <Card>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Поставщик">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— выберите —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Дата поставки" hint="Необязательно">
            <input
              type="date"
              className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm"
              value={deliveryAt}
              onChange={(e) => setDeliveryAt(e.target.value)}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Button icon={<Wand2 size={16} />} variant="secondary" loading={busy} onClick={fillFromHelper}>
              Подсказать
            </Button>
          </div>
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
              <Button size="sm" variant="ghost" aria-label="Убрать позицию" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setLines([...lines, emptyLine()])}>
            Ещё позиция
          </Button>
        </div>

        <div className="mt-3">
          <Button loading={busy} onClick={create}>Создать черновик заказа</Button>
        </div>
      </Card>

      {del && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>Удалить заказ ЗК-{del.id}?</span>
            <span className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDel(null)}>Отмена</Button>
              <Button size="sm" loading={busy} onClick={remove}>Удалить</Button>
            </span>
          </div>
        </Card>
      )}

      {list.loading && !list.data && (
        <Card>
          <Skeleton className="h-24" />
        </Card>
      )}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data && (
        <DataTable
          rows={list.data.orders}
          columns={cols}
          rowKey={(o) => o.id}
          empty={
            <EmptyState
              title="Заказов нет"
              text="Заказ → подтверждение → «В накладную»: так склад получает документ, который потом проводится."
            />
          }
        />
      )}
    </div>
  )
}
