import { useMemo, useState } from 'react'
import { useApi } from '../../api/useApi'
import { api } from '../../api/client'
import { Badge, Button, Card, Drawer, EmptyState, ErrorBox, Field, Select, Skeleton, useToast } from '../../ui/kit'
import type { Tone } from '../../ui/kit'
import { Pencil, Plus, Trash2 } from 'lucide-react'

type Component = { stockItemId: number; qty: number; itemName: string; unit: string }
type Recipe = {
  productId: number
  product: string
  group: string | null
  mode: 'raw' | 'piece' | 'none' | 'unset'
  sold30d: number
  components: Component[]
}
type StockItem = { id: number; name: string; unit: string }

const MODE: Record<string, { label: string; tone: Tone; hint: string }> = {
  raw: { label: 'по норме', tone: 'ok', hint: 'Сырьё списывается в граммах/миллилитрах по норме' },
  piece: { label: 'поштучно', tone: 'brand', hint: 'Штучная позиция, списание 1:1' },
  none: { label: 'без списания', tone: 'warn', hint: 'Продажа не уменьшает склад' },
  unset: { label: 'не задано', tone: 'bad', hint: 'Норма не задана — склад не уменьшается' },
}

type Draft = { key: string; stockItemId: string; qty: string }
const emptyDraft = (): Draft => ({ key: String(Date.now()) + Math.random(), stockItemId: '', qty: '1' })

export default function RecipesTab({ items }: { items: StockItem[] }) {
  const toast = useToast()
  const list = useApi<{ recipes: Recipe[] }>('/stock/recipes')
  const [edit, setEdit] = useState<Recipe | null>(null)
  const [mode, setMode] = useState<'raw' | 'piece' | 'none'>('raw')
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft()])
  const [busy, setBusy] = useState(false)
  // D-14: количество вводится в единице выбранной позиции — показываем её в подписи.
  const unitOf = (stockItemId: string) => items.find((x) => String(x.id) === stockItemId)?.unit ?? ''

  const open = (r: Recipe) => {
    setEdit(r)
    setMode(r.mode === 'unset' ? 'raw' : r.mode)
    setDrafts(
      r.components.length
        ? r.components.map((c) => ({ key: `c${c.stockItemId}`, stockItemId: String(c.stockItemId), qty: String(c.qty) }))
        : [emptyDraft()],
    )
  }

  const save = async () => {
    if (!edit) return
    const components = drafts
      .map((d) => ({ stockItemId: Number(d.stockItemId), qty: Number(d.qty) || 0 }))
      .filter((d) => d.stockItemId > 0 && d.qty > 0)
    if (mode !== 'none' && !components.length) {
      toast.push('Добавьте компонент или выберите «Без списания»', 'bad')
      return
    }
    setBusy(true)
    try {
      await api(`/stock/recipes/${edit.productId}`, {
        method: 'PUT',
        body: { mode, components: mode === 'none' ? [] : components },
      })
      toast.push('Рецептура сохранена')
      setEdit(null)
      list.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const summary = useMemo(() => {
    const rows = list.data?.recipes ?? []
    return {
      total: rows.length,
      unset: rows.filter((r) => r.mode === 'unset').length,
      none: rows.filter((r) => r.mode === 'none').length,
    }
  }, [list.data])

  return (
    <>
      {list.loading && !list.data && <Card><Skeleton className="h-24" /></Card>}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}

      {list.data && (
        <Card pad={false}>
          <div className="border-b border-line px-4 py-2 text-[12px] text-ink-secondary">
            Всего {summary.total} · без нормы {summary.unset} · без списания {summary.none}.
            Рецептура определяет, что и сколько списывается со склада при продаже.
          </div>
          {!summary.total && <EmptyState title="Товаров нет" text="Появятся после загрузки меню." />}
          {!!summary.total && (
            <ul className="divide-y divide-line">
              {list.data.recipes.map((r) => {
                const m = MODE[r.mode] ?? MODE.unset
                return (
                  <li key={r.productId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium">{r.product}</div>
                      <div className="text-[12px] text-ink-secondary">
                        {r.components.length
                          ? r.components.map((c) => `${c.itemName} ${c.qty} ${c.unit}`).join(' · ')
                          : m.hint}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="hidden text-[12px] text-ink-tertiary sm:inline">продаж за 30 дней: {r.sold30d}</span>
                      <Badge tone={m.tone}>{m.label}</Badge>
                      <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => open(r)}>
                        Изменить
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      )}

      <Drawer
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit ? `Рецептура · ${edit.product}` : 'Рецептура'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>Отмена</Button>
            <Button loading={busy} onClick={save}>Сохранить</Button>
          </>
        }
      >
        <Field label="Режим списания">
          <Select value={mode} onChange={(e) => setMode(e.target.value as 'raw' | 'piece' | 'none')}>
            <option value="raw">По норме (сырьё)</option>
            <option value="piece">Поштучно</option>
            <option value="none">Без списания</option>
          </Select>
        </Field>
        <p className="mb-3 text-xs text-ink-secondary">{MODE[mode].hint}</p>

        {mode !== 'none' && (
          <div className="space-y-2">
            {drafts.map((d, i) => (
              <div key={d.key} className="flex items-end gap-2">
                <Field label={i === 0 ? 'Позиция склада' : ''}>
                  <Select
                    value={d.stockItemId}
                    onChange={(e) => setDrafts(drafts.map((x) => (x.key === d.key ? { ...x, stockItemId: e.target.value } : x)))}
                  >
                    <option value="">—</option>
                    {items.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}, {s.unit}</option>
                    ))}
                  </Select>
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
                  aria-label="Убрать компонент"
                  onClick={() => setDrafts(drafts.filter((x) => x.key !== d.key))}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setDrafts([...drafts, emptyDraft()])}>
              Ещё компонент
            </Button>
          </div>
        )}
      </Drawer>
    </>
  )
}
