/**
 * F9: вкладка «Ингредиенты» на модели v2 — позиции склада с ценой из накладных.
 *
 * Пришла на смену «Дозаполнить» (та писала в cost_ingredients). Здесь же ручная цена
 * и вес штуки — без них штучные ингредиенты и позиции без приходов не посчитать.
 */
import { useEffect, useMemo, useState } from 'react'

import { Badge, Button, Card, Drawer, EmptyState, ErrorBox, Input, Select, Skeleton, useToast } from '../../ui/kit'
import { Plus, RefreshCw, Search, Upload } from 'lucide-react'

import { costApi, type CostItem } from '../../lib/costApi'
import { COST_SOURCE_LABELS, UNIT_LABELS, money } from '../../lib/costMath'

export default function ItemsTab({ onImport, reloadKey = 0 }: { onImport?: () => void; reloadKey?: number }) {
  const toast = useToast()
  const [items, setItems] = useState<CostItem[] | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [q, setQ] = useState('')
  const [problemsOnly, setProblemsOnly] = useState(false)
  const [draft, setDraft] = useState<Record<number, { price: string; weight: string }>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [created, setCreated] = useState({ name: '', unit: 'g' as 'g' | 'ml' | 'pcs', price: '' })
  const [history, setHistory] = useState<{ item: CostItem; rows: { at: number; costRub: number | null; source: string }[]; purchases: { at: number; qty: number; unitCostRub: number | null }[] } | null>(null)

  const load = () => {
    setError(null)
    costApi
      .items({ q: q || undefined })
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e : new Error('Не удалось загрузить ингредиенты')))
  }

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, reloadKey])

  const visible = useMemo(
    () => (items ?? []).filter((i) => !problemsOnly || i.problems.length > 0),
    [items, problemsOnly],
  )

  const saveItem = async (item: CostItem) => {
    const d = draft[item.id]
    if (!d) return
    const body: { manualCostRub?: number | null; weightPerPcKg?: number | null } = {}
    if (d.price !== '') body.manualCostRub = Number(d.price)
    if (d.weight !== '') body.weightPerPcKg = Number(d.weight)
    if (Object.keys(body).length === 0) return
    try {
      await costApi.updateItem(item.id, body)
      toast.push(`«${item.name}» обновлён`, 'ok')
      setDraft((x) => ({ ...x, [item.id]: { price: '', weight: '' } }))
      load()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось сохранить', 'bad')
    }
  }

  const openHistory = async (item: CostItem) => {
    try {
      const r = await costApi.priceHistory(item.id)
      setHistory({ item, rows: r.history, purchases: r.purchases })
    } catch {
      toast.push('История цены недоступна', 'bad')
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти ингредиент" className="pl-8" aria-label="Поиск ингредиента" />
        </div>
        <Button variant={problemsOnly ? 'primary' : 'secondary'} onClick={() => setProblemsOnly((v) => !v)}>
          Без цены
        </Button>
        <Button variant="secondary" onClick={load} aria-label="Обновить ингредиенты">
          <RefreshCw size={14} />
        </Button>
        <Button variant="secondary" onClick={() => setCreateOpen(true)}>
          <Plus size={14} /> Позиция
        </Button>
        {onImport && (
          <Button onClick={onImport}>
            <Upload size={14} /> Загрузить
          </Button>
        )}
      </div>

      {error && <ErrorBox message={error.message} />}
      {!items && !error && <Skeleton />}
      {items && visible.length === 0 && (
        <EmptyState
          title={problemsOnly ? 'Все позиции с ценой' : 'Позиций пока нет'}
          text={problemsOnly ? 'Можно идти в техкарты.' : 'Загрузите прайс или добавьте позицию в «Складе».'}
        />
      )}

      <div className="grid gap-2">
        {visible.map((item) => (
          <Card key={item.id} className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{item.name}</span>
              <Badge tone="neutral">{UNIT_LABELS[item.unit] ?? item.unit}</Badge>
              <span className="text-[12px] text-ink-secondary">
                {money(item.costRub)}/{UNIT_LABELS[item.unit] ?? item.unit} · {COST_SOURCE_LABELS[item.costSource]}
              </span>
              {item.problems.map((p) => (
                <Badge key={p} tone="warn">
                  {p}
                </Badge>
              ))}
              <span className="ml-auto text-[11px] text-ink-tertiary">в картах: {item.cards}</span>
              <Button variant="secondary" onClick={() => void openHistory(item)}>
                История
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="text-[11px] text-ink-tertiary">
                Ручная цена, ₽/{UNIT_LABELS[item.unit] ?? item.unit}
                <Input
                  className="mt-1 w-28"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={item.costRub != null ? String(item.costRub) : '—'}
                  aria-label={`Ручная цена: ${item.name}`}
                  value={draft[item.id]?.price ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [item.id]: { price: e.target.value, weight: d[item.id]?.weight ?? '' } }))}
                />
              </label>
              {item.unit === 'pcs' && (
                <label className="text-[11px] text-ink-tertiary">
                  Вес 1 шт, кг
                  <Input
                    className="mt-1 w-24"
                    type="number"
                    step="0.001"
                    min="0"
                    placeholder={item.weightPerPcKg != null ? String(item.weightPerPcKg) : '—'}
                    aria-label={`Вес штуки: ${item.name}`}
                    value={draft[item.id]?.weight ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [item.id]: { price: d[item.id]?.price ?? '', weight: e.target.value } }))}
                  />
                </label>
              )}
              <Button onClick={() => void saveItem(item)} disabled={!draft[item.id] || (!draft[item.id].price && !draft[item.id].weight)}>
                Сохранить
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Новая позиция склада"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={!created.name.trim()}
              onClick={async () => {
                try {
                  const r = await costApi.createItem({ name: created.name.trim(), unit: created.unit })
                  if (created.price !== '') await costApi.updateItem(r.id, { manualCostRub: Number(created.price) })
                  toast.push(`«${created.name.trim()}» добавлена`, 'ok')
                  setCreated({ name: '', unit: 'g', price: '' })
                  setCreateOpen(false)
                  load()
                } catch (e) {
                  toast.push(e instanceof Error ? e.message : 'Не удалось создать позицию', 'bad')
                }
              }}
            >
              Создать
            </Button>
          </div>
        }
      >
        <label className="mb-2 block text-sm">
          Название
          <Input className="mt-1" value={created.name} onChange={(e) => setCreated((c) => ({ ...c, name: e.target.value }))} placeholder="Молоко 3,2%" />
        </label>
        <label className="mb-2 block text-sm">
          Единица
          <Select className="mt-1" value={created.unit} onChange={(e) => setCreated((c) => ({ ...c, unit: e.target.value as 'g' | 'ml' | 'pcs' }))}>
            <option value="g">грамм</option>
            <option value="ml">миллилитр</option>
            <option value="pcs">штука</option>
          </Select>
        </label>
        <label className="block text-sm">
          Ручная цена за единицу, ₽
          <Input className="mt-1" type="number" step="0.01" min="0" value={created.price} onChange={(e) => setCreated((c) => ({ ...c, price: e.target.value }))} placeholder="0,09" />
        </label>
        <p className="mt-3 text-[11px] text-ink-tertiary">
          Основной путь — цены из накладных в «Закупках». Ручная цена нужна, пока поставок не было.
        </p>
      </Drawer>

      <Drawer open={history !== null} onClose={() => setHistory(null)} title={`История цены: ${history?.item.name ?? ''}`}>
        {history && history.purchases.length > 0 ? (
          <div className="grid gap-1.5">
            <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Поставки</div>
            {history.purchases.map((p, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <span>{new Date(p.at).toLocaleDateString('ru-RU')}</span>
                <span className="text-ink-tertiary">{p.qty}</span>
                <span className="ml-auto">{money(p.unitCostRub)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-secondary">Поставок не было — цена ручная или её нет.</p>
        )}
        {history && history.rows.length > 0 && (
          <div className="mt-4 grid gap-1.5">
            <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Снимки цены</div>
            {history.rows.slice(-8).map((h, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-[13px]">
                <span>{new Date(h.at).toLocaleDateString('ru-RU')}</span>
                <span className="text-ink-tertiary">{COST_SOURCE_LABELS[h.source] ?? h.source}</span>
                <span className="ml-auto">{money(h.costRub)}</span>
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  )
}
