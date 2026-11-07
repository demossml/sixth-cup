import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { qs } from '../lib/query'
import { fmtNum } from '../lib/format'
import { banText, banUntilText, etaLabel, nextActions, statusLabel, statusTone } from '../lib/preorder'
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, Input, KpiTile, PageHeader, Select, Spinner, Toggle, useToast } from '../ui/kit'

type Store = { id: number; name: string }
type OrderItem = { name: string; quantity: number; configText: string; unitPrice: number }
type Order = {
  id: string
  shortCode: string
  storeId: number
  status: string
  etaReadyAt: number | null
  etaMinutes: number | null
  paidAt: number | null
  pickedUpAt: number | null
  estimateTotal: number
  cardId: string | null
  guestUserId: number | null
  minutesAgo: number
  items: OrderItem[]
}
type OrdersResponse = { ok: boolean; now: number; orders: Order[] }
type SettingsResponse = { storeId: number | null; own: boolean; prepMinutes: number; noShowBanHours: number; pickupGraceMinutes: number; autoReady: boolean }
type Ban = { userId: number; until: number; reason: string; orderId: string | null; createdAt: number }

/**
 * «Предзаказы»: страховка на время, пока касса не двигает статусы сама.
 * Те же переходы, что у терминала (draft→accepted→cooking→ready), плюс настройки точки.
 */
