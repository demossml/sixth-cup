/**
 * F11: «Расходы» — постоянные месячные затраты (электричество, зарплата, аренда, налоги)
 * и то, как они ложатся на одну порцию.
 *
 * Главное здесь — флаг: пока он снят, статьи можно заполнять, но в себестоимость они не идут.
 */
import { useEffect, useState } from 'react'

import { Badge, Button, Card, EmptyState, ErrorBox, Input, Select, Skeleton, useToast } from '../../ui/kit'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'

import { costApi, type OverheadRow, type OverheadsState, type SalesPlan } from '../../lib/costApi'
import { OVERHEAD_KIND_LABELS, money, pct } from '../../lib/costMath'


const PERIOD_LABEL: Record<OverheadRow['period'], string> = { month: 'в месяц', quarter: 'в квартал', year: 'в год' }

export default function OverheadsTab({ reloadKey = 0 }: { reloadKey?: number }) {
  const toast = useToast()
  const [state, setState] = useState<OverheadsState | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [draft, setDraft] = useState<Record<number, string>>({})
  const [newRow, setNewRow] = useState<{ name: string; kind: OverheadRow['kind']; amount: string }>({ name: '', kind: 'other', amount: '' })
  const [planned, setPlanned] = useState('')
  const [busy, setBusy] = useState(false)
  // F15: план продаж по позициям — по нему расходы делятся между блюдами.
  const [plan, setPlan] = useState<SalesPlan | null>(null)
  /** Черновик весов популярности: ползунки, а не цифры. */
  const [planDraft, setPlanDraft] = useState<Record<number, number>>({})

  const loadPlan = () => {
    costApi
      .salesPlan()
      .then((p) => {
        setPlan(p)
        setPlanDraft(Object.fromEntries(p.rows.map((r) => [r.cardId, r.weight ?? 0])))
      })
      .catch(() => setPlan(null))
  }

  const load = () => {
    setError(null)
    costApi
      .overheads()
      .then((s) => {
        setState(s)
        setPlanned(s.plannedUnitsPerMonth ? String(s.plannedUnitsPerMonth) : '')
        setDraft({})
        loadPlan()
      })
      .catch((e) => setError(e instanceof Error ? e : new Error('Не удалось загрузить расходы')))
  }

  useEffect(load, [reloadKey])

  if (error) return <ErrorBox message={error.message} />
  if (!state) return <Skeleton />

  const saveAmount = async (row: OverheadRow) => {
    const raw = draft[row.id]
    if (raw == null || raw === '') return
    setBusy(true)
    try {
      const r = await costApi.updateOverhead(row.id, { amountRub: Number(raw) })
      setState(r.overheads)
      setDraft((d) => ({ ...d, [row.id]: '' }))
      toast.push(`«${row.name}»: ${money(Number(raw))} ${PERIOD_LABEL[row.period]}`, 'ok')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось сохранить', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const savePlan = async () => {
    if (!plan) return
    setBusy(true)
    try {
      const rows = plan.rows.map((r) => ({ cardId: r.cardId, weight: Number(planDraft[r.cardId]) || 0 }))
      const p = await costApi.saveSalesPlan(rows)
      setPlan(p)
      setPlanDraft(Object.fromEntries(p.rows.map((r) => [r.cardId, r.weight ?? 0])))
      const over = await costApi.overheads()
      setState(over)
      toast.push(`План сохранён: ${p.totals.plannedUnits} шт/мес`, 'ok')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось сохранить план', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const toggleEnabled = async () => {
    setBusy(true)
    try {
      const r = await costApi.updateCostSettings({ enabled: !state.enabled })
      setState(r.overheads)
      toast.push(
        r.overheads.enabled
          ? 'Постоянные расходы учитываются в себестоимости'
          : 'Постоянные расходы выключены — считается только сырьё',
        'ok',
      )
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось переключить', 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <Card className="mb-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <div className="text-sm font-semibold">Учитывать постоянные расходы в себестоимости</div>
            <div className="text-[12px] text-ink-secondary">
              {state.enabled
                ? 'Доля расходов добавляется к сырью: в картах видно и полную себестоимость, и полную маржу.'
                : 'Выключено: статьи можно заполнять, но в расчёт они не идут.'}
            </div>
          </div>
          <Button variant={state.enabled ? 'primary' : 'secondary'} loading={busy} onClick={toggleEnabled}>
            {state.enabled ? 'Включено' : 'Выключено'}
          </Button>
        </div>
      </Card>

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Постоянные за месяц</div>
          <div className="text-lg font-bold">{money(state.totalRub)}</div>
        </Card>
        <Card className="px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">База распределения</div>
          <div className="text-sm font-semibold">{state.basisLabel}</div>
          <div className="text-[11px] text-ink-tertiary">
            {state.allocation === 'units' ? 'поровну на единицу' : 'пропорционально выручке'}
          </div>
        </Card>
        <Card className="px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">На одну порцию</div>
          <div className="text-lg font-bold">{money(state.perUnitRub)}</div>
        </Card>
        <Card className="px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Применяется сейчас</div>
          <div className="text-lg font-bold">{state.enabled ? money(state.appliedPerUnitRub) : '—'}</div>
        </Card>
      </div>

      {state.rows.length === 0 && <EmptyState title="Статей пока нет" text="Добавьте электричество, зарплату, аренду и налоги." />}

      <div className="grid gap-2">
        {state.rows.map((row) => (
          <Card key={row.id} className="p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[160px] flex-1">
                <div className="text-sm font-semibold">{row.name}</div>
                <div className="text-[11px] text-ink-tertiary">
                  {OVERHEAD_KIND_LABELS[row.kind]} · {PERIOD_LABEL[row.period]}
                </div>
              </div>
              <label className="text-[11px] text-ink-tertiary">
                Сумма, ₽
                <Input
                  className="mt-1 w-32"
                  type="number"
                  min="0"
                  step="100"
                  aria-label={`Сумма: ${row.name}`}
                  placeholder={row.amountRub != null ? String(row.amountRub) : '0'}
                  value={draft[row.id] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [row.id]: e.target.value }))}
                />
              </label>
              <Button disabled={!draft[row.id]} loading={busy} onClick={() => void saveAmount(row)}>
                Сохранить
              </Button>
              <Button
                variant="secondary"
                aria-label={`Удалить статью ${row.name}`}
                onClick={async () => {
                  try {
                    const r = await costApi.deleteOverhead(row.id)
                    setState(r.overheads)
                    toast.push(`«${row.name}» удалена`)
                  } catch (e) {
                    toast.push(e instanceof Error ? e.message : 'Не удалось удалить', 'bad')
                  }
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
            {row.amountRub != null && row.amountRub > 0 && (
              <div className="mt-1 text-[11px] text-ink-tertiary">сейчас: {money(row.amountRub)}</div>
            )}
          </Card>
        ))}
      </div>

      <Card className="mt-3">
        <div className="mb-2 text-sm font-semibold">Как раскладывать на порции</div>
        <div className="flex flex-wrap items-end gap-3">
          <Field2 label="Способ">
            <Select
              value={state.allocation}
              aria-label="Способ распределения"
              onChange={async (e) => {
                const r = await costApi.updateCostSettings({ allocation: e.target.value as 'units' | 'revenue' })
                setState(r.overheads)
              }}
            >
              <option value="units">поровну на каждую единицу</option>
              <option value="revenue">пропорционально выручке</option>
            </Select>
          </Field2>
          <Field2 label="Общий план, шт/мес (если план по позициям не заполнен)">
            <div className="flex gap-2">
              <Input
                className="w-32"
                type="number"
                min="0"
                step="10"
                value={planned}
                aria-label="План продаж в месяц"
                onChange={(e) => setPlanned(e.target.value)}
              />
              <Button
                variant="secondary"
                onClick={async () => {
                  const r = await costApi.updateCostSettings({ plannedUnitsPerMonth: Number(planned) || 0 })
                  setState(r.overheads)
                  toast.push('План сохранён', 'ok')
                }}
              >
                Сохранить
              </Button>
            </div>
          </Field2>
          <Button variant="secondary" onClick={load} aria-label="Обновить расходы">
            <RefreshCw size={14} />
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-ink-tertiary">
          Данные о продажах берутся из чеков за {state.windowDays} дней
          {state.soldUnits > 0 ? ` (${Math.round(state.soldUnits)} шт)` : ' — пока их нет, работает план'}.
        </p>
      </Card>

      {plan && plan.rows.length > 0 && (
        <Card className="mt-3">
          <div className="mb-1 text-sm font-semibold">Что продаётся чаще — веса позиций</div>
          <p className="mb-2 text-[12px] text-ink-secondary">
            Двигайте ползунки: чем популярнее позиция, тем больше её вес. Штуки и доли считаются сами от общего
            плана — вписывать цифры по каждой позиции не нужно. Расходы делятся по долям
            ({plan.mode === 'revenue' ? 'пропорционально выручке' : 'поровну по количеству'}).
          </p>

          {plan.source === 'sales' && (
            <div className="mb-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-secondary">
              Сейчас база — фактически{' '}
              <b>продажи за {plan.windowDays} дн.</b> ({plan.totals.actualUnits} шт). Веса пригодятся, когда чеков не будет.
            </div>
          )}
          {plan.source === 'none' && (
            <div className="mb-2 rounded-lg border border-amber bg-surface-2 px-3 py-2 text-[12px]">
              Укажите общий план продаж выше и расставьте веса — тогда расходы разложатся по позициям.
            </div>
          )}
          {plan.totals.plannedUnits === 0 && plan.source !== 'sales' && (
            <div className="mb-2 text-[11px] text-ink-tertiary">
              Общий план пуст: штуки появятся, когда укажете его в поле «Общий план, шт/мес».
            </div>
          )}

          <div className="space-y-3">
            {plan.rows.map((r) => {
              const weight = planDraft[r.cardId] ?? 0
              // Живой предпросмотр: двигаем ползунок — сразу видно штуки, долю и расход на порцию.
              const draftSum = plan.rows.reduce((s2, x) => s2 + Math.max(0, planDraft[x.cardId] ?? 0), 0)
              const planTotal = Number(planned) || plan.totals.plannedUnits
              const previewUnits = draftSum > 0 ? (planTotal * weight) / draftSum : planTotal / plan.rows.length
              const weightOf = (x: (typeof plan.rows)[number]) => {
                const u = draftSum > 0 ? (planTotal * Math.max(0, planDraft[x.cardId] ?? 0)) / draftSum : previewUnits
                return plan.mode === 'revenue' ? u * (x.retailRub ?? 0) : u
              }
              const totalWeight = plan.rows.reduce((s2, x) => s2 + weightOf(x), 0)
              const sharePct = totalWeight > 0 ? (weightOf(r) / totalWeight) * 100 : 0
              const perUnit =
                previewUnits > 0 && plan.totalRub != null ? ((plan.totalRub ?? 0) * (sharePct / 100)) / previewUnits : null
              // Разбивку тоже считаем от ползунка, иначе она отстаёт от предпросмотра.
              const monthlyKop = (a: { amountRub: number | null; period: string }) => {
                const amount = a.amountRub ?? 0
                return a.period === 'quarter' ? amount / 3 : a.period === 'year' ? amount / 12 : amount
              }
              const previewBreakdown = (state?.rows ?? [])
                .filter((a) => monthlyKop(a) > 0)
                .map((a) => ({
                  kind: a.kind,
                  perUnitRub: previewUnits > 0 ? (monthlyKop(a) * (sharePct / 100)) / previewUnits : null,
                }))
              return (
                <div key={r.cardId} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <div className="min-w-[140px] flex-1 text-sm font-semibold">{r.name}</div>
                    <div className="text-[12px] text-ink-secondary">{money(r.retailRub)}</div>
                    <div className="text-[12px] tabular-nums">
                      вес <b>{weight}</b>
                    </div>
                    <div className="text-[12px] text-ink-secondary tabular-nums">
                      ≈ {Math.round(previewUnits)} шт/мес · {pct(sharePct)}
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold">{money(perUnit)}</div>
                      {previewBreakdown.length > 0 && (
                        <div className="text-[10px] text-ink-tertiary">
                          {previewBreakdown
                            .map((b) => `${OVERHEAD_KIND_LABELS[b.kind] ?? b.kind} ${money(b.perUnitRub)}`)
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="text-[11px] text-ink-tertiary">редко</span>
                    <input
                      type="range"
                      min={0}
                      max={20}
                      step={1}
                      value={weight}
                      aria-label={`Вес популярности: ${r.name}`}
                      onChange={(e) => setPlanDraft((d) => ({ ...d, [r.cardId]: Number(e.target.value) }))}
                      className="range flex-1"
                    />
                    <span className="text-[11px] text-ink-tertiary">часто</span>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button loading={busy} onClick={() => void savePlan()}>
              Сохранить веса
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPlanDraft(Object.fromEntries(plan.rows.map((r) => [r.cardId, 10])))}
              aria-label="Поставить всем одинаковый вес"
            >
              Всем поровну
            </Button>
            <span className="text-[11px] text-ink-tertiary">
              База: {plan.basisLabel} · всего {plan.totals.plannedUnits} шт/мес · постоянные {money(plan.totalRub)}
            </span>
          </div>
        </Card>
      )}

      <Card className="mt-3">
        <div className="mb-2 text-sm font-semibold">Добавить статью</div>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            className="min-w-[160px] flex-1"
            placeholder="Например, интернет"
            aria-label="Название статьи"
            value={newRow.name}
            onChange={(e) => setNewRow((r) => ({ ...r, name: e.target.value }))}
          />
          <Select value={newRow.kind} aria-label="Тип статьи" onChange={(e) => setNewRow((r) => ({ ...r, kind: e.target.value as OverheadRow['kind'] }))}>
            {Object.entries(OVERHEAD_KIND_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Input
            className="w-32"
            type="number"
            min="0"
            placeholder="₽/мес"
            aria-label="Сумма новой статьи"
            value={newRow.amount}
            onChange={(e) => setNewRow((r) => ({ ...r, amount: e.target.value }))}
          />
          <Button
            disabled={!newRow.name.trim()}
            onClick={async () => {
              try {
                const r = await costApi.createOverhead({
                  name: newRow.name.trim(),
                  kind: newRow.kind,
                  amountRub: newRow.amount ? Number(newRow.amount) : 0,
                })
                setState(r.overheads)
                setNewRow({ name: '', kind: 'other', amount: '' })
                toast.push('Статья добавлена')
              } catch (e) {
                toast.push(e instanceof Error ? e.message : 'Не удалось добавить', 'bad')
              }
            }}
          >
            <Plus size={14} /> Добавить
          </Button>
        </div>
        {!state.enabled && (
          <div className="mt-2">
            <Badge tone="warn">Флаг выключен — в расчёт эти суммы не попадут</Badge>
          </div>
        )}
      </Card>
    </div>
  )
}

function Field2({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[11px] text-ink-tertiary">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  )
}
