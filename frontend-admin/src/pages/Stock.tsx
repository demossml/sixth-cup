import { useMemo, useState } from 'react'
import { useApi } from '../api/useApi'
import { api } from '../api/client'
import {
  PageHeader, Card, EmptyState, Badge, Button, Input, Select, Field,
  ErrorBox, Skeleton, Tabs, useToast, cx, ConfirmDialog,
} from '../ui/kit'
import { AlertTriangle, Clock, Plus, RefreshCw } from 'lucide-react'
import { HelpLink } from '../components/HelpLink'
import { csvName, downloadCsv } from '../lib/csv'
import { deactivatedHint, entityStatusLabel } from '../lib/format'
import RecipesTab from './stock/RecipesTab'

type StockItem = {
  id: number; name: string; sku: string | null; kind: string; unit: string
  minQty: number; expectedQty: number; batchQtyLeft: number; level: 'ok' | 'low' | 'out'
  active: number
}
type BalanceResp = { balances: StockItem[]; summary: { total: number; critical: number } }
type ExpiryBatch = {
  id: number; itemName: string; unit: string; lotCode: string | null
  qtyLeft: number; expiresAt: number; daysLeft: number; urgency: 'expired' | 'urgent' | 'soon'
  supplierName: string | null
}
type ExpiryResp = { batches: ExpiryBatch[]; summary: { expired: number; urgent: number; soon: number } }
type NoNorm = { id: number; name: string }

function levelBadge(level: string) {
  if (level === 'out') return <Badge tone="bad">нет</Badge>
  if (level === 'low') return <Badge tone="warn">мало</Badge>
  return <Badge tone="ok">норма</Badge>
}

function urgencyBadge(u: string) {
  if (u === 'expired') return <Badge tone="bad">просрочено</Badge>
  if (u === 'urgent') return <Badge tone="bad">срочно</Badge>
  return <Badge tone="warn">скоро</Badge>
}

