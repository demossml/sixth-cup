import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApi } from '../api/useApi'
import { api } from '../api/client'
import {
  PageHeader, Card, EmptyState, Badge, Button, Input, Select, Field,
  ErrorBox, Skeleton, Tabs, useToast, cx, ConfirmDialog,
} from '../ui/kit'
import { Plus, RefreshCw, Truck } from 'lucide-react'
import { HelpLink } from '../components/HelpLink'
import { deactivatedHint, entityStatusLabel } from '../lib/format'
import BankTab from './purchases/BankTab'
import ReconTab from './purchases/ReconTab'
import OrdersTab from './purchases/OrdersTab'
import { csvName, downloadCsv } from '../lib/csv'
import { setParams } from '../lib/query'
import ReturnsTab from './purchases/ReturnsTab'

type Supplier = { id: number; name: string; inn: string | null; contact: string | null; active: number }
type Invoice = {
  id: number; supplierId: number; supplierName: string; number: string | null
  status: string; totalKop: number; paidKop: number; dueAt: number | null; postedAt: number | null
}
type StockItem = { id: number; name: string; unit: string }
type Debt = { supplierId: number; supplierName: string; debtKop: number; openInvoices: number }

const money = (kop: number) =>
  new Intl.NumberFormat('ru-RU').format(Math.round(kop / 100)) + ' ₽'

function statusBadge(s: string) {
  if (s === 'posted') return <Badge tone="ok">проведена</Badge>
  if (s === 'draft') return <Badge tone="neutral">черновик</Badge>
  if (s === 'cancelled') return <Badge tone="bad">отменена</Badge>
  return <Badge tone="neutral">{s}</Badge>
}

type PurchasesTab = 'invoices' | 'orders' | 'returns' | 'suppliers' | 'debt' | 'bank' | 'recon'
const PURCHASES_TABS: PurchasesTab[] = ['invoices', 'orders', 'returns', 'suppliers', 'debt', 'bank', 'recon']

