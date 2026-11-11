/**
 * F5: вкладка «Техкарты» — список с бейджами и редактор карты.
 *
 * Двунаправленный ввод: брутто + % потерь, либо брутто + нетто, либо брутто + выход.
 * Правки уходят на сервер целиком (PUT), версии — отдельной кнопкой.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Drawer,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Select,
  Skeleton,
  Spinner,
  cx,
  useToast,
} from '../../ui/kit'
import { Plus, RefreshCw, Search, Trash2, Layers, ArrowLeft, History, Sparkles, Copy } from 'lucide-react'

import {
  costApi,
  type CardLine,
  type CardListItem,
  type CardPayload,
  type CardKind,
  type CostItem,
  type TechCard,
  type Unit,
  type WriteOffMode,
} from '../../lib/costApi'
import { api } from '../../api/client'
import { COST_SOURCE_LABELS, KIND_LABELS, UNIT_LABELS, WRITE_OFF_LABELS, lineCostRub, lineNumbers, money, pct } from '../../lib/costMath'

type DraftLine = {
  key: string
  stockItemId: number | null
  childCardId: number | null
  qtyBrutto: number
  lossColdPct: number
  lossHotPct: number
  nettoInput: number | null
  yieldInput: number | null
  lineRole: 'base' | 'optional'
}

const key = () => Math.random().toString(36).slice(2, 9)

function draftFromLine(l: CardLine): DraftLine {
  return {
    key: key(),
    stockItemId: l.stockItemId,
    childCardId: l.childCardId,
    qtyBrutto: l.qtyBrutto,
    lossColdPct: l.lossColdPct,
    lossHotPct: l.lossHotPct,
    nettoInput: null,
    yieldInput: null,
    lineRole: l.lineRole,
  }
}

function draftPayload(lines: DraftLine[]): CardPayload['lines'] {
  return lines.map((l) => {
    const n = lineNumbers({
      brutto: l.qtyBrutto,
      lossColdPct: l.lossColdPct,
      lossHotPct: l.lossHotPct,
      netto: l.nettoInput,
      yieldQty: l.yieldInput,
    })
    return {
      stockItemId: l.stockItemId,
      childCardId: l.childCardId,
      qtyBrutto: l.qtyBrutto,
      lossColdPct: n.lossColdPct,
      lossHotPct: n.lossHotPct,
      lineRole: l.lineRole,
    }
  })
}

export default function TechCardsTab({
  onOpenSignals,
  initialCardId,
}: {
  onOpenSignals?: () => void
  /** Открыть конкретную карту сразу (переход из «Сигналов»). */
  initialCardId?: number
}) {
  const toast = useToast()
  const [list, setList] = useState<CardListItem[] | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [q, setQ] = useState('')
  const [problemsOnly, setProblemsOnly] = useState(false)
  const [editing, setEditing] = useState<number | 'new' | null>(initialCardId ?? null)
  const [bulkOpen, setBulkOpen] = useState(false)

  const load = useCallback(() => {
    setError(null)
    costApi
      .cards({ q, problems: problemsOnly })
      .then((r) => setList(r.cards))
      .catch((e) => setError(e instanceof Error ? e : new Error('Не удалось загрузить техкарты')))
  }, [q, problemsOnly])

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  if (editing != null) {
    return (
      <TechCardEditor
        cardId={editing}
        onClose={() => {
          setEditing(null)
          load()
        }}
      />
    )
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти техкарту" className="pl-8" aria-label="Поиск техкарты" />
        </div>
        <Button variant={problemsOnly ? 'primary' : 'secondary'} onClick={() => setProblemsOnly((v) => !v)}>
          Только проблемные
        </Button>
        <Button variant="secondary" onClick={load} aria-label="Обновить список">
          <RefreshCw size={14} />
        </Button>
        <Button onClick={() => setEditing('new')}>
          <Plus size={14} /> Новая карта
        </Button>
        <Button variant="secondary" onClick={() => setBulkOpen(true)}>
          <Copy size={14} /> Заменить ингредиент
        </Button>
      </div>

      {error && <ErrorBox message={error.message} />}
      {!list && !error && <Skeleton />}

      {list && list.length === 0 && (
        <EmptyState
          title="Техкарт пока нет"
          text="Заведите карту на блюдо или заготовку — себестоимость посчитается из склада."
          action={<Button onClick={() => setEditing('new')}>Новая карта</Button>}
        />
      )}

      <div className="grid gap-2">
        {(list ?? []).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setEditing(c.id)}
            className="flex w-full flex-col gap-1 rounded-xl border border-line bg-white p-3 text-left transition hover:border-brand/40 hover:shadow-soft"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">{c.name}</span>
              <Badge tone="neutral">{KIND_LABELS[c.kind] ?? c.kind}</Badge>
              {c.status === 'draft' && <Badge tone="warn">черновик</Badge>}
              {c.version && <span className="text-[11px] text-ink-tertiary">версия от {new Date(c.version.validFrom).toLocaleDateString('ru-RU')}</span>}
              <span className="ml-auto text-sm font-semibold">{money(c.costPerUnitRub)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[12px] text-ink-secondary">
              <span>
                норма: {c.outputQty} {UNIT_LABELS[c.outputUnit]}
              </span>
              <span>цена: {money(c.retailRub)}</span>
              <span className={cx(c.foodCostPct != null && c.foodCostPct > 35 ? 'text-bad' : '')}>фудкост: {pct(c.foodCostPct)}</span>
              <span>маржа: {money(c.marginRub)}</span>
              <span>строк: {c.linesCount}</span>
              {c.insights.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {c.insights.map((i) => (
                    <Badge key={i.code} tone={i.tone === 'bad' ? 'bad' : 'warn'}>
                      {i.text}
                    </Badge>
                  ))}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {onOpenSignals && (
        <div className="mt-4">
          <Button variant="secondary" onClick={onOpenSignals}>
            <Sparkles size={14} /> Все сигналы по картам
          </Button>
        </div>
      )}

      <BulkReplaceDrawer open={bulkOpen} onClose={() => { setBulkOpen(false); load() }} />
    </div>
  )
}

/* ─────────────────────────── редактор карты ─────────────────────────── */

function TechCardEditor({ cardId, onClose }: { cardId: number | 'new'; onClose: () => void }) {
  const toast = useToast()
  const isNew = cardId === 'new'
  const [card, setCard] = useState<TechCard | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CardKind>('dish')
  const [outputQty, setOutputQty] = useState(1)
  const [outputUnit, setOutputUnit] = useState<Unit>('pcs')
  const [writeOffMode, setWriteOffMode] = useState<WriteOffMode>('ingredients')
  const [productId, setProductId] = useState<number | ''>('')
  const [products, setProducts] = useState<{ id: number; name: string }[]>([])
  const [retail, setRetail] = useState<number | ''>('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [items, setItems] = useState<CostItem[]>([])
  const [semiCards, setSemiCards] = useState<CardListItem[]>([])
  const [picker, setPicker] = useState<false | 'item' | 'semi'>(false)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [usage, setUsage] = useState<{ cardId: number; name: string; qty: number; costPerUnitRub: number | null }[] | null>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [newVersionDate, setNewVersionDate] = useState('')

  useEffect(() => {
    costApi.items().then((r) => setItems(r.items)).catch(() => setItems([]))
    costApi.cards({ kind: 'semi' }).then((r) => setSemiCards(r.cards)).catch(() => setSemiCards([]))
    api<{ products: { id: number; name: string }[] }>('/products')
      .then((r) => setProducts(r.products ?? []))
      .catch(() => setProducts([]))
  }, [])

  useEffect(() => {
    if (isNew) return
    costApi
      .card(cardId as number)
      .then(({ card }) => {
        setCard(card)
        setName(card.name)
        setKind(card.kind)
        setOutputQty(card.outputQty)
        setOutputUnit(card.outputUnit)
        setWriteOffMode(card.writeOffMode)
        setProductId(card.productId ?? '')
        setRetail(card.retailPriceRub ?? card.retailCalcRub ?? '')
        setLines(card.lines.map(draftFromLine))
      })
      .catch((e) => setError(e instanceof Error ? e : new Error('Карта не загрузилась')))
  }, [cardId, isNew])

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const semiById = useMemo(() => new Map(semiCards.map((s) => [s.id, s])), [semiCards])

  /** Локальный расчёт строк и итогов: сервер пересчитает то же самое после сохранения. */
  const computed = useMemo(() => {
    let total = 0
    let missing = false
    const rows = lines.map((l) => {
      const n = lineNumbers({ brutto: l.qtyBrutto, lossColdPct: l.lossColdPct, lossHotPct: l.lossHotPct, netto: l.nettoInput, yieldQty: l.yieldInput })
      let cost: number | null = null
      if (l.childCardId) {
        const semi = semiById.get(l.childCardId)
        cost = semi?.costPerUnitRub != null ? l.qtyBrutto * semi.costPerUnitRub : null
      } else if (l.stockItemId) {
        cost = lineCostRub(n.netto > 0 ? l.qtyBrutto : l.qtyBrutto, itemById.get(l.stockItemId)?.costRub ?? null)
      }
      if (cost == null) missing = true
      else if (l.lineRole !== 'optional') total += cost
      return { ...l, numbers: n, cost }
    })
    const perUnit = outputQty > 0 ? total / outputQty : null
    const retailNum = typeof retail === 'number' ? retail : null
    const foodCost = perUnit != null && retailNum ? Math.round((perUnit / retailNum) * 1000) / 10 : null
    return { rows, total, perUnit, missing, foodCost, margin: perUnit != null && retailNum != null ? retailNum - perUnit : null }
  }, [lines, itemById, semiById, outputQty, retail])

  const save = async (opts: { publish?: boolean } = {}) => {
    if (!name.trim()) {
      toast.push('Дайте карте название', 'bad')
      return
    }
    setBusy(true)
    try {
      const body: CardPayload = {
        name: name.trim(),
        kind,
        outputQty,
        outputUnit,
        writeOffMode,
        productId: typeof productId === 'number' ? productId : null,
        retailPriceRub: typeof retail === 'number' ? retail : null,
        lines: draftPayload(lines),
      }
      const res = isNew ? await costApi.create(body) : await costApi.update(cardId as number, body)
      if (opts.publish) {
        const pub = await costApi.publish(res.card.id)
        toast.push(
          `Карта опубликована: нормы ушли на склад (${pub.projection.norms}), себестоимость ${money(pub.card.costPerUnitRub)}`,
          'ok',
        )
      } else {
        toast.push('Техкарта сохранена')
      }
      setCard(res.card)
      if (isNew) onClose()
      else {
        setLines(res.card.lines.map(draftFromLine))
        setRetail(res.card.retailPriceRub ?? res.card.retailCalcRub ?? '')
      }
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось сохранить карту', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const createVersion = async () => {
    if (!card) return
    setBusy(true)
    try {
      const validFrom = newVersionDate ? new Date(`${newVersionDate}T00:00:00`).getTime() : Date.now()
      await costApi.newVersion(card.id, { validFrom, note: newVersionDate ? `с ${newVersionDate}` : 'новая версия' })
      toast.push(`Новая версия с ${new Date(validFrom).toLocaleDateString('ru-RU')} — правьте состав и сохраняйте`)
      setVersionsOpen(false)
      const fresh = await costApi.card(card.id)
      setCard(fresh.card)
      setLines(fresh.card.lines.map(draftFromLine))
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось создать версию', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const openUsage = async () => {
    if (!card) return
    try {
      const r = await costApi.usage(card.id)
      setUsage(r.usage)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось получить вхождение', 'bad')
    }
  }

  if (error) return <ErrorBox message={error.message} />
  if (!isNew && !card) return <Skeleton />

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={onClose} aria-label="Назад к списку">
          <ArrowLeft size={14} /> К списку
        </Button>
        <span className="text-sm font-semibold">{isNew ? 'Новая техкарта' : card?.name}</span>
        {card && card.insights.map((i) => <Badge key={i.code} tone={i.tone === 'bad' ? 'bad' : 'warn'}>{i.text}</Badge>)}
        <div className="ml-auto flex flex-wrap gap-2">
          {!isNew && (
            <>
              <Button variant="secondary" onClick={() => setVersionsOpen(true)}>
                <History size={14} /> Версии
              </Button>
              <Button variant="secondary" onClick={openUsage}>
                <Layers size={14} /> Вхождение
              </Button>
              <Button variant="secondary" onClick={() => setConfirmDelete(true)} aria-label="Удалить карту">
                <Trash2 size={14} />
              </Button>
            </>
          )}
          <Button variant="secondary" loading={busy} onClick={() => void save()}>
            Сохранить
          </Button>
          <Button loading={busy} onClick={() => void save({ publish: true })}>
            Опубликовать
          </Button>
        </div>
      </div>

      <Card className="mb-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Название">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Капучино 250 мл" />
          </Field>
          <Field label="Тип">
            <Select value={kind} onChange={(e) => setKind(e.target.value as CardKind)}>
              <option value="dish">Блюдо</option>
              <option value="semi">Заготовка</option>
              <option value="modifier">Модификатор</option>
            </Select>
          </Field>
          <Field label="Норма закладки">
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.001"
                min="0.001"
                value={outputQty}
                onChange={(e) => setOutputQty(Number(e.target.value) || 0)}
                aria-label="Норма закладки"
              />
              <Select value={outputUnit} onChange={(e) => setOutputUnit(e.target.value as Unit)} aria-label="Единица нормы">
                {Object.entries(UNIT_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          <Field label="Списание со склада">
            <Select value={writeOffMode} onChange={(e) => setWriteOffMode(e.target.value as WriteOffMode)}>
              {Object.entries(WRITE_OFF_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Товар кассы (необязательно)">
            <Select
              value={productId}
              onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : '')}
              aria-label="Товар кассы"
            >
              <option value="">— без привязки —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="mb-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">Состав</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPicker('item')}>
              <Plus size={14} /> Ингредиент
            </Button>
            <Button variant="secondary" onClick={() => setPicker('semi')}>
              <Plus size={14} /> Заготовка
            </Button>
          </div>
        </div>

        {lines.length === 0 && <p className="text-sm text-ink-secondary">Пока пусто: добавьте ингредиент или заготовку.</p>}

        <div className="grid gap-2">
          {computed.rows.map((row, idx) => {
            const item = row.stockItemId ? itemById.get(row.stockItemId) : null
            const semi = row.childCardId ? semiById.get(row.childCardId) : null
            const unit = item ? UNIT_LABELS[item.unit] : semi ? UNIT_LABELS[semi.outputUnit] : ''
            return (
              <div key={row.key} className="rounded-xl border border-line p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{item?.name ?? semi?.name ?? '—'}</span>
                  {item && <span className="text-[11px] text-ink-tertiary">{COST_SOURCE_LABELS[item.costSource]} · {money(item.costRub)}/{UNIT_LABELS[item.unit]}</span>}
                  {semi && <span className="text-[11px] text-ink-tertiary">заготовка · {money(semi.costPerUnitRub)}/{UNIT_LABELS[semi.outputUnit]}</span>}
                  <Select
                    className="ml-auto w-auto"
                    value={row.lineRole}
                    onChange={(e) =>
                      setLines((ls) => ls.map((l) => (l.key === row.key ? { ...l, lineRole: e.target.value as 'base' | 'optional' } : l)))
                    }
                    aria-label="Роль строки"
                  >
                    <option value="base">в себестоимость</option>
                    <option value="optional">опция</option>
                  </Select>
                  <Button
                    variant="secondary"
                    onClick={() => setLines((ls) => ls.filter((l) => l.key !== row.key))}
                    aria-label={`Убрать строку ${idx + 1}`}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <Field label={`Брутто, ${unit}`}>
                    <Input
                      type="number"
                      step="0.001"
                      min="0.001"
                      value={row.qtyBrutto}
                      onChange={(e) =>
                        setLines((ls) => ls.map((l) => (l.key === row.key ? { ...l, qtyBrutto: Number(e.target.value) || 0 } : l)))
                      }
                      aria-label={`Брутто строки ${idx + 1}`}
                    />
                  </Field>
                  <Field label="Потери хол., %">
                    <Input
                      type="number"
                      step="0.1"
                      value={row.lossColdPct}
                      onChange={(e) =>
                        setLines((ls) => ls.map((l) => (l.key === row.key ? { ...l, lossColdPct: Number(e.target.value) || 0, nettoInput: null } : l)))
                      }
                      aria-label={`Потери холодной обработки строки ${idx + 1}`}
                    />
                  </Field>
                  <Field label={`Нетто, ${unit}`}>
                    <Input
                      type="number"
                      step="0.001"
                      value={row.numbers.netto}
                      onChange={(e) =>
                        setLines((ls) => ls.map((l) => (l.key === row.key ? { ...l, nettoInput: Number(e.target.value) || 0 } : l)))
                      }
                      aria-label={`Нетто строки ${idx + 1}`}
                    />
                  </Field>
                  <Field label="Потери гор., %">
                    <Input
                      type="number"
                      step="0.1"
                      value={row.lossHotPct}
                      onChange={(e) =>
                        setLines((ls) => ls.map((l) => (l.key === row.key ? { ...l, lossHotPct: Number(e.target.value) || 0, yieldInput: null } : l)))
                      }
                      aria-label={`Потери горячей обработки строки ${idx + 1}`}
                    />
                  </Field>
                  <Field label={`Выход, ${unit}`}>
                    <Input
                      type="number"
                      step="0.001"
                      value={row.numbers.yieldQty}
                      onChange={(e) =>
                        setLines((ls) => ls.map((l) => (l.key === row.key ? { ...l, yieldInput: Number(e.target.value) || 0 } : l)))
                      }
                      aria-label={`Выход строки ${idx + 1}`}
                    />
                  </Field>
                  <Field label="Сумма">
                    <div className="flex h-10 items-center text-sm font-semibold">{money(row.cost)}</div>
                  </Field>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Цена продажи, ₽">
            <Input
              type="number"
              step="0.01"
              value={retail}
              onChange={(e) => setRetail(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder={computed.perUnit != null ? (computed.perUnit * 4).toFixed(2) : ''}
              aria-label="Цена продажи"
            />
          </Field>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Себестоимость порции</div>
            <div className="text-lg font-bold">{money(computed.perUnit)}</div>
            <div className="text-[11px] text-ink-tertiary">{computed.missing ? 'часть сырья без цены' : 'все цены есть'}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Фудкост</div>
            <div className={cx('text-lg font-bold', computed.foodCost != null && computed.foodCost > 35 && 'text-bad')}>{pct(computed.foodCost)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Маржа</div>
            <div className="text-lg font-bold">{money(computed.margin)}</div>
          </div>
        </div>
        {card?.overheadEnabled && card.overheadPerUnitRub != null && (
          <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Постоянные на порцию</div>
              <div className="text-sm font-semibold">{money(card.overheadPerUnitRub)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Полная себестоимость</div>
              <div className="text-sm font-semibold">{money(card.fullCostPerUnitRub)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Полный фудкост</div>
              <div className="text-sm font-semibold">{pct(card.fullFoodCostPct)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Маржа с расходами</div>
              <div className="text-sm font-semibold">{money(card.fullMarginRub)}</div>
            </div>
          </div>
        )}
      </Card>

      <PickerDrawer
        open={picker}
        onClose={() => setPicker(false)}
        mode={picker || 'item'}
        items={items}
        semis={semiCards.filter((s) => s.id !== (typeof cardId === 'number' ? cardId : -1))}
        onPick={(pick) => {
          setLines((ls) => [
            ...ls,
            {
              key: key(),
              stockItemId: pick.stockItemId ?? null,
              childCardId: pick.childCardId ?? null,
              qtyBrutto: pick.defaultQty,
              lossColdPct: 0,
              lossHotPct: 0,
              nettoInput: null,
              yieldInput: null,
              lineRole: 'base',
            },
          ])
          setPicker(false)
        }}
      />

      <Drawer open={versionsOpen} onClose={() => setVersionsOpen(false)} title="Версии техкарты">
        <p className="mb-3 text-sm text-ink-secondary">
          Новая версия нужна, когда меняется состав. Версия вступает в силу с даты и не переписывает прошлое.
        </p>
        <Field label="Действует с">
          <Input type="date" value={newVersionDate} onChange={(e) => setNewVersionDate(e.target.value)} />
        </Field>
        <Button className="mt-3" loading={busy} onClick={() => void createVersion()}>
          Создать версию
        </Button>
        <div className="mt-4 grid gap-2">
          {(card?.versions ?? []).map((v) => (
            <div key={v.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <span>{new Date(v.validFrom).toLocaleDateString('ru-RU')}</span>
              <span className="text-ink-tertiary">{v.note ?? '—'}</span>
              {v.active && <Badge tone="ok">действует</Badge>}
            </div>
          ))}
        </div>
      </Drawer>

      <Drawer open={usage !== null} onClose={() => setUsage(null)} title="Где используется">
        {usage && usage.length === 0 && <p className="text-sm text-ink-secondary">Заготовка пока никуда не входит.</p>}
        <div className="grid gap-2">
          {(usage ?? []).map((u) => (
            <div key={u.cardId} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <span className="font-medium">{u.name}</span>
              <span className="text-ink-tertiary">× {u.qty}</span>
              <span className="ml-auto">{money(u.costPerUnitRub)}</span>
            </div>
          ))}
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить техкарту?"
        danger
        confirmLabel="Удалить"
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (typeof cardId !== 'number') return
          setBusy(true)
          try {
            await costApi.remove(cardId)
            toast.push('Техкарта удалена')
            setConfirmDelete(false)
            onClose()
          } catch (e) {
            toast.push(e instanceof Error ? e.message : 'Не удалось удалить', 'bad')
          } finally {
            setBusy(false)
          }
        }}
      >
        Карта и её версии исчезнут. Если она входит в другие карты, сервер откажет.
      </ConfirmDialog>
    </div>
  )
}

/* ─────────────────────────── выбор ингредиента ─────────────────────────── */

function PickerDrawer({
  open,
  onClose,
  mode,
  items,
  semis,
  onPick,
}: {
  open: false | 'item' | 'semi'
  onClose: () => void
  mode: 'item' | 'semi'
  items: CostItem[]
  semis: CardListItem[]
  onPick: (p: { stockItemId?: number; childCardId?: number; defaultQty: number }) => void
}) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (mode === 'semi') return semis.filter((s) => !needle || s.name.toLowerCase().includes(needle))
    return items.filter((i) => !needle || i.name.toLowerCase().includes(needle))
  }, [q, items, semis, mode])

  return (
    <Drawer open={!!open} onClose={onClose} title={mode === 'semi' ? 'Добавить заготовку' : 'Добавить ингредиент'}>
      <div className="relative mb-3">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск" className="pl-8" autoFocus />
      </div>
      <div className="grid gap-1.5">
        {filtered.slice(0, 60).map((row) =>
          mode === 'semi' ? (
            <button
              key={`semi-${row.id}`}
              type="button"
              onClick={() => onPick({ childCardId: row.id, defaultQty: 1 })}
              className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-brand/40"
            >
              <span className="font-medium">{(row as CardListItem).name}</span>
              <span className="text-[11px] text-ink-tertiary">
                {(row as CardListItem).outputQty} {(row as CardListItem).outputUnit}
              </span>
              <span className="ml-auto">{money((row as CardListItem).costPerUnitRub)}</span>
            </button>
          ) : (
            <button
              key={`item-${row.id}`}
              type="button"
              onClick={() => onPick({ stockItemId: row.id, defaultQty: 1 })}
              className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-brand/40"
            >
              <span className="font-medium">{(row as CostItem).name}</span>
              <span className="text-[11px] text-ink-tertiary">
                {money((row as CostItem).costRub)}/{UNIT_LABELS[(row as CostItem).unit]}
              </span>
              {(row as CostItem).problems.length > 0 && <Badge tone="warn">{(row as CostItem).problems[0]}</Badge>}
            </button>
          ),
        )}
        {filtered.length === 0 && <p className="text-sm text-ink-secondary">Ничего не найдено</p>}
      </div>
      {open && mode === 'item' && <p className="mt-3 text-[11px] text-ink-tertiary">Нет нужного? Добавьте позицию в «Складе» — она появится здесь.</p>}
    </Drawer>
  )
}

/* ─────────────────────────── массовая замена ─────────────────────────── */

function BulkReplaceDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [items, setItems] = useState<CostItem[]>([])
  const [from, setFrom] = useState<number | ''>('')
  const [to, setTo] = useState<number | ''>('')
  const [factor, setFactor] = useState(1)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    costApi.items().then((r) => setItems(r.items)).catch(() => setItems([]))
  }, [open])

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Заменить ингредиент во всех картах"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              if (typeof from !== 'number' || typeof to !== 'number') {
                toast.push('Выберите, что на что менять', 'bad')
                return
              }
              setBusy(true)
              try {
                const r = await costApi.bulkReplace({ fromStockItemId: from, toStockItemId: to, factor })
                toast.push(`Заменено в картах: ${r.cards}, строк: ${r.lines}`, 'ok')
                onClose()
              } catch (e) {
                toast.push(e instanceof Error ? e.message : 'Не удалось заменить', 'bad')
              } finally {
                setBusy(false)
              }
            }}
          >
            Заменить
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-ink-secondary">
        Пригодится, когда поставщик сменил позицию: количество пересчитается на коэффициент, карты останутся рабочими.
      </p>
      <Field label="Заменить">
        <Select value={from} onChange={(e) => setFrom(e.target.value ? Number(e.target.value) : '')}>
          <option value="">— выберите —</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({UNIT_LABELS[i.unit]})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="На">
        <Select value={to} onChange={(e) => setTo(e.target.value ? Number(e.target.value) : '')}>
          <option value="">— выберите —</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({UNIT_LABELS[i.unit]})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Коэффициент количества">
        <Input type="number" step="0.01" min="0.01" value={factor} onChange={(e) => setFactor(Number(e.target.value) || 1)} />
      </Field>
      {busy && <Spinner />}
    </Drawer>
  )
}
