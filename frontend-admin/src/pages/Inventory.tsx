import { useMemo, useState } from 'react'
import { useApi } from '../api/useApi'
import { api } from '../api/client'
import {
  PageHeader, Card, EmptyState, Badge, Button, Select, Field, Input,
  ErrorBox, Skeleton, useToast, cx,
} from '../ui/kit'
import { ClipboardList, Plus, RefreshCw } from 'lucide-react'
import { HelpLink } from '../components/HelpLink'
import { LegacyHint } from './shared'

type InvDoc = {
  id: number; storeUuid: string | null; kind: string; status: string
  notes: string | null; createdAt: number; postedAt: number | null
}
type InvLine = {
  id: number; stockItemId: number; itemName: string; unit: string
  bookQty: number | null; factQty: number | null
}
type StockItem = { id: number; name: string; unit: string }

function statusBadge(s: string) {
  if (s === 'posted') return <Badge tone="ok">проведена</Badge>
  if (s === 'draft' || s === 'counting') return <Badge tone="neutral">{s === 'draft' ? 'черновик' : 'пересчёт'}</Badge>
  if (s === 'cancelled') return <Badge tone="bad">отменена</Badge>
  return <Badge tone="neutral">{s}</Badge>
}

export default function Inventory() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [kind, setKind] = useState<'full' | 'partial'>('partial')
  const [selectedItems, setSelectedItems] = useState<number[]>([])
  const [openId, setOpenId] = useState<number | null>(null)
  const [facts, setFacts] = useState<Record<number, string>>({})

  const list = useApi<{ docs: InvDoc[] }>('/inventory')
  const items = useApi<{ items: StockItem[] }>('/stock/items?active=1')
  const detail = useApi<{ doc: InvDoc; lines: InvLine[] }>(openId != null ? `/inventory/${openId}` : null)

  const createDoc = async () => {
    if (kind === 'partial' && !selectedItems.length) {
      toast.push('Выберите позиции для частичной', 'bad')
      return
    }
    setBusy(true)
    try {
      const res = await api<{ id: number }>('/inventory', {
        method: 'POST',
        body: {
          kind,
          stockItemIds: kind === 'partial' ? selectedItems : undefined,
        },
      })
      toast.push(`Инвентаризация №${res.id}`)
      setShowNew(false)
      setOpenId(res.id)
      list.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const saveFacts = async () => {
    if (openId == null || !detail.data) return
    const lines = detail.data.lines
      .map((l) => ({
        stockItemId: l.stockItemId,
        factQty: facts[l.stockItemId] !== undefined && facts[l.stockItemId] !== ''
          ? Number(facts[l.stockItemId])
          : l.factQty,
      }))
      .filter((l) => l.factQty != null && Number.isFinite(l.factQty)) as { stockItemId: number; factQty: number }[]
    if (!lines.length) {
      toast.push('Введите хотя бы один факт', 'bad')
      return
    }
    setBusy(true)
    try {
      await api(`/inventory/${openId}/lines`, { method: 'PATCH', body: { lines } })
      toast.push('Факт сохранён')
      detail.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const postDoc = async () => {
    if (openId == null) return
    setBusy(true)
    try {
      await api(`/inventory/${openId}/post`, { method: 'POST' })
      toast.push('Проведена — остатки выровнены по факту')
      detail.reload()
      list.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const lines = detail.data?.lines ?? []
  const canPost = detail.data?.doc.status !== 'posted' && lines.length > 0 && lines.every((l) => {
    const f = facts[l.stockItemId]
    if (f !== undefined && f !== '') return Number.isFinite(Number(f))
    return l.factQty != null
  })

  const toggleItem = (id: number) => {
    setSelectedItems((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const openDocs = useMemo(() => list.data?.docs.filter((d) => d.status !== 'posted' && d.status !== 'cancelled') ?? [], [list.data])

  return (
    <section className="view is-active" data-view="inventory">
      <div className="page-head">
        <div>
          <h1>Инвентаризация</h1>
          <p className="page-sub">Сплошная и частичная · проведение двигает остаток</p>
        </div>
        <div className="head-actions">
          <HelpLink article="scenario-inv-partial" />
          <button type="button" className="btn btn-ghost" onClick={() => { list.reload(); detail.reload() }}>Обновить</button>
          <button type="button" className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>Новая</button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">Документов</div>
          <div className="mt-1 font-mono text-2xl font-bold">{list.data?.docs.length ?? '—'}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">
            <ClipboardList size={12} /> Открытых
          </div>
          <div className={cx('mt-1 font-mono text-2xl font-bold', openDocs.length ? 'text-warn' : '')}>{openDocs.length}</div>
        </Card>
      </div>

      <LegacyHint>
        Сводный обзор инвентаризаций и действия «в пересчёт / отменить» пока доступны только в прежнем интерфейсе.
      </LegacyHint>

      {showNew && (
        <Card className="mb-4">
          <div className="mb-3 text-[14px] font-semibold">Новая инвентаризация</div>
          <Field label="Тип">
            <Select value={kind} onChange={(e) => setKind(e.target.value as 'full' | 'partial')}>
              <option value="partial">Частичная</option>
              <option value="full">Сплошная (все активные позиции)</option>
            </Select>
          </Field>
          {kind === 'partial' && (
            <div className="mt-3">
              <div className="mb-2 text-[12px] text-ink-secondary">Выберите позиции (без выбора «Начать» нельзя):</div>
              <div className="max-h-48 overflow-y-auto rounded-xl border border-line">
                {(items.data?.items ?? []).map((it) => (
                  <label key={it.id} className="flex cursor-pointer items-center gap-2 border-b border-line/60 px-3 py-2 text-[13px] last:border-0 hover:bg-surface-2">
                    <input
                      type="checkbox"
                      checked={selectedItems.includes(it.id)}
                      onChange={() => toggleItem(it.id)}
                    />
                    <span className="font-medium">{it.name}</span>
                    <span className="text-ink-tertiary">{it.unit}</span>
                  </label>
                ))}
                {!items.data?.items.length && (
                  <div className="p-3 text-sm text-ink-secondary">Сначала добавьте номенклатуру на складе.</div>
                )}
              </div>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Button loading={busy} onClick={createDoc}>Начать</Button>
            <Button variant="ghost" onClick={() => setShowNew(false)}>Отмена</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card pad={false}>
          <div className="border-b border-line px-4 py-3 text-[14px] font-semibold">Список</div>
          {list.loading && <div className="p-4"><Skeleton className="h-20" /></div>}
          {list.error && <div className="p-4"><ErrorBox message={list.error} /></div>}
          {list.data && !list.data.docs.length && (
            <EmptyState title="Нет инвентаризаций" text="Создайте сплошную или частичную. Учётный остаток для исполнителя можно скрыть на кассе; в админке book виден менеджеру." />
          )}
          {!!list.data?.docs.length && (
            <ul className="divide-y divide-line">
              {list.data.docs.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => { setOpenId(d.id); setFacts({}) }}
                    className={cx(
                      'flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-[13px] hover:bg-surface-2',
                      openId === d.id && 'bg-surface-2',
                    )}
                  >
                    <div>
                      <div className="font-medium">№{d.id} · {d.kind === 'full' ? 'сплошная' : 'частичная'}</div>
                      <div className="text-[12px] text-ink-secondary">
                        {new Date(d.createdAt).toLocaleString('ru-RU')}
                      </div>
                    </div>
                    {statusBadge(d.status)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card pad={false}>
          <div className="border-b border-line px-4 py-3 text-[14px] font-semibold">
            {openId != null ? `Документ №${openId}` : 'Строки'}
          </div>
          {openId == null && (
            <EmptyState title="Выберите документ" text="Или создайте новый. Факт вводится здесь; проведение выравнивает ожидаемый остаток." />
          )}
          {openId != null && detail.loading && <div className="p-4"><Skeleton className="h-24" /></div>}
          {openId != null && detail.error && <div className="p-4"><ErrorBox message={detail.error} /></div>}
          {detail.data && (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-[12px] text-ink-secondary">
                {statusBadge(detail.data.doc.status)}
                <span>{detail.data.doc.kind === 'full' ? 'сплошная' : 'частичная'}</span>
                <span>{detail.data.lines.length} поз.</span>
              </div>
              <div className="admin-scroll-x max-h-[420px] overflow-y-auto">
                <table className="w-full min-w-[400px] text-left text-[13px]">
                  <thead className="sticky top-0 border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-ink-tertiary">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Позиция</th>
                      <th className="px-3 py-2 font-semibold text-right">Учёт</th>
                      <th className="px-3 py-2 font-semibold text-right">Факт</th>
                      <th className="px-3 py-2 font-semibold text-right">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const factStr = facts[l.stockItemId] !== undefined ? facts[l.stockItemId] : (l.factQty != null ? String(l.factQty) : '')
                      const factN = factStr === '' ? null : Number(factStr)
                      const book = l.bookQty ?? 0
                      const delta = factN != null && Number.isFinite(factN) ? factN - book : null
                      const closed = detail.data!.doc.status === 'posted'
                      return (
                        <tr key={l.id} className="border-b border-line/70 last:border-0">
                          <td className="px-3 py-2 font-medium">
                            {l.itemName}
                            <span className="ml-1 text-ink-tertiary">{l.unit}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-ink-secondary">{book}</td>
                          <td className="px-3 py-2 text-right">
                            {closed ? (
                              <span className="font-mono">{l.factQty ?? '—'}</span>
                            ) : (
                              <Input
                                className="!min-h-[36px] w-24 text-right font-mono"
                                type="number"
                                min={0}
                                step="any"
                                value={factStr}
                                onChange={(e) => setFacts((f) => ({ ...f, [l.stockItemId]: e.target.value }))}
                              />
                            )}
                          </td>
                          <td className={cx('px-3 py-2 text-right font-mono', delta != null && delta !== 0 && (delta < 0 ? 'text-bad' : 'text-ok'))}>
                            {delta == null ? '—' : delta > 0 ? `+${delta}` : delta}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {detail.data.doc.status !== 'posted' && (
                <div className="flex flex-wrap gap-2 border-t border-line p-3">
                  <Button size="sm" variant="secondary" loading={busy} onClick={saveFacts}>Сохранить факт</Button>
                  <Button size="sm" loading={busy} disabled={!canPost} onClick={postDoc}>Провести</Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </section>
  )
}
