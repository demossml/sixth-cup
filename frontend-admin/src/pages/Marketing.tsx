import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import type { VoucherTemplate } from '../api/types'
import { fmtDate, fmtNum } from '../lib/format'
import { Badge, Banner, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Spinner, Tabs, useToast } from '../ui/kit'

type PromoRow = {
  id: number
  title: string
  body: string
  sponsor?: string | null
  startsAt: number
  endsAt: number
  imageUrl?: string | null
  placement?: string
  status?: string
  sortOrder?: number
  ctaLabel?: string | null
  badge?: string | null
  kind?: string
}

function Promos() {
  const { data, error, loading, reload } = useApi<{ promos: PromoRow[] }>('/promos')
  const toast = useToast()
  const empty = {
    title: '', body: '', sponsor: '', days: 14, imageUrl: '', placement: 'home' as const,
    status: 'draft' as const, sortOrder: 0, ctaLabel: 'Смотреть в меню', badge: '' as string, kind: 'promo' as const,
  }
  const [edit, setEdit] = useState<(typeof empty & { id?: number }) | null>(null)
  const [del, setDel] = useState<PromoRow | null>(null)
  const now = Math.floor(Date.now() / 1000)
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.push(ok); reload(); return true } catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad'); return false }
  }
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  return (
    <>
      <div className="mb-3">
        <Button icon={<Plus size={16} />} onClick={() => setEdit({ ...empty })}>Новинка / акция</Button>
      </div>
      {!data?.promos.length ? (
        <Card><EmptyState title="Контента нет" text="Опубликованные карточки появятся на главной и в меню клиента без деплоя." /></Card>
      ) : (
        <div className="space-y-2">
          {data.promos.map((p) => {
            const active = (p.status ?? 'published') === 'published' && p.startsAt <= now && p.endsAt >= now
            return (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex gap-3">
                    {p.imageUrl ? <img src={p.imageUrl} alt="" className="w-16 h-16 rounded-xl object-cover shrink-0" /> : null}
                    <div>
                      <div className="font-semibold">{p.title}</div>
                      <div className="text-sm text-ink-secondary line-clamp-2">{p.body}</div>
                      <div className="mt-1 text-xs text-ink-secondary">
                        {p.placement || 'home'} · {p.status || 'published'} · до {fmtDate(p.endsAt * 1000)}
                      </div>
                    </div>
                  </div>
                  <Badge tone={active ? 'ok' : 'neutral'}>{active ? 'В PWA' : p.status || '—'}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEdit({
                    id: p.id, title: p.title, body: p.body, sponsor: p.sponsor ?? '', days: Math.max(1, Math.ceil((p.endsAt - now) / 86400)),
                    imageUrl: p.imageUrl ?? '', placement: (p.placement as 'home') || 'home', status: (p.status as 'draft') || 'draft',
                    sortOrder: p.sortOrder ?? 0, ctaLabel: p.ctaLabel ?? '', badge: p.badge ?? '', kind: (p.kind as 'promo') || 'promo',
                  })}>Изменить</Button>
                  {(p.status ?? '') !== 'published' && (
                    <Button size="sm" onClick={() => act(() => api(`/promos/${p.id}/publish`, { method: 'POST' }), 'Опубликовано')}>Опубликовать</Button>
                  )}
                  {(p.status ?? '') === 'published' && (
                    <Button size="sm" variant="secondary" onClick={() => act(() => api(`/promos/${p.id}/unpublish`, { method: 'POST' }), 'Снято с публикации')}>Снять</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setDel(p)}><Trash2 size={14} /></Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Редактировать' : 'Новый контент'}>
        {edit && (
          <div className="space-y-3">
            <Field label="Заголовок"><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="Текст"><Input value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
            <Field label="URL фото"><Input value={edit.imageUrl} onChange={(e) => setEdit({ ...edit, imageUrl: e.target.value })} placeholder="/uploads/… или https://…" /></Field>
            <Field label="Placement">
              <Select value={edit.placement} onChange={(e) => setEdit({ ...edit, placement: e.target.value as 'home' })}>
                <option value="home">Главная</option>
                <option value="menu">Меню</option>
                <option value="both">Оба</option>
              </Select>
            </Field>
            <Field label="Статус">
              <Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as 'draft' })}>
                <option value="draft">Черновик</option>
                <option value="published">Опубликовано</option>
                <option value="archived">Архив</option>
              </Select>
            </Field>
            <Field label="Бейдж">
              <Select value={edit.badge} onChange={(e) => setEdit({ ...edit, badge: e.target.value })}>
                <option value="">—</option>
                <option value="new">Новинка</option>
                <option value="hit">Хит</option>
                <option value="seasonal">Сезон</option>
              </Select>
            </Field>
            <Field label="CTA"><Input value={edit.ctaLabel} onChange={(e) => setEdit({ ...edit, ctaLabel: e.target.value })} /></Field>
            <Field label="Дней действия"><Input type="number" value={edit.days} onChange={(e) => setEdit({ ...edit, days: Number(e.target.value) || 14 })} /></Field>
            <Button onClick={() => act(async () => {
              const body = {
                title: edit.title, body: edit.body, days: edit.days,
                imageUrl: edit.imageUrl || null, placement: edit.placement, status: edit.status,
                sortOrder: edit.sortOrder, ctaLabel: edit.ctaLabel || null,
                badge: edit.badge || null, kind: edit.kind,
              }
              if (edit.id) await api(`/promos/${edit.id}`, { method: 'PATCH', body })
              else await api('/promos', { method: 'POST', body })
              setEdit(null)
            }, 'Сохранено')}>Сохранить</Button>
          </div>
        )}
      </Drawer>
      <ConfirmDialog open={!!del} danger title="Удалить?" onCancel={() => setDel(null)} onConfirm={() => act(async () => { await api(`/promos/${del!.id}`, { method: 'DELETE' }); setDel(null) }, 'Удалено')}>
        «{del?.title}» будет удалена.
      </ConfirmDialog>
    </>
  )
}

function Vouchers() {
  const { data, error, loading } = useApi<{ templates: VoucherTemplate[] }>('/vouchers/templates')
  const toast = useToast()
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<{ template: VoucherTemplate; users: number } | null>(null)
  const [busy, setBusy] = useState(false)
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} />
  const showPreview = async () => {
    try { setPreview(await api(`/vouchers/grant-all/preview?code=${encodeURIComponent(code)}`)) } catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad') }
  }
  const grant = async () => {
    setBusy(true)
    try {
      const r = await api<{ granted: number }>('/vouchers/grant-all', { method: 'POST', body: { code } })
      toast.push(`Выдано ваучеров: ${r.granted}`)
      setPreview(null)
    } catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad') } finally { setBusy(false) }
  }
  return (
    <>
      <Card className="mb-4">
        <h2 className="mb-2 text-base font-bold">Шаблоны ваучеров</h2>
        {!data?.templates.length ? <p className="text-sm text-ink-secondary">Шаблонов нет</p> : (
          <ul className="divide-y divide-line text-sm">{data.templates.map((t) => (
            <li key={t.id} className="flex justify-between gap-2 py-2"><span>{t.title}</span><span className="text-ink-secondary">дней: {t.validDays}</span></li>
          ))}</ul>
        )}
      </Card>
      <Card>
        <h2 className="mb-2 text-base font-bold">Выдать всем</h2>
        <Banner tone="warn">Массовое действие. Отменить нельзя.</Banner>
        <div className="flex flex-wrap gap-2">
          <Select value={code} onChange={(e) => setCode(e.target.value)} className="!w-auto min-w-[200px] flex-1">
            <option value="">Шаблон…</option>
            {(data?.templates ?? []).map((t) => <option key={t.code} value={t.code}>{t.title}</option>)}
          </Select>
          <Button variant="secondary" disabled={!code} onClick={showPreview}>Проверить</Button>
        </div>
      </Card>
      <ConfirmDialog open={!!preview} danger typed="выдать" confirmLabel="Выдать всем" busy={busy} title="Выдать всем?" onCancel={() => setPreview(null)} onConfirm={grant}>
        Получат: <b>{fmtNum(preview?.users)}</b>
      </ConfirmDialog>
    </>
  )
}

export default function Marketing() {
  const [tab, setTab] = useState<'promos' | 'vouchers'>('promos')
  return (
    <>
      <PageHeader title="Контент и маркетинг" subtitle="Новинки в PWA без деплоя · ваучеры" />
      <Tabs items={[{ key: 'promos', label: 'Контент PWA' }, { key: 'vouchers', label: 'Ваучеры' }]} value={tab} onChange={setTab} />
      {tab === 'promos' ? <Promos /> : <Vouchers />}
    </>
  )
}
