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
  const [planDraft, setPlanDraft] = useState<Record<number, string>>({})

  const loadPlan = () => {
    costApi
      .salesPlan()
      .then((p) => {
        setPlan(p)
        setPlanDraft(Object.fromEntries(p.rows.map((r) => [r.cardId, r.plannedUnits ? String(r.plannedUnits) : ''])))
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
      const rows = plan.rows.map((r) => ({ cardId: r.cardId, unitsPerMonth: Number(planDraft[r.cardId]) || 0 }))
      const p = await costApi.saveSalesPlan(rows)
      setPlan(p)
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
          <div className="mb-1 text-sm font-semibold">План продаж по позициям</div>
          <p className="mb-2 text-[12px] text-ink-secondary">
            Укажите, сколько штук каждой позиции планируете за месяц. Расходы делятся между позициями по их доле
            ({plan.mode === 'revenue' ? 'пропорционально выручке' : 'поровну по количеству'}), а внутри позиции — на её
            собственный план. Так в дорогом капучино аренды больше, чем в редком эспрессо.
          </p>

          {plan.source === 'sales' && (
            <div className="mb-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-secondary">
              Сейчас база — фактически{' '}
              <b>продажи за {plan.windowDays} дн.</b> ({plan.totals.actualUnits} шт). План пригодится, когда чеков не будет.
            </div>
          )}
          {plan.source === 'none' && (
            <div className="mb-2 rounded-lg border border-amber bg-surface-2 px-3 py-2 text-[12px]">
              Пока не заполнен ни план, ни продажи — расходы раскладываются на общий объём из поля выше.
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-tertiary">
                  <th className="px-2 py-2">Позиция</th>
                  <th className="px-2 py-2 text-right">Цена</th>
                  <th className="px-2 py-2 text-right">План, шт/мес</th>
                  <th className="px-2 py-2 text-right">Доля</th>
                  <th className="px-2 py-2 text-right">План. выручка</th>
                  <th className="px-2 py-2 text-right">Постоянные на порцию</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.cardId} className="border-b border-line/60">
                    <td className="px-2 py-2">{r.name}</td>
                    <td className="px-2 py-2 text-right">{money(r.retailRub)}</td>
                    <td className="px-2 py-2 text-right">
                      <Input
                        className="ml-auto w-24 text-right"
                        type="number"
                        min="0"
                        step="1"
                        aria-label={`План продаж: ${r.name}`}
                        value={planDraft[r.cardId] ?? ''}
                        onChange={(e) => setPlanDraft((d) => ({ ...d, [r.cardId]: e.target.value }))}
                      />
                    </td>
                    <td className="px-2 py-2 text-right">{pct(r.sharePct)}</td>
                    <td className="px-2 py-2 text-right">{money(r.planRevenueRub)}</td>
                    <td className="px-2 py-2 text-right">
                      <div className="font-semibold">{money(r.overheadPerUnitRub)}</div>
                      {r.breakdownRub.length > 0 && (
                        <div className="text-[10px] text-ink-tertiary">
                          {r.breakdownRub.map((b) => `${b.name} ${money(b.perUnitRub)}`).join(' · ')}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-[12px] font-semibold">
                  <td className="px-2 py-2">Итого</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-right">{plan.totals.plannedUnits} шт</td>
                  <td className="px-2 py-2 text-right">100 %</td>
                  <td className="px-2 py-2 text-right">{money(plan.totalRevenueRub)}</td>
                  <td className="px-2 py-2 text-right">{money(plan.totalRub)} за месяц</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button loading={busy} onClick={() => void savePlan()}>
              Сохранить план
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const total = Number(planned) || 0
                if (!total || !plan) return
                // Быстрый способ: задать общий план и доли в процентах — считаем штуки.
                const shares = plan.rows.map((r) => ({ id: r.cardId, share: Number(planDraft[r.cardId]) || 0 }))
                const sum = shares.reduce((s2, r) => s2 + r.share, 0)
                if (sum <= 0) return
                setPlanDraft(Object.fromEntries(shares.map((r) => [r.id, String(Math.round((total * r.share) / sum))])))
                toast.push('Доли пересчитаны в штуки — проверьте и сохраните')
              }}
              aria-label="Пересчитать проценты в штуки"
            >
              Доли → штуки от общего плана
            </Button>
            <span className="text-[11px] text-ink-tertiary">
              База: {plan.basisLabel} · сумма постоянных {money(plan.totalRub)}
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