export default function Stock() {
  const toast = useToast()
  const [tab, setTab] = useState<'balances' | 'expiry' | 'items' | 'norms' | 'recipes' | 'risk'>('balances')
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'raw' | 'unit'>('raw')
  const [unit, setUnit] = useState('kg')
  const [minQty, setMinQty] = useState('0')
  const [busy, setBusy] = useState(false)
  const [normProductId, setNormProductId] = useState('')
  const [normItemId, setNormItemId] = useState('')
  const [normQty, setNormQty] = useState('18')

  // R-08: правка и удаление позиции номенклатуры.
  type ItemForm = { id?: number; name: string; kind: 'raw' | 'unit'; unit: string; minQty: string; sku: string }
  const [itemForm, setItemForm] = useState<ItemForm | null>(null)
  const [itemDel, setItemDel] = useState<{ id: number; name: string } | null>(null)
  const [itemBusy, setItemBusy] = useState(false)

  const balances = useApi<BalanceResp>('/stock/balances')
  const expiry = useApi<ExpiryResp>('/stock/expiry?days=14')
  const items = useApi<{ items: StockItem[] }>('/stock/items?active=1')
  // Список номенклатуры показывает и выключенные позиции: после «Удалить» со связями
  // запись остаётся в базе, и владелец должен это видеть, а не искать пропажу.
  const allItems = useApi<{ items: StockItem[] }>('/stock/items')
  const risk = useApi<{ products: NoNorm[] }>('/stock/products-without-norms')
  const norms = useApi<{ norms: { id: number; productId: number; stockItemId: number; qty: number; productName?: string; itemName?: string; unit?: string }[] }>('/stock/norms')
  const productsList = useApi<{ products: { id: number; name: string }[] }>('/products')

  const reloadAll = () => {
    balances.reload(); expiry.reload(); items.reload(); risk.reload(); norms.reload(); allItems.reload()
  }

  const createItem = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await api('/stock/items', {
        method: 'POST',
        body: { name: name.trim(), kind, unit, minQty: Number(minQty) || 0 },
      })
      toast.push('Позиция добавлена')
      setName(''); setShowForm(false); reloadAll()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const critical = balances.data?.summary.critical ?? 0
  const expSum = expiry.data?.summary

  const tabs = useMemo(() => [
    { key: 'balances' as const, label: 'Остатки', count: balances.data?.summary.total },
    { key: 'expiry' as const, label: 'Сроки', count: (expSum?.expired ?? 0) + (expSum?.urgent ?? 0) || null },
    { key: 'items' as const, label: 'Номенклатура', count: items.data?.items.length },
    { key: 'norms' as const, label: 'Нормы', count: norms.data?.norms.length },
    { key: 'recipes' as const, label: 'Рецептуры' },
    { key: 'risk' as const, label: 'Без нормы', count: risk.data?.products.length },
  ], [balances.data, expSum, items.data, norms.data, risk.data])

  const saveItem = async () => {
    if (!itemForm || !itemForm.name.trim()) return
    setItemBusy(true)
    try {
      const body = {
        name: itemForm.name.trim(),
        kind: itemForm.kind,
        unit: itemForm.unit,
        minQty: Number(itemForm.minQty) || 0,
        sku: itemForm.sku.trim() || null,
      }
      if (itemForm.id) await api(`/stock/items/${itemForm.id}`, { method: 'PATCH', body })
      else await api('/stock/items', { method: 'POST', body })
      toast.push(itemForm.id ? 'Позиция сохранена' : 'Позиция создана')
      setItemForm(null)
      reloadAll()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setItemBusy(false)
    }
  }

  const removeItem = async () => {
    if (!itemDel) return
    setItemBusy(true)
    try {
      const res = await api<{ deleted?: boolean; deactivated?: boolean; reason?: string }>(`/stock/items/${itemDel.id}`, { method: 'DELETE' })
      toast.push(res.deactivated ? (res.reason ?? 'Позиция выключена') : 'Позиция удалена')
      setItemDel(null)
      reloadAll()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setItemBusy(false)
    }
  }

  const saveNorm = async () => {
    if (!normProductId || !normItemId) return
    setBusy(true)
    try {
      await api('/stock/norms', {
        method: 'POST',
        body: {
          productId: Number(normProductId),
          stockItemId: Number(normItemId),
          qty: Number(normQty) || 0,
        },
      })
      toast.push('Норма сохранена')
      norms.reload(); risk.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally { setBusy(false) }
  }

  const deleteNorm = async (id: number) => {
    setBusy(true)
    try {
      await api(`/stock/norms/${id}`, { method: 'DELETE' })
      toast.push('Норма удалена')
      norms.reload(); risk.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally { setBusy(false) }
  }

  return (
    <section className="view is-active" data-view="stock">
      <div className="page-head">
        <div>
          <h1>Склад и списания</h1>
          <p className="page-sub">Остатки, партии FEFO, нормы списания на товар меню</p>
        </div>
        <div className="head-actions">
          <HelpLink article="logic-fefo" />
          <button type="button" className="btn btn-ghost" onClick={reloadAll}>Обновить</button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!balances.data?.balances.length}
            onClick={() =>
              downloadCsv(
                csvName('stock'),
                ['Позиция', 'Ед.', 'Минимум', 'Ожидаемый остаток', 'В партиях', 'Уровень'],
                (balances.data?.balances ?? []).map((b) => [b.name, b.unit, b.minQty, b.expectedQty, b.batchQtyLeft, b.level]),
              )
            }
          >
            CSV
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>Позиция</button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">Позиций</div>
          <div className="mt-1 font-mono text-2xl font-bold">{balances.data?.summary.total ?? '—'}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">
            <AlertTriangle size={12} className="text-bad" /> Критично
          </div>
          <div className={cx('mt-1 font-mono text-2xl font-bold', critical ? 'text-bad' : '')}>{critical}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">
            <Clock size={12} className="text-warn" /> Сроки (14 дн.)
          </div>
          <div className="mt-1 font-mono text-2xl font-bold text-warn">
            {expSum ? expSum.expired + expSum.urgent + expSum.soon : '—'}
          </div>
        </Card>
      </div>

      {showForm && (
        <Card className="mb-4">
          <div className="mb-3 text-[14px] font-semibold">Новая позиция склада</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Название">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Кофе зерно / Стакан 300" />
            </Field>
            <Field label="Тип">
              <Select value={kind} onChange={(e) => setKind(e.target.value as 'raw' | 'unit')}>
                <option value="raw">Сырьё</option>
                <option value="unit">Штука</option>
              </Select>
            </Field>
            <Field label="Единица">
              <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
                {['kg', 'l', 'pcs', 'g', 'ml'].map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </Field>
            <Field label="Минимум">
              <Input type="number" min={0} step="any" value={minQty} onChange={(e) => setMinQty(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button loading={busy} onClick={createItem} disabled={!name.trim()}>Сохранить</Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Отмена</Button>
          </div>
        </Card>
      )}

      {itemForm && (
        <Card className="mb-4">
          <div className="mb-3 text-[14px] font-semibold">{itemForm.id ? 'Позиция склада' : 'Новая позиция склада'}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Название">
              <Input value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} />
            </Field>
            <Field label="Артикул" hint="необязательно">
              <Input value={itemForm.sku} onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value })} />
            </Field>
            <Field label="Тип">
              <Select value={itemForm.kind} onChange={(e) => setItemForm({ ...itemForm, kind: e.target.value as 'raw' | 'unit' })}>
                <option value="raw">Сырьё</option>
                <option value="unit">Штука</option>
              </Select>
            </Field>
            <Field label="Единица">
              <Select value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}>
                {['kg', 'l', 'pcs', 'g', 'ml'].map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </Field>
            <Field label="Минимум">
              <Input type="number" min={0} step="any" value={itemForm.minQty} onChange={(e) => setItemForm({ ...itemForm, minQty: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button loading={itemBusy} onClick={saveItem} disabled={!itemForm.name.trim()}>Сохранить</Button>
            <Button variant="ghost" onClick={() => setItemForm(null)}>Отмена</Button>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={!!itemDel}
        danger
        busy={itemBusy}
        title="Удалить позицию склада?"
        confirmLabel="Удалить"
        onCancel={() => setItemDel(null)}
        onConfirm={removeItem}
      >
        {itemDel && `«${itemDel.name}» будет удалена. Если по ней есть движения или документы — позиция выключится, история остатков сохранится.`}
      </ConfirmDialog>

      <Tabs items={tabs} value={tab} onChange={setTab} />

      {tab === 'balances' && (
        <Card pad={false}>
          {balances.loading && <div className="p-4"><Skeleton className="h-24" /></div>}
          {balances.error && <div className="p-4"><ErrorBox message={balances.error} /></div>}
          {balances.data && !balances.data.balances.length && (
            <EmptyState
              title="Склад пуст"
              text="Добавьте номенклатуру (сырьё или штуки). Остаток появляется только после проведённой накладной или инвентаризации — не правкой в ячейке."
              action={<Button size="sm" onClick={() => setShowForm(true)}>Добавить позицию</Button>}
            />
          )}
          {!!balances.data?.balances.length && (
            <div className="admin-scroll-x">
              <table className="w-full min-w-[520px] text-left text-[13px]">
                <thead className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-ink-tertiary">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Позиция</th>
                    <th className="px-4 py-2.5 font-semibold">Тип</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Ожидаемо</th>
                    <th className="px-4 py-2.5 font-semibold">Ед.</th>
                    <th className="px-4 py-2.5 font-semibold">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.data.balances.map((b) => (
                    <tr key={b.id} className="border-b border-line/70 last:border-0">
                      <td className="px-4 py-2.5 font-medium">{b.name}</td>
                      <td className="px-4 py-2.5 text-ink-secondary">{b.kind === 'raw' ? 'сырьё' : 'штука'}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{b.expectedQty}</td>
                      <td className="px-4 py-2.5 text-ink-secondary">{b.unit}</td>
                      <td className="px-4 py-2.5">{levelBadge(b.level)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'expiry' && (
        <Card pad={false}>
          {expiry.loading && <div className="p-4"><Skeleton className="h-24" /></div>}
          {expiry.error && <div className="p-4"><ErrorBox message={expiry.error} /></div>}
          {expiry.data && !expiry.data.batches.length && (
            <EmptyState title="Нет партий с истекающим сроком" text="Партии появляются при проведении накладной с полем «Годен до»." />
          )}
          {!!expiry.data?.batches.length && (
            <div className="admin-scroll-x">
              <table className="w-full min-w-[560px] text-left text-[13px]">
                <thead className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-ink-tertiary">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Позиция</th>
                    <th className="px-4 py-2.5 font-semibold">Лот</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Остаток</th>
                    <th className="px-4 py-2.5 font-semibold">Дней</th>
                    <th className="px-4 py-2.5 font-semibold">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {expiry.data.batches.map((b) => (
                    <tr key={b.id} className="border-b border-line/70 last:border-0">
                      <td className="px-4 py-2.5 font-medium">{b.itemName}</td>
                      <td className="px-4 py-2.5 font-mono text-ink-secondary">{b.lotCode || '—'}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{b.qtyLeft} {b.unit}</td>
                      <td className="px-4 py-2.5 font-mono">{b.daysLeft}</td>
                      <td className="px-4 py-2.5">{urgencyBadge(b.urgency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'items' && (
        <Card pad={false}>
          {allItems.loading && !allItems.data && <div className="p-4"><Skeleton className="h-24" /></div>}
          {allItems.error && <div className="p-4"><ErrorBox message={allItems.error} onRetry={allItems.reload} /></div>}
          {allItems.data && !allItems.data.items.length && (
            <EmptyState title="Номенклатура пуста" text="Сырьё (кг/л) и штуки. Остаток не правят вручную — только документами." />
          )}
          {!!allItems.data?.items.length && (
            <ul className="divide-y divide-line">
              {allItems.data.items.map((it) => (
                <li key={it.id} className={it.active ? 'flex items-center justify-between gap-3 px-4 py-3' : 'flex items-center justify-between gap-3 px-4 py-3 opacity-60'}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{it.name}</span>
                      {!it.active && <Badge tone={entityStatusLabel(it.active, 'f').tone}>{entityStatusLabel(it.active, 'f').label}</Badge>}
                    </div>
                    <div className="text-[12px] text-ink-secondary">
                      {it.kind === 'raw' ? 'сырьё' : 'штука'} · {it.unit} · мин. {it.minQty}
                    </div>
                    {!it.active && <div className="text-[11px] text-ink-tertiary">{deactivatedHint('f')}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {levelBadge(it.level)}
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Изменить позицию ${it.name}`}
                      onClick={() => setItemForm({ id: it.id, name: it.name, kind: it.kind === 'raw' ? 'raw' : 'unit', unit: it.unit, minQty: String(it.minQty), sku: '' })}
                    >
                      Изменить
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={`Удалить позицию ${it.name}`} onClick={() => setItemDel({ id: it.id, name: it.name })}>
                      Удалить
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'norms' && (
        <Card pad={false}>
          <div className="border-b border-line p-4">
            <div className="mb-2 text-[13px] text-ink-secondary">
              Рецепт на продажу: сколько сырья списывается с одной единицы товара (например 18 г кофе). Без нормы продажи не списывают склад.
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="Товар меню">
                <Select value={normProductId} onChange={(e) => setNormProductId(e.target.value)}>
                  <option value="">—</option>
                  {(productsList.data?.products ?? []).map((pr) => (
                    <option key={pr.id} value={pr.id}>{pr.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Позиция склада">
                <Select value={normItemId} onChange={(e) => setNormItemId(e.target.value)}>
                  <option value="">—</option>
                  {(items.data?.items ?? []).map((it) => (
                    <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>
                  ))}
                </Select>
              </Field>
              <Field label="Кол-во на 1 шт.">
                <Input type="number" min={0} step="any" value={normQty} onChange={(e) => setNormQty(e.target.value)} />
              </Field>
              <div className="flex items-end">
                <Button loading={busy} onClick={saveNorm} disabled={!normProductId || !normItemId}>Сохранить</Button>
              </div>
            </div>
          </div>
          {norms.loading && <div className="p-4"><Skeleton className="h-20" /></div>}
          {norms.error && <div className="p-4"><ErrorBox message={norms.error} /></div>}
          {norms.data && !norms.data.norms.length && (
            <EmptyState title="Норм пока нет" text="Пока нет норм — продажи не уменьшают остаток (риск по дизайн-проекту)." />
          )}
          {!!norms.data?.norms.length && (
            <ul className="divide-y divide-line">
              {norms.data.norms.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                  <div>
                    <span className="font-medium">{n.productName ?? n.productId}</span>
                    <span className="text-ink-tertiary"> → </span>
                    <span>{n.itemName ?? n.stockItemId}</span>
                    <span className="ml-2 font-mono text-ink-secondary">{n.qty} {n.unit ?? ''}</span>
                  </div>
                  <Button size="sm" variant="ghost" loading={busy} onClick={() => deleteNorm(n.id)}>Удалить</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'recipes' && <RecipesTab items={items.data?.items ?? []} />}

      {tab === 'risk' && (
        <Card pad={false}>
          {risk.loading && <div className="p-4"><Skeleton className="h-24" /></div>}
          {risk.error && <div className="p-4"><ErrorBox message={risk.error} /></div>}
          {risk.data && !risk.data.products.length && (
            <EmptyState title="У всех доступных товаров есть нормы" text="Продажа будет списывать сырьё по норме." />
          )}
          {!!risk.data?.products.length && (
            <>
              <div className="border-b border-line px-4 py-2 text-[12px] text-ink-secondary">
                Без нормы списания нет — позиция видна как риск (по дизайн-проекту).
              </div>
              <ul className="divide-y divide-line">
                {risk.data.products.map((p) => (
                  <li key={p.id} className="px-4 py-2.5 text-[13px] font-medium">{p.name}</li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </section>
  )
}