export default function Purchases() {
  const toast = useToast()
  // Tab lives in the address (?tab=orders), like Меню и Операции — so «Заказы» можно открыть ссылкой.
  const [sp, setSp] = useSearchParams()
  const tabParam = sp.get('tab') as PurchasesTab | null
  const tab: PurchasesTab = tabParam && PURCHASES_TABS.includes(tabParam) ? tabParam : 'invoices'
  const setTab = (next: PurchasesTab) =>
    setSp(setParams(sp, { tab: next === 'invoices' ? null : next }), { replace: true })
  const [showInvoice, setShowInvoice] = useState(false)
  const [busy, setBusy] = useState(false)
  // R-03: правка и удаление поставщика без SQL.
  type SupplierForm = { id?: number; name: string; inn: string; contact: string; bankDetails: string; paymentDelayDays: string; active: boolean }
  const emptySupplier = (): SupplierForm => ({ name: '', inn: '', contact: '', bankDetails: '', paymentDelayDays: '0', active: true })
  const [sForm, setSForm] = useState<SupplierForm | null>(null)
  const [sDel, setSDel] = useState<Supplier | null>(null)

  // invoice form (multi-line per audit)
  const [supplierId, setSupplierId] = useState('')
  const [number, setNumber] = useState('')
  type LineDraft = { key: string; stockItemId: string; qty: string; costRub: string; expiresDate: string }
  const emptyLine = (): LineDraft => ({
    key: String(Date.now()) + Math.random(),
    stockItemId: '',
    qty: '1',
    costRub: '0',
    expiresDate: '',
  })
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])

  const invoices = useApi<{ invoices: Invoice[]; summary: { openDebt: number } }>('/purchases/invoices')
  const suppliers = useApi<{ suppliers: Supplier[] }>('/suppliers')
  const debt = useApi<{ debts: Debt[] }>('/purchases/debt')
  const items = useApi<{ items: StockItem[] }>('/stock/items?active=1')
  // D-14: количество строки накладной — в единице позиции, показываем её в подписи.
  const lineUnit = (stockItemId: string) =>
    (items.data?.items ?? []).find((it) => String(it.id) === stockItemId)?.unit ?? ''

  const reloadAll = () => { invoices.reload(); suppliers.reload(); debt.reload() }

  const createInvoice = async () => {
    const parsed = lines
      .map((l) => ({
        stockItemId: Number(l.stockItemId),
        qty: Number(l.qty) || 0,
        unitCostKop: Math.round((Number(l.costRub) || 0) * 100),
        expiresAt: l.expiresDate ? new Date(l.expiresDate + 'T12:00:00').getTime() : null,
      }))
      .filter((l) => l.stockItemId > 0 && l.qty > 0)
    if (!supplierId || !parsed.length) {
      toast.push('Укажите поставщика и хотя бы одну строку', 'bad')
      return
    }
    setBusy(true)
    try {
      const res = await api<{ id: number }>('/purchases/invoices', {
        method: 'POST',
        body: {
          supplierId: Number(supplierId),
          number: number || null,
          lines: parsed,
        },
      })
      toast.push(`Накладная №${res.id} · ${parsed.length} поз. (черновик)`)
      setShowInvoice(false)
      setLines([emptyLine()])
      invoices.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally { setBusy(false) }
  }

  const postInvoice = async (id: number) => {
    setBusy(true)
    try {
      await api(`/purchases/invoices/${id}/post`, { method: 'POST' })
      toast.push('Накладная проведена — остаток увеличен')
      reloadAll(); items.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally { setBusy(false) }
  }

  const payInvoice = async (inv: Invoice) => {
    const rest = inv.totalKop - inv.paidKop
    if (rest <= 0) return
    setBusy(true)
    try {
      await api('/purchases/payments', {
        method: 'POST',
        body: {
          supplierId: inv.supplierId,
          amountKop: rest,
          allocations: [{ invoiceId: inv.id, amountKop: rest }],
        },
      })
      toast.push('Оплата привязана к накладной')
      reloadAll()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally { setBusy(false) }
  }

  const openSupplier = (s?: Supplier) => {
    setSForm(s
      ? {
          id: s.id,
          name: s.name,
          inn: s.inn ?? '',
          contact: s.contact ?? '',
          bankDetails: '',
          paymentDelayDays: '0',
          active: !!s.active,
        }
      : emptySupplier())
  }

  const saveSupplier = async () => {
    if (!sForm || !sForm.name.trim()) return
    setBusy(true)
    try {
      const body = {
        name: sForm.name.trim(),
        inn: sForm.inn.trim() || null,
        contact: sForm.contact.trim() || null,
        bankDetails: sForm.bankDetails.trim() || null,
        paymentDelayDays: Number(sForm.paymentDelayDays) || 0,
        active: sForm.active,
      }
      if (sForm.id) await api(`/suppliers/${sForm.id}`, { method: 'PATCH', body })
      else await api('/suppliers', { method: 'POST', body })
      toast.push(sForm.id ? 'Поставщик сохранён' : 'Поставщик создан')
      setSForm(null)
      suppliers.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const deleteSupplier = async () => {
    if (!sDel) return
    setBusy(true)
    try {
      const res = await api<{ deleted?: boolean; deactivated?: boolean; reason?: string; reasonCode?: string }>(`/suppliers/${sDel.id}`, { method: 'DELETE' })
      toast.push(res.deactivated ? (res.reason ?? 'Поставщик выключен') : 'Поставщик удалён')
      setSDel(null)
      reloadAll()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const tabs = useMemo(() => [
    { key: 'invoices' as const, label: 'Накладные', count: invoices.data?.invoices.length },
    { key: 'orders' as const, label: 'Заказы' },
    { key: 'returns' as const, label: 'Возвраты' },
    { key: 'suppliers' as const, label: 'Поставщики', count: suppliers.data?.suppliers.length },
    { key: 'debt' as const, label: 'Долги', count: debt.data?.debts.length },
    { key: 'bank' as const, label: 'Банк' },
    { key: 'recon' as const, label: 'Сверки' },
  ], [invoices.data, suppliers.data, debt.data])

  const openDebt = invoices.data?.summary.openDebt ?? 0

  return (
    <section className="view is-active" data-view="purchases">
      <div className="page-head">
        <div>
          <h1>Закупки</h1>
          <p className="page-sub">Поставщики, накладные, оплаты с привязкой к документам</p>
        </div>
        <div className="head-actions">
          <HelpLink article="scenario-receipt" />
          <button type="button" className="btn btn-ghost" onClick={reloadAll}>Обновить</button>
          <button type="button" className="btn btn-ghost" onClick={() => openSupplier()}>Поставщик</button>
          <button type="button" className="btn btn-primary" onClick={() => setShowInvoice((v) => !v)}>Накладная</button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">Накладных</div>
          <div className="mt-1 font-mono text-2xl font-bold">{invoices.data?.invoices.length ?? '—'}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">
            <Truck size={12} /> С долгом
          </div>
          <div className={cx('mt-1 font-mono text-2xl font-bold', openDebt ? 'text-warn' : '')}>{openDebt}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">Поставщиков</div>
          <div className="mt-1 font-mono text-2xl font-bold">{suppliers.data?.suppliers.filter((s) => s.active).length ?? '—'}</div>
        </Card>
      </div>

      {sForm && (
        <Card className="mb-4">
          <div className="mb-3 text-[14px] font-semibold">{sForm.id ? 'Поставщик' : 'Новый поставщик'}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Название">
              <Input value={sForm.name} onChange={(e) => setSForm({ ...sForm, name: e.target.value })} placeholder="ООО Поставщик" />
            </Field>
            <Field label="ИНН">
              <Input value={sForm.inn} onChange={(e) => setSForm({ ...sForm, inn: e.target.value })} placeholder="опционально" />
            </Field>
            <Field label="Контакт">
              <Input value={sForm.contact} onChange={(e) => setSForm({ ...sForm, contact: e.target.value })} placeholder="Имя, телефон" />
            </Field>
            <Field label="Реквизиты для акта">
              <Input value={sForm.bankDetails} onChange={(e) => setSForm({ ...sForm, bankDetails: e.target.value })} placeholder="р/с, банк" />
            </Field>
            <Field label="Отсрочка, дней">
              <Input type="number" min={0} value={sForm.paymentDelayDays} onChange={(e) => setSForm({ ...sForm, paymentDelayDays: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button loading={busy} onClick={saveSupplier} disabled={!sForm.name.trim()}>Сохранить</Button>
            <Button variant="ghost" onClick={() => setSForm(null)}>Отмена</Button>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={!!sDel}
        danger
        busy={busy}
        title="Удалить поставщика?"
        confirmLabel="Удалить"
        onCancel={() => setSDel(null)}
        onConfirm={deleteSupplier}
      >
        {sDel && `«${sDel.name}» будет удалён. Если по нему есть документы — запись не удалится, а перейдёт в статус «выключен»: история и долги сохранятся.`}
      </ConfirmDialog>

      {showInvoice && (
        <Card className="mb-4">
          <div className="mb-3 text-[14px] font-semibold">Новая накладная (черновик, несколько строк)</div>
          {!suppliers.data?.suppliers.length && (
            <p className="mb-2 text-sm text-warn">Сначала создайте поставщика.</p>
          )}
          {!items.data?.items.length && (
            <p className="mb-2 text-sm text-warn">Сначала добавьте позиции на складе.</p>
          )}
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <Field label="Поставщик">
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">—</option>
                {(suppliers.data?.suppliers ?? []).filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Номер">
              <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="опционально" />
            </Field>
          </div>
          <div className="mb-2 text-[12px] font-medium text-ink-secondary">Строки · единица склада и «Годен до» на каждой</div>
          <div className="space-y-3">
            {lines.map((line, idx) => (
              <div key={line.key} className="grid gap-2 rounded-xl border border-line bg-surface-2/50 p-3 sm:grid-cols-5">
                <Field label={idx === 0 ? 'Позиция' : '\u00a0'}>
                  <Select
                    value={line.stockItemId}
                    onChange={(e) => setLines((all) => all.map((x) => x.key === line.key ? { ...x, stockItemId: e.target.value } : x))}
                  >
                    <option value="">—</option>
                    {(items.data?.items ?? []).map((it) => (
                      <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={
                    idx === 0
                      ? `Кол-во${lineUnit(line.stockItemId) ? `, ${lineUnit(line.stockItemId)}` : ''}`
                      : '\u00a0'
                  }
                >
                  <Input
                    type="number" min={0} step="any" value={line.qty}
                    onChange={(e) => setLines((all) => all.map((x) => x.key === line.key ? { ...x, qty: e.target.value } : x))}
                  />
                </Field>
                <Field label={idx === 0 ? 'Цена, ₽' : '\u00a0'}>
                  <Input
                    type="number" min={0} step="any" value={line.costRub}
                    onChange={(e) => setLines((all) => all.map((x) => x.key === line.key ? { ...x, costRub: e.target.value } : x))}
                  />
                </Field>
                <Field label={idx === 0 ? 'Годен до' : '\u00a0'}>
                  <Input
                    type="date" value={line.expiresDate}
                    onChange={(e) => setLines((all) => all.map((x) => x.key === line.key ? { ...x, expiresDate: e.target.value } : x))}
                  />
                </Field>
                <div className="flex items-end">
                  <Button
                    size="sm" variant="ghost"
                    disabled={lines.length <= 1}
                    onClick={() => setLines((all) => all.filter((x) => x.key !== line.key))}
                  >
                    Удалить
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 text-[13px] font-semibold text-ink-secondary hover:text-ink"
            onClick={() => setLines((all) => [...all, emptyLine()])}
          >
            + Ещё строка
          </button>
          <div className="mt-3 flex gap-2">
            <Button loading={busy} onClick={createInvoice} disabled={!supplierId}>Создать черновик</Button>
            <Button variant="ghost" onClick={() => setShowInvoice(false)}>Отмена</Button>
          </div>
        </Card>
      )}

      <Tabs items={tabs} value={tab} onChange={setTab} />

      {tab === 'invoices' && (
        <Card pad={false}>
          {invoices.loading && <div className="p-4"><Skeleton className="h-24" /></div>}
          {invoices.error && <div className="p-4"><ErrorBox message={invoices.error} /></div>}
          {invoices.data && !invoices.data.invoices.length && (
            <EmptyState
              title="Накладных пока нет"
              text="Черновик не двигает остаток. После «Провести» создаётся партия и приход на склад; появляется долг поставщику."
              action={<Button size="sm" onClick={() => setShowInvoice(true)}>Новая накладная</Button>}
            />
          )}
          {!!invoices.data?.invoices.length && (
            <div className="admin-scroll-x">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-ink-tertiary">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">№</th>
                    <th className="px-4 py-2.5 font-semibold">Поставщик</th>
                    <th className="px-4 py-2.5 font-semibold">Статус</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Сумма</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Оплачено</th>
                    <th className="px-4 py-2.5 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.data.invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-line/70 last:border-0">
                      <td className="px-4 py-2.5 font-mono">{inv.number || inv.id}</td>
                      <td className="px-4 py-2.5 font-medium">{inv.supplierName}</td>
                      <td className="px-4 py-2.5">{statusBadge(inv.status)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{money(inv.totalKop)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{money(inv.paidKop)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {inv.status === 'draft' && (
                          <Button size="sm" variant="secondary" loading={busy} onClick={() => postInvoice(inv.id)}>
                            Провести
                          </Button>
                        )}
                        {inv.status === 'posted' && inv.paidKop < inv.totalKop && (
                          <Button size="sm" variant="secondary" loading={busy} onClick={() => payInvoice(inv)}>
                            Оплатить долг
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'suppliers' && (
        <Card pad={false}>
          {suppliers.loading && <div className="p-4"><Skeleton className="h-24" /></div>}
          {suppliers.error && <div className="p-4"><ErrorBox message={suppliers.error} /></div>}
          {suppliers.data && !suppliers.data.suppliers.length && (
            <EmptyState title="Нет поставщиков" text="Справочник, не свободный текст. Создайте контрагента перед накладной." />
          )}
          {!!suppliers.data?.suppliers.length && (
            <ul className="divide-y divide-line">
              {suppliers.data.suppliers.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-[12px] text-ink-secondary">{s.contact || s.inn || '—'}</div>
                    {!s.active && <div className="text-[11px] text-ink-tertiary">{deactivatedHint()}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={entityStatusLabel(s.active).tone}>{entityStatusLabel(s.active).label}</Badge>
                    <Button size="sm" variant="secondary" aria-label={`Изменить поставщика ${s.name}`} onClick={() => openSupplier(s)}>
                      Изменить
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={`Удалить поставщика ${s.name}`} onClick={() => setSDel(s)}>
                      Удалить
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'orders' && (
        <OrdersTab
          suppliers={suppliers.data?.suppliers ?? []}
          items={items.data?.items ?? []}
          onInvoiceCreated={() => { invoices.reload(); debt.reload() }}
        />
      )}
      {tab === 'returns' && <ReturnsTab suppliers={suppliers.data?.suppliers ?? []} items={items.data?.items ?? []} />}
      {tab === 'bank' && <BankTab onPaid={reloadAll} />}
      {tab === 'recon' && <ReconTab suppliers={suppliers.data?.suppliers ?? []} />}

      {tab === 'debt' && (
        <Card pad={false}>
          {!!debt.data?.debts.length && (
            <div className="flex justify-end border-b border-line px-4 py-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  downloadCsv(
                    csvName('debt'),
                    ['Поставщик', 'Долг, ₽', 'Открытых накладных'],
                    (debt.data?.debts ?? []).map((d) => [d.supplierName, (d.debtKop / 100).toFixed(2).replace('.', ','), d.openInvoices]),
                  )
                }
              >
                CSV
              </button>
            </div>
          )}
          {debt.loading && <div className="p-4"><Skeleton className="h-24" /></div>}
          {debt.error && <div className="p-4"><ErrorBox message={debt.error} /></div>}
          {debt.data && !debt.data.debts.length && (
            <EmptyState title="Долгов нет" text="Формула: сумма проведённых накладных − оплаты с привязкой к накладным." />
          )}
          {!!debt.data?.debts.length && (
            <ul className="divide-y divide-line">
              {debt.data.debts.map((d) => (
                <li key={d.supplierId} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="font-medium">{d.supplierName}</div>
                    <div className="text-[12px] text-ink-secondary">открытых накладных: {d.openInvoices}</div>
                  </div>
                  <div className="font-mono text-[15px] font-semibold text-warn">{money(d.debtKop)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </section>
  )
}
