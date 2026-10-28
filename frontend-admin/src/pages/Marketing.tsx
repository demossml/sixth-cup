import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import PromoMediaField, { mediaUrlError } from './marketing/PromoMediaField'
import { useApi } from '../api/useApi'
import type { VoucherTemplate } from '../api/types'
import { fmtDate, fmtNum } from '../lib/format'
import { createBody, draftError, draftFrom, emptyDraft, patchBody, type TemplateDraft } from '../lib/voucherTemplates'
import { Badge, Banner, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Spinner, Tabs, Toggle, useToast } from '../ui/kit'

type PromoRow = {
  id: number
  title: string
  body: string
  sponsor?: string | null
  startsAt: number
  endsAt: number
  imageUrl?: string | null
  mediaType?: 'image' | 'video'
  placement?: string
  status?: string
  sortOrder?: number
  ctaLabel?: string | null
  badge?: string | null
  kind?: string
  productId?: number | null
}

const PLACEMENT_LABEL: Record<string, string> = {
  home_hero: 'Фон шапки: логотип и чашки над QR',
  home_feature: 'Карточка под QR',
  home: 'Карточка под QR (старый формат)',
  menu: 'Меню (старый формат)',
  both: 'Старый формат: главная + меню',
}

function Promos() {
  const { data, error, loading, reload } = useApi<{ promos: PromoRow[] }>('/promos')
  const toast = useToast()
  const empty = {
    title: '',
    body: '',
    sponsor: '',
    days: 14,
    imageUrl: '',
    mediaType: 'image' as 'image' | 'video',
    placement: 'home_feature' as string,
    status: 'draft' as string,
    sortOrder: 0,
    ctaLabel: 'Смотреть в меню',
    badge: '' as string,
    kind: 'promo' as string,
    productId: '' as string,
  }
  const [edit, setEdit] = useState<(typeof empty & { id?: number }) | null>(null)
  const [del, setDel] = useState<PromoRow | null>(null)
  const now = Math.floor(Date.now() / 1000)
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast.push(ok)
      reload()
      return true
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
      return false
    }
  }
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button icon={<Plus size={16} />} onClick={() => setEdit({ ...empty })}>
          Новинка / баннер
        </Button>
        <p className="text-xs text-ink-secondary">
          Published → на главной PWA после sync directory. Draft не виден гостю.
        </p>
      </div>
      {!data?.promos.length ? (
        <Card>
          <EmptyState
            title="Контента нет"
            text="Выберите одно из двух мест: фон шапки с логотипом и чашками над QR или отдельная карточка под QR. Верхняя публикация заменяет только фон шапки и не добавляет блок над ней."
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {data.promos.map((p) => {
            const active = (p.status ?? 'published') === 'published' && p.startsAt <= now && p.endsAt >= now
            return (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex gap-3">
                    {p.imageUrl ? (
                      p.mediaType === 'video' ? <video src={p.imageUrl} muted playsInline className="w-16 h-16 rounded-xl object-cover shrink-0 bg-surface-secondary" /> : <img src={p.imageUrl} alt="" className="w-16 h-16 rounded-xl object-cover shrink-0 bg-surface-secondary" />
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-surface-secondary shrink-0 flex items-center justify-center text-xs text-ink-tertiary">
                        нет фото
                      </div>
                    )}
                    <div>
                      <div className="font-semibold">{p.title}</div>
                      <div className="text-sm text-ink-secondary line-clamp-2">{p.body}</div>
                      <div className="mt-1 text-xs text-ink-secondary">
                        {PLACEMENT_LABEL[p.placement || 'home'] || p.placement || 'home'} · {p.status || 'published'} ·
                        sort {p.sortOrder ?? 0} · до {fmtDate(p.endsAt * 1000)}
                        {p.productId ? ` · product #${p.productId}` : ''}
                      </div>
                    </div>
                  </div>
                  <Badge tone={active ? 'ok' : 'neutral'}>{active ? 'В PWA' : p.status || '—'}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setEdit({
                        id: p.id,
                        title: p.title,
                        body: p.body,
                        sponsor: p.sponsor ?? '',
                        days: Math.max(1, Math.ceil((p.endsAt - now) / 86400)),
                        imageUrl: p.imageUrl ?? '',
                        mediaType: p.mediaType || 'image',
                        placement: p.placement || 'home',
                        status: (p.status as string) || 'draft',
                        sortOrder: p.sortOrder ?? 0,
                        ctaLabel: p.ctaLabel ?? '',
                        badge: p.badge ?? '',
                        kind: (p.kind as string) || 'promo',
                        productId: p.productId != null ? String(p.productId) : '',
                      })
                    }
                  >
                    Изменить
                  </Button>
                  {(p.status ?? '') !== 'published' && (
                    <Button size="sm" onClick={() => act(() => api(`/promos/${p.id}/publish`, { method: 'POST' }), 'Опубликовано')}>
                      Опубликовать
                    </Button>
                  )}
                  {(p.status ?? '') === 'published' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => act(() => api(`/promos/${p.id}/unpublish`, { method: 'POST' }), 'Снято с публикации')}
                    >
                      Снять
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setDel(p)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Редактировать' : 'Новый контент'}>
        {edit && (
          <div className="space-y-3">
            <Banner tone="brand">
              <b>Требования к медиа 6.7 Coffee</b><br />
              Фото: JPG/WebP, до 2 МБ, ширина 1200–1600 px; для фона шапки лучше 16:9, изображение будет кадрироваться под экран. Для карточки под QR — 4:3 или 16:9. PNG используйте для графики с прозрачностью.<br />
              Видео: MP4 (H.264) или WebM, до 20 МБ, 5–15 секунд, 720p/1080p, вертикальное 9:16 или горизонтальное 16:9. Автоповтор без звука.
            </Banner>
            <Field label="Заголовок" hint="Необязательно. Пусто — баннер покажет только фото и подпись кнопки.">
              <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Можно оставить пустым" />
            </Field>
            <Field label="Текст">
              <Input value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
            </Field>
            <Field label="Тип медиа" hint="Фото или короткий ролик. Видео запускается без звука и по кругу.">
              <Select value={edit.mediaType} onChange={(e) => setEdit({ ...edit, mediaType: e.target.value as 'image' | 'video' })}>
                <option value="image">Фотография</option>
                <option value="video">Короткое видео</option>
              </Select>
            </Field>
            <PromoMediaField
              value={edit.imageUrl}
              mediaType={edit.mediaType}
              onChange={(patch) => setEdit((prev) => (prev ? { ...prev, ...patch } : prev))}
            />
            <Field label="Куда показать (placement)">
              <Select value={edit.placement} onChange={(e) => setEdit({ ...edit, placement: e.target.value })}>
                <option value="home_hero">Фон шапки с логотипом и чашками (над QR)</option>
                <option value="home_feature">Карточка под QR на главной</option>
              </Select>
            </Field>
            <Field label="Статус">
              <Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                <option value="draft">Черновик (не в PWA)</option>
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
            <Field label="CTA">
              <Input value={edit.ctaLabel} onChange={(e) => setEdit({ ...edit, ctaLabel: e.target.value })} />
            </Field>
            <Field label="Порядок (sortOrder, больше = выше)">
              <Input
                type="number"
                value={edit.sortOrder}
                onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label="ID товара (опционально, для перехода)">
              <Input
                type="number"
                value={edit.productId}
                onChange={(e) => setEdit({ ...edit, productId: e.target.value })}
                placeholder="пусто = /menu"
              />
            </Field>
            <Field label="Дней действия">
              <Input
                type="number"
                value={edit.days}
                onChange={(e) => setEdit({ ...edit, days: Number(e.target.value) || 14 })}
              />
            </Field>
            <Button
              disabled={Boolean(edit && mediaUrlError(edit.imageUrl, edit.mediaType))}
              onClick={() =>
                act(async () => {
                  const body = {
                    title: edit.title,
                    body: edit.body,
                    days: edit.days,
                    imageUrl: edit.imageUrl || null,
                    mediaType: edit.mediaType,
                    placement: edit.placement,
                    status: edit.status,
                    sortOrder: edit.sortOrder,
                    ctaLabel: edit.ctaLabel || null,
                    badge: edit.badge || null,
                    kind: edit.kind,
                    productId: edit.productId !== '' ? Number(edit.productId) : null,
                  }
                  if (edit.id) await api(`/promos/${edit.id}`, { method: 'PATCH', body })
                  else await api('/promos', { method: 'POST', body })
                  setEdit(null)
                }, 'Сохранено')
              }
            >
              Сохранить
            </Button>
          </div>
        )}
      </Drawer>
      <ConfirmDialog
        open={!!del}
        danger
        title="Удалить?"
        onCancel={() => setDel(null)}
        onConfirm={() =>
          act(async () => {
            await api(`/promos/${del!.id}`, { method: 'DELETE' })
            setDel(null)
          }, 'Удалено')
        }
      >
        «{del?.title}» будет удалена.
      </ConfirmDialog>
    </>
  )
}

function Vouchers() {
  const { data, error, loading, reload } = useApi<{ templates: VoucherTemplate[] }>('/voucher-templates?all=1')
  const toast = useToast()
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<{ template: VoucherTemplate; users: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<TemplateDraft | null>(null)
  const [saving, setSaving] = useState(false)
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} />
  const activeTpl = (data?.templates ?? []).filter((t) => t.active !== false)
  const draftMsg = draft ? draftError(draft) : null

  const showPreview = async () => {
    try {
      setPreview(await api(`/vouchers/grant-all/preview?code=${encodeURIComponent(code)}`))
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }
  const grant = async () => {
    setBusy(true)
    try {
      const r = await api<{ granted: number }>('/vouchers/grant-all', { method: 'POST', body: { code } })
      toast.push(`Выдано ваучеров: ${r.granted}`)
      setPreview(null)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    if (!draft || draftMsg) return
    setSaving(true)
    try {
      if (draft.id) await api(`/voucher-templates/${draft.id}`, { method: 'PATCH', body: patchBody(draft) })
      else await api('/voucher-templates', { method: 'POST', body: createBody(draft) })
      toast.push(draft.id ? 'Шаблон обновлён' : 'Шаблон создан')
      setDraft(null)
      reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось сохранить', 'bad')
    } finally {
      setSaving(false)
    }
  }
  const toggleActive = async (t: VoucherTemplate) => {
    try {
      await api(`/voucher-templates/${t.id}`, { method: 'PATCH', body: { active: t.active === false } })
      toast.push(t.active === false ? 'Шаблон включён' : 'Шаблон выключен')
      reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  return (
    <>
      <Card className="mb-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold">Шаблоны ваучеров</h2>
          <Button size="sm" onClick={() => setDraft(emptyDraft())}>
            <Plus size={14} /> Новый шаблон
          </Button>
        </div>
        <p className="mb-2 text-sm text-ink-secondary">
          Ваучер выдаётся из шаблона. Выключенный шаблон не выдаётся и не показывается гостю на кассе.
        </p>
        {!data?.templates.length ? (
          <p className="text-sm text-ink-secondary">Шаблонов нет — создайте первый.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {data.templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.title}</span>
                    <Badge tone={t.active === false ? 'neutral' : 'ok'}>{t.active === false ? 'выключен' : 'активен'}</Badge>
                  </div>
                  <div className="text-ink-secondary">
                    {t.code} · {t.kind === 'percent' ? `${t.value}%` : `${fmtNum(t.value / 100)} ₽`} · дней: {t.validDays}
                    {t.redemptionMode === 'multi' ? ' · многоразовый' : ' · одноразовый'}
                    {t.maxPerDay ? ` · не более ${t.maxPerDay}/день` : ''}
                    {t.maxTotal ? ` · всего ${t.maxTotal}` : ''}
                    {t.stackableWithFreeCup === false ? ' · не с подарком' : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setDraft(draftFrom(t))}>
                    Изменить
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(t)}>
                    {t.active === false ? 'Включить' : 'Выключить'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2 className="mb-2 text-base font-bold">Выдать всем</h2>
        <Banner tone="warn">Массовое действие. Отменить нельзя.</Banner>
        <div className="flex flex-wrap gap-2">
          <Select value={code} onChange={(e) => setCode(e.target.value)} className="!w-auto min-w-[200px] flex-1">
            <option value="">Шаблон…</option>
            {activeTpl.map((t) => (
              <option key={t.code} value={t.code}>
                {t.title}
              </option>
            ))}
          </Select>
          <Button variant="secondary" disabled={!code} onClick={showPreview}>
            Проверить
          </Button>
        </div>
      </Card>
      <Drawer open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Изменить шаблон' : 'Новый шаблон ваучера'}>
        {draft && (
          <div className="space-y-3">
            <Field label="Код" hint={draft.id ? 'Код нельзя изменить — на него ссылаются выдачи.' : 'Латинские буквы и цифры, например SUMMER10.'}>
              <Input
                value={draft.code}
                disabled={Boolean(draft.id)}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                placeholder="SUMMER10"
              />
            </Field>
            <Field label="Название для гостя">
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Скидка 10% на кофе" />
            </Field>
            <Field label="Тип скидки">
              <Select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as 'percent' | 'fixed' })}>
                <option value="percent">Процент</option>
                <option value="fixed">Сумма в копейках</option>
              </Select>
            </Field>
            <Field label={draft.kind === 'percent' ? 'Процент' : 'Сумма, коп.'} hint={draft.kind === 'fixed' ? 'Например 30000 = 300 ₽' : 'Не больше 100'}>
              <Input
                type="number"
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: Number(e.target.value) })}
              />
            </Field>
            <Field label="Срок действия, дней">
              <Input
                type="number"
                value={draft.validDays}
                onChange={(e) => setDraft({ ...draft, validDays: Number(e.target.value) })}
              />
            </Field>
            <Field label="Картинка" hint="Необязательно. /uploads/… или https://…">
              <Input value={draft.imageUrl} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} placeholder="https://…" />
            </Field>
            <Field label="Режим гашения">
              <Select
                value={draft.redemptionMode}
                onChange={(e) => setDraft({ ...draft, redemptionMode: e.target.value as 'once' | 'multi' })}
              >
                <option value="once">Одноразовый</option>
                <option value="multi">Многоразовый</option>
              </Select>
            </Field>
            {draft.redemptionMode === 'multi' && (
              <>
                <Field label="Лимит гашений в сутки" hint="Пусто — без ограничения.">
                  <Input value={draft.maxPerDay} onChange={(e) => setDraft({ ...draft, maxPerDay: e.target.value })} placeholder="1" />
                </Field>
                <Field label="Общий лимит гашений" hint="Пусто — без ограничения.">
                  <Input value={draft.maxTotal} onChange={(e) => setDraft({ ...draft, maxTotal: e.target.value })} placeholder="10" />
                </Field>
              </>
            )}
            <Toggle
              checked={draft.stackableWithFreeCup}
              onChange={(v) => setDraft({ ...draft, stackableWithFreeCup: v })}
              label="Можно применить вместе с подарком (6-я чашка)"
            />
            <Toggle checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} label="Активен — можно выдавать" />
            {draftMsg && <p className="text-sm text-bad">{draftMsg}</p>}
            <div className="flex gap-2">
              <Button onClick={save} loading={saving} disabled={Boolean(draftMsg)}>
                Сохранить
              </Button>
              <Button variant="secondary" onClick={() => setDraft(null)}>
                Отмена
              </Button>
            </div>
          </div>
        )}
      </Drawer>
      <ConfirmDialog
        open={!!preview}
        danger
        typed="выдать"
        confirmLabel="Выдать всем"
        busy={busy}
        title="Выдать всем?"
        onCancel={() => setPreview(null)}
        onConfirm={grant}
      >
        Получат: <b>{fmtNum(preview?.users)}</b>
      </ConfirmDialog>
    </>
  )
}

export default function Marketing() {
  const [tab, setTab] = useState<'promos' | 'vouchers'>('promos')
  return (
    <>
      <PageHeader title="Маркетинг" />
      <Tabs
        items={[
          { key: 'promos', label: 'Контент PWA' },
          { key: 'vouchers', label: 'Ваучеры' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'promos' ? <Promos /> : <Vouchers />}
    </>
  )
}