export default function Preorders() {
  const toast = useToast()
  const storesApi = useApi<{ stores: Store[] }>('/stores')
  const stores = storesApi.data?.stores ?? []
  const [storeIdRaw, setStoreIdRaw] = useState<string>('')
  const storeId = storeIdRaw ? Number(storeIdRaw) : stores[0]?.id ?? null

  const ordersApi = useApi<OrdersResponse>(storeId ? `/preorder/orders${qs({ storeId })}` : null, { refreshMs: 10_000 })
  const settingsApi = useApi<SettingsResponse>(storeId ? `/preorder/settings${qs({ storeId })}` : null)
  const bansApi = useApi<{ ok: boolean; bans: Ban[] }>('/preorder/bans', { refreshMs: 30_000 })

  const [reject, setReject] = useState<Order | null>(null)
  const [lift, setLift] = useState<Ban | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState<SettingsResponse | null>(null)

  const settings = form ?? settingsApi.data
  const now = ordersApi.data?.now ?? Math.floor(Date.now() / 1000)
  const orders = ordersApi.data?.orders ?? []
  const active = orders.filter((o) => ['draft', 'accepted', 'cooking', 'ready'].includes(o.status))
  const waiting = active.filter((o) => o.status === 'draft').length

  const run = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id)
    try {
      await fn()
      toast.push(ok)
      ordersApi.reload()
      bansApi.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(null)
    }
  }

  const saveSettings = async () => {
    if (!settings) return
    setBusy('settings')
    try {
      await api('/preorder/settings', {
        method: 'PATCH',
        body: {
          storeId,
          prepMinutes: settings.prepMinutes,
          noShowBanHours: settings.noShowBanHours,
          pickupGraceMinutes: settings.pickupGraceMinutes,
          autoReady: settings.autoReady,
        },
      })
      toast.push('Настройки сохранены')
      settingsApi.reload()
      setForm(null)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(null)
    }
  }

  if (storesApi.loading && !stores.length) return <Spinner />
  if (storesApi.error) return <ErrorBox message={storesApi.error} onRetry={storesApi.reload} />

  return (
    <>
      <PageHeader
        title="Предзаказы"
        subtitle="Заказы из приложения гостя: принять, отметить готовность, оплатить. Статусы те же, что на кассе."
        actions={
          <Select value={storeIdRaw || String(storeId ?? '')} onChange={(e) => { setStoreIdRaw(e.target.value); setForm(null) }} className="!w-auto">
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiTile label="Активных" value={fmtNum(active.length)} />
        <KpiTile label="Ждут подтверждения" value={fmtNum(waiting)} tone={waiting ? 'warn' : undefined} />
        <KpiTile label="Готовы" value={fmtNum(active.filter((o) => o.status === 'ready').length)} />
        <KpiTile label="Заказов всего" value={fmtNum(orders.length)} />
      </div>

      {ordersApi.error && <ErrorBox message={ordersApi.error} onRetry={ordersApi.reload} />}
      {ordersApi.loading && !ordersApi.data && <Spinner />}

      {!ordersApi.loading && orders.length === 0 && (
        <EmptyState title="Заказов пока нет" text="Как только гость отправит заказ из приложения, он появится здесь." />
      )}

      <div className="space-y-2">
        {orders.map((o) => {
          const actions = nextActions(o.status)
          return (
            <Card key={o.id} className="!mb-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-[18px] font-semibold num">{o.shortCode}</span>
                    <Badge tone={statusTone(o.status)}>{statusLabel(o.status)}</Badge>
                    <span className="text-[12px] text-ink-secondary num">{o.minutesAgo} мин назад</span>
                  </div>
                  <div className="mt-1 text-[12px] leading-4 text-ink-secondary">
                    {o.cardId ? `Карта ${o.cardId}` : 'Без карты'} · оценка <span className="num">{fmtNum(o.estimateTotal)} ₽</span>
                    {' · '}
                    <span className="num">{etaLabel(o.status, o.etaReadyAt, now)}</span>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-[13px] leading-[18px]">
                    {o.items.map((it, i) => (
                      <li key={i} className="text-ink">
                        {it.quantity} × {it.name}
                        {it.configText ? <span className="text-ink-secondary"> · {it.configText}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {actions.map((a) => (
                    <Button
                      key={a.value}
                      size="sm"
                      loading={busy === `${o.id}:${a.value}`}
                      onClick={() => void run(`${o.id}:${a.value}`, () => api(`/preorder/orders/${o.id}/status`, { method: 'POST', body: { status: a.value } }), `Заказ ${o.shortCode}: ${statusLabel(a.value)}`)}
                    >
                      {a.label}
                    </Button>
                  ))}
                  {['accepted', 'cooking', 'ready'].includes(o.status) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy === `${o.id}:paid`}
                      onClick={() => void run(`${o.id}:paid`, () => api(`/preorder/orders/${o.id}/mark-paid`, { method: 'POST' }), `Заказ ${o.shortCode} оплачен`)}
                    >
                      Оплачено
                    </Button>
                  )}
                  {['draft', 'accepted', 'cooking'].includes(o.status) && (
                    <Button size="sm" variant="ghost" onClick={() => setReject(o)}>Отклонить</Button>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <Card className="mt-4">
        <div className="mb-2 text-sm font-semibold">Настройки точки</div>
        {settingsApi.loading && !settings && <Spinner />}
        {settings && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Сколько готовится заказ, мин" hint="База для «готов через N минут». Не меньше суммы рецептов.">
              <Input
                type="number" min={1} max={120}
                value={settings.prepMinutes}
                onChange={(e) => setForm({ ...settings, prepMinutes: Number(e.target.value) })}
              />
            </Field>
            <Field label="Бан за невыкуп, часов" hint="0 — не банить. Гость не сможет заказать, пока срок не истечёт.">
              <Input
                type="number" min={0} max={720}
                value={settings.noShowBanHours}
                onChange={(e) => setForm({ ...settings, noShowBanHours: Number(e.target.value) })}
              />
            </Field>
            <Field label="Запас на выдачу, мин" hint="Сколько ждём после готовности, прежде чем считать «не забрал».">
              <Input
                type="number" min={0} max={720}
                value={settings.pickupGraceMinutes}
                onChange={(e) => setForm({ ...settings, pickupGraceMinutes: Number(e.target.value) })}
              />
            </Field>
            <Field label="Авто-«готов»" hint="Если включено, заказ сам станет «Готов» по ETA. Кассир может подтвердить раньше.">
              <Toggle checked={settings.autoReady} label="Авто-готов по времени" onChange={(v) => setForm({ ...settings, autoReady: v })} />
            </Field>
            <div className="sm:col-span-2">
              <Button loading={busy === 'settings'} disabled={!form} onClick={() => void saveSettings()}>
                Сохранить настройки
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <div className="mb-2 text-sm font-semibold">Баны за невыкуп</div>
        {bansApi.loading && !bansApi.data && <Spinner />}
        {(bansApi.data?.bans ?? []).length === 0 ? (
          <p className="text-[13px] text-ink-secondary">Активных банов нет.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-ink-secondary">
                  <th className="py-1">Клиент</th>
                  <th>До</th>
                  <th>Осталось</th>
                  <th>Заказ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(bansApi.data?.bans ?? []).map((b) => (
                  <tr key={b.userId} className="border-t border-line">
                    <td className="py-1.5 num">#{b.userId}</td>
                    <td className="num">{banUntilText(b.until)}</td>
                    <td className="num">{banText(b.until)}</td>
                    <td className="num text-ink-secondary">{b.orderId ? b.orderId.slice(0, 8) : '—'}</td>
                    <td className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setLift(b)}>Снять</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!reject}
        title="Отклонить заказ?"
        danger
        confirmLabel="Отклонить"
        onCancel={() => setReject(null)}
        onConfirm={() => {
          const o = reject
          setReject(null)
          if (o) void run(`${o.id}:reject`, () => api(`/preorder/orders/${o.id}/reject`, { method: 'POST', body: { reason: 'Отклонён в админке' } }), `Заказ ${o.shortCode} отклонён`)
        }}
      >
        Гость увидит «Заказ отклонён». Оплата не понадобится.
      </ConfirmDialog>

      <ConfirmDialog
        open={!!lift}
        title="Снять бан?"
        confirmLabel="Снять бан"
        onCancel={() => setLift(null)}
        onConfirm={() => {
          const b = lift
          setLift(null)
          if (b) void run(`${b.userId}:lift`, () => api(`/preorder/bans/${b.userId}/lift`, { method: 'POST' }), 'Бан снят')
        }}
      >
        Клиент снова сможет оформить заказ.
      </ConfirmDialog>
    </>
  )
}
