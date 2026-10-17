import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api, uploadFile } from '../api/client'
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
  const [uploading, setUploading] = useState(false)
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
            <Field label="Заголовок">
              <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </Field>
            <Field label="Текст">
              <Input value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
            </Field>
            <Field label="URL фото" hint="Или загрузите файл ниже">
              <Input
                value={edit.imageUrl}
                onChange={(e) => setEdit({ ...edit, imageUrl: e.target.value })}
                placeholder="/uploads/… или https://…"
              />
            </Field>
            {edit.imageUrl ? (
              edit.mediaType === 'video' ? <video src={edit.imageUrl} controls muted playsInline className="w-full max-h-48 rounded-xl bg-surface-secondary" /> : <img src={edit.imageUrl} alt="" className="w-full max-h-40 object-cover rounded-xl bg-surface-secondary" />
            ) : null}
            <Field label="Тип медиа" hint="Фото или короткий ролик. Видео запускается без звука и по кругу.">
              <Select value={edit.mediaType} onChange={(e) => setEdit({ ...edit, mediaType: e.target.value as 'image' | 'video' })}>
                <option value="image">Фотография</option>
                <option value="video">Короткое видео</option>
              </Select>
            </Field>
            <Field label={edit.mediaType === 'video' ? 'URL видео' : 'URL фото'} hint="Можно вставить публичный URL или загрузить файл ниже">
              <Input value={edit.imageUrl} onChange={(e) => setEdit({ ...edit, imageUrl: e.target.value })} placeholder="/uploads/… или https://…" />
            </Field>
            <Field label={edit.mediaType === 'video' ? 'Загрузить видео' : 'Загрузить фото'}>
              <input
                type="file"
                accept={edit.mediaType === 'video' ? "video/mp4,video/webm" : "image/jpeg,image/png,image/webp"}
                className="block w-full text-sm"
                disabled={uploading}
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  setUploading(true)
                  try {
                    const j = await uploadFile(f)
                    setEdit((prev) => (prev ? { ...prev, imageUrl: j.url, mediaType: f.type.startsWith('video/') ? 'video' : 'image' } : prev))
                    toast.push(f.type.startsWith('video/') ? 'Видео загружено' : 'Фото загружено')
                  } catch (err) {
                    toast.push(err instanceof Error ? err.message : 'Ошибка загрузки', 'bad')
                  } finally {
                    setUploading(false)
                    e.target.value = ''
                  }
                }}
              />
            </Field>
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
              disabled={uploading || !edit.title.trim()}
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
  const { data, error, loading } = useApi<{ templates: VoucherTemplate[] }>('/vouchers/templates')
  const toast = useToast()
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<{ template: VoucherTemplate; users: number } | null>(null)
  const [busy, setBusy] = useState(false)
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} />
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
  return (
    <>
      <Card className="mb-4">
        <h2 className="mb-2 text-base font-bold">Шаблоны ваучеров</h2>
        {!data?.templates.length ? (
          <p className="text-sm text-ink-secondary">Шаблонов нет</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {data.templates.map((t) => (
              <li key={t.id} className="flex justify-between gap-2 py-2">
                <span>{t.title}</span>
                <span className="text-ink-secondary">дней: {t.validDays}</span>
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
            {(data?.templates ?? []).map((t) => (
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
