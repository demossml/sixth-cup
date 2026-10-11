import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import type { Promo, VoucherTemplate } from '../api/types'
import { fmtDate, fmtNum } from '../lib/format'
import { Badge, Banner, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Spinner, Tabs, useToast } from '../ui/kit'

type PromoRow = Omit<Promo, 'starts_at' | 'ends_at'> & { startsAt: number; endsAt: number }

function Promos() {
  const { data, error, loading, reload } = useApi<{ promos: PromoRow[] }>('/promos')
  const toast = useToast()
  const [edit, setEdit] = useState<{ id?: number; title: string; body: string; sponsor: string; days: number } | null>(null)
  const [del, setDel] = useState<PromoRow | null>(null)
  const now = Math.floor(Date.now() / 1000)
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.push(ok); reload(); return true } catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad'); return false }
  }
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  return (
    <>
      <div className="mb-3"><Button icon={<Plus size={16} />} onClick={() => setEdit({ title: '', body: '', sponsor: '', days: 7 })}>Новая акция</Button></div>
      {!data?.promos.length ? <Card><EmptyState title="Акций нет" text="Акции показываются клиентам в приложении." /></Card> : (
        <div className="space-y-2">
          {data.promos.map((p) => {
            const active = p.startsAt <= now && p.endsAt >= now
            return (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="font-semibold">{p.title}</div><div className="text-sm text-ink-secondary">{p.body}</div>
                    <div className="mt-1 text-xs text-ink-secondary">до {fmtDate(p.endsAt * 1000)}{p.sponsor ? ` · ${p.sponsor}` : ''}</div></div>
                  <Badge tone={active ? 'ok' : 'neutral'}>{active ? 'Идёт' : p.endsAt < now ? 'Закончилась' : 'Ещё не началась'}</Badge>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEdit({ id: p.id, title: p.title, body: p.body, sponsor: p.sponsor ?? '', days: Math.max(1, Math.ceil((p.endsAt - now) / 86400)) })}>Изменить</Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`Удалить ${p.title}`} onClick={() => setDel(p)} />
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Акция' : 'Новая акция'}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Отмена</Button><Button disabled={!edit?.title.trim()} onClick={async () => {
          if (!edit) return
          const body = { title: edit.title.trim(), body: edit.body, sponsor: edit.sponsor.trim() || undefined, days: Math.min(365, Math.max(1, Math.round(edit.days) || 1)) }
          if (await act(() => (edit.id ? api(`/promos/${edit.id}`, { method: 'PATCH', body: { ...body, sponsor: edit.sponsor.trim() || null } }) : api('/promos', { method: 'POST', body })), 'Акция сохранена')) setEdit(null)
        }}>Сохранить</Button></>}>
        <Field label="Заголовок"><Input value={edit?.title ?? ''} maxLength={80} onChange={(e) => edit && setEdit({ ...edit, title: e.target.value })} /></Field>
        <Field label="Текст"><Input value={edit?.body ?? ''} maxLength={300} onChange={(e) => edit && setEdit({ ...edit, body: e.target.value })} /></Field>
        <Field label="Спонсор (необязательно)"><Input value={edit?.sponsor ?? ''} maxLength={80} onChange={(e) => edit && setEdit({ ...edit, sponsor: e.target.value })} /></Field>
        <Field label="Сколько дней показывать" hint="Считается с сегодняшнего дня"><Input type="number" min={1} max={365} value={edit?.days ?? 7} onChange={(e) => edit && setEdit({ ...edit, days: Number(e.target.value) })} /></Field>
      </Drawer>
      <ConfirmDialog open={!!del} title="Удалить акцию?" danger confirmLabel="Удалить" onCancel={() => setDel(null)}
        onConfirm={async () => { if (del) await act(() => api(`/promos/${del.id}`, { method: 'DELETE' }), 'Акция удалена'); setDel(null) }}>«{del?.title}» пропадёт из приложения.</ConfirmDialog>
    </>
  )
}

function Vouchers() {
  const { data, error, loading, reload } = useApi<{ templates: VoucherTemplate[] }>('/voucher-templates')
  const toast = useToast()
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<{ template: VoucherTemplate; users: number } | null>(null)
  const [busy, setBusy] = useState(false)
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  const showPreview = async () => {
    try { setPreview(await api(`/vouchers/grant-all/preview?code=${encodeURIComponent(code)}`)) } catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad') }
  }
  const grant = async () => {
    setBusy(true)
    try { const r = await api<{ granted: number }>('/vouchers/grant-all', { method: 'POST', body: { code } }); toast.push(`Выдано ваучеров: ${r.granted}`); setPreview(null) }
    catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad') } finally { setBusy(false) }
  }
  return (
    <>
      <Card className="mb-4"><h2 className="mb-2 text-base font-bold">Шаблоны ваучеров</h2>
        {!data?.templates.length ? <p className="text-sm text-ink-secondary">Шаблонов нет</p> : (
          <ul className="divide-y divide-line text-sm">{data.templates.map((t) => <li key={t.id} className="flex justify-between gap-2 py-2"><span>{t.title}</span><span className="text-ink-secondary">действует дней: {t.validDays}</span></li>)}</ul>
        )}
        <p className="mt-2 text-xs text-ink-secondary">Выдать ваучер одному клиенту можно в его карточке.</p>
      </Card>
      <Card>
        <h2 className="mb-2 text-base font-bold">Выдать всем клиентам</h2>
        <Banner tone="warn">Массовое действие: ваучер получит каждый зарегистрированный клиент. Отменить нельзя.</Banner>
        <div className="flex flex-wrap gap-2">
          <Select value={code} onChange={(e) => setCode(e.target.value)} aria-label="Шаблон" className="!w-auto min-w-[200px] flex-1"><option value="">Выберите ваучер…</option>{(data?.templates ?? []).map((t) => <option key={t.code} value={t.code}>{t.title}</option>)}</Select>
          <Button variant="secondary" disabled={!code} onClick={showPreview}>Проверить, кому достанется</Button>
        </div>
      </Card>
      <ConfirmDialog open={!!preview} danger typed="выдать" confirmLabel="Выдать всем" busy={busy} title="Выдать ваучер всем?" onCancel={() => setPreview(null)} onConfirm={grant}>
        «{preview?.template.title}» получат клиенты: <b>{fmtNum(preview?.users)}</b>.
      </ConfirmDialog>
    </>
  )
}

export default function Marketing() {
  const [tab, setTab] = useState<'promos' | 'vouchers'>('promos')
  return (
    <>
      <PageHeader title="Маркетинг" subtitle="Акции в приложении и ваучеры" />
      <Tabs items={[{ key: 'promos', label: 'Акции' }, { key: 'vouchers', label: 'Ваучеры' }]} value={tab} onChange={setTab} />
      {tab === 'promos' ? <Promos /> : <Vouchers />}
    </>
  )
}
