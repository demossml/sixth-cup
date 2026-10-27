import { useState } from 'react'
import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Skeleton, useToast } from '../../ui/kit'
import { Plus, Trash2 } from 'lucide-react'
import { StorePicker, type StoreOption } from '../shared'

type StockItem = { id: number; name: string; unit: string }

type WriteoffLine = { stockItemId: number; qty: number; itemName: string; unit: string }

type Writeoff = {
  id: number
  storeUuid: string | null
  storeName: string | null
  reason: string
  notes: string | null
  postedAt: number
  lines: WriteoffLine[]
}

type Draft = { key: string; stockItemId: string; qty: string }
const emptyDraft = (): Draft => ({ key: String(Date.now()) + Math.random(), stockItemId: '', qty: '1' })

/** Причины списания: код на сервере, подпись для владельца. */
export const WRITEOFF_REASONS: { value: string; label: string }[] = [
  { value: 'spoilage', label: 'Порча' },
  { value: 'expired', label: 'Истёк срок' },
  { value: 'staff', label: 'Персонал' },
  { value: 'tasting', label: 'Пробные' },
  { value: 'other', label: 'Прочее' },
]

export function reasonLabel(reason: string): string {
  return WRITEOFF_REASONS.find((r) => r.value === reason)?.label ?? reason
}

const day = (ms: number) => new Date(ms).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

export default function WriteoffsTab({ items }: { items: StockItem[] }) {
  const toast = useToast()
  const list = useApi<{ writeoffs: Writeoff[] }>('/stock/writeoffs')
  const stores = useApi<{ stores: StoreOption[] }>('/stock/stores')
  const [storeUuid, setStoreUuid] = useState('')
  const [reason, setReason] = useState('spoilage')
  const [notes, setNotes] = useState('')
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft()])
  const [busy, setBusy] = useState(false)

  const unitOf = (stockItemId: string) => items.find((x) => String(x.id) === stockItemId)?.unit ?? ''

  const submit = async () => {
    const lines = drafts
      .map((d) => ({ stockItemId: Number(d.stockItemId), qty: Number(d.qty) || 0 }))
      .filter((l) => l.stockItemId > 0 && l.qty > 0)
    if (!lines.length) {
      toast.push('Добавьте хотя бы одну позицию', 'bad')
      return
    }
    setBusy(true)
    try {
      const res = await api<{ id: number }>('/stock/writeoffs', {
        method: 'POST',
        body: { storeUuid: storeUuid || null, reason, notes: notes.trim() || null, lines },
      })
      toast.push(`Списание №${res.id} проведено`)
      setDrafts([emptyDraft()])
      setNotes('')
      list.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 text-[14px] font-semibold">Новое списание</div>
        <p className="mb-3 text-[12px] text-ink-secondary">
          Порча, истёкший срок, персонал и пробные чашки. Документ проводится сразу и уменьшает остаток;
          отменить или отредактировать его нельзя.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <StorePicker stores={stores.data?.stores ?? []} value={storeUuid} onChange={setStoreUuid} label="Точка" />
          <Field label="Причина">
            <select
              className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {WRITEOFF_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-3 space-y-2">
          {drafts.map((d, i) => (
            <div key={d.key} className="flex flex-wrap items-end gap-2">
              <Field label={i === 0 ? 'Позиция' : '\u00a0'}>
                <select
                  className="w-full min-w-[10rem] rounded-xl border border-line bg-card px-3 py-2 text-sm"
                  value={d.stockItemId}
                  onChange={(e) => setDrafts(drafts.map((x) => (x.key === d.key ? { ...x, stockItemId: e.target.value } : x)))}
                >
                  <option value="">—</option>
                  {items.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}, {s.unit}</option>
                  ))}
                </select>
              </Field>
              <Field label={i === 0 ? `Кол-во${unitOf(d.stockItemId) ? `, ${unitOf(d.stockItemId)}` : ''}` : ''}>
                <input
                  className="w-28 rounded-xl border border-line bg-card px-3 py-2 text-sm"
                  inputMode="decimal"
                  value={d.qty}
                  onChange={(e) => setDrafts(drafts.map((x) => (x.key === d.key ? { ...x, qty: e.target.value } : x)))}
                />
              </Field>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Убрать позицию"
                onClick={() => setDrafts(drafts.filter((x) => x.key !== d.key))}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setDrafts([...drafts, emptyDraft()])}>
            Позиция
          </Button>
        </div>

        <div className="mt-3">
          <Field label="Комментарий">
            <input
              className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="необязательно"
            />
          </Field>
        </div>

        <div className="mt-3">
          <Button loading={busy} onClick={submit}>Списать</Button>
        </div>
      </Card>

      {list.loading && <Skeleton className="h-24" />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data && !list.data.writeoffs.length && (
        <EmptyState title="Списаний пока нет" text="Порча и пробные чашки будут видны здесь." />
      )}
      {!!list.data?.writeoffs.length && (
        <Card pad={false}>
          <ul>
            {list.data.writeoffs.map((w) => (
              <li key={w.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3 last:border-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold">№{w.id}</span>
                    <Badge tone="warn">{reasonLabel(w.reason)}</Badge>
                    <span className="text-[12px] text-ink-secondary">{day(w.postedAt)}</span>
                    {w.storeName && <span className="text-[12px] text-ink-tertiary">{w.storeName}</span>}
                  </div>
                  <div className="mt-1 text-[12px] text-ink-secondary">
                    {w.lines.map((l) => `${l.itemName} ${l.qty} ${l.unit}`).join(' · ')}
                  </div>
                  {w.notes && <div className="mt-1 text-[12px] text-ink-tertiary">{w.notes}</div>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
