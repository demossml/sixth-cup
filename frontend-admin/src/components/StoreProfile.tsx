import { useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { api, uploadFile } from '../api/client'
import { Button, Field, Input, Select, useToast } from '../ui/kit'
import { fmtCoord, parseCoords } from '../lib/coords'

/**
 * Ориентир по фото: гость ищет точку глазами, а не по координатам.
 * 4:3 — как снимает телефон, без обрезки вывески.
 */
export const STORE_PHOTO_HINT = 'Фото 4:3: фасад с вывеской, днём, до 2 МБ (JPEG/PNG/WebP)'

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export type DayHours = { open: string; close: string } | null

export type LocalStore = {
  id: number
  name: string
  address: string | null
  organizationId: number | null
  openTime?: string | null
  closeTime?: string | null
  lat?: number | null
  lng?: number | null
  /** Часы по дням (Пн…Вс), `null` — выходной. Пусто — общая пара open/close. */
  hoursJson?: string | DayHours[] | null
  photoUrl?: string | null
  photoFullUrl?: string | null
  entranceHint?: string | null
  phone?: string | null
  /** Снимки из Эвотора: что там записано сейчас (для кнопки «Взять из Эвотора»). */
  evotorName?: string | null
  evotorAddress?: string | null
  evotorUuid?: string | null
  evotorCode?: string | null
}

/** Часы по дням из ответа API: строка JSON или уже массив. */
export function weekOf(value: string | DayHours[] | null | undefined): DayHours[] {
  if (Array.isArray(value)) return value.length === 7 ? value : new Array(7).fill(null)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed) && parsed.length === 7) return parsed as DayHours[]
    } catch {
      /* битый JSON — считаем, что часов по дням нет */
    }
  }
  return new Array(7).fill(null)
}

type Props = {
  store: LocalStore
  /** Облачные точки для выбора привязки. */
  linkOptions?: { uuid: string; name: string | null }[]
  onSaved: () => void
}

/**
 * Витрина точки — то, что видит гость: название, адрес, координаты, фото, ориентир, телефон, часы.
 * Название и адрес вводит владелец: «6.7 Coffee на Багратиона» понятнее, чем «Точка 1» из Эвотора.
 */
export default function StoreProfile({ store, linkOptions = [], onSaved }: Props) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [d, setD] = useState<LocalStore>(store)
  const [week, setWeek] = useState<DayHours[] | null>(store.hoursJson ? weekOf(store.hoursJson) : null)
  const [mapLink, setMapLink] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [linkUuid, setLinkUuid] = useState(store.evotorUuid ?? '')

  const set = <K extends keyof LocalStore>(k: K, v: LocalStore[K]) => setD({ ...d, [k]: v })

  const save = async () => {
    if (!d.name.trim()) return setErr('Введите название точки')
    if (!d.address?.trim()) return setErr('Введите адрес — гость ищет точку по нему')
    setBusy('save')
    setErr('')
    try {
      await api(`/stores/${store.id}`, {
        method: 'PATCH',
        body: {
          name: d.name.trim(),
          address: d.address.trim(),
          lat: d.lat ?? null,
          lng: d.lng ?? null,
          hoursJson: week,
          photoUrl: d.photoUrl ?? null,
          photoFullUrl: d.photoFullUrl ?? null,
          entranceHint: d.entranceHint ?? null,
          phone: d.phone ?? null,
        },
      })
      toast.push(`Точка «${d.name.trim()}» сохранена`)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setBusy('')
    }
  }

  const uploadPhoto = async (file: File) => {
    setBusy('photo')
    setErr('')
    try {
      const j = await uploadFile(file)
      setD({ ...d, photoUrl: j.url, photoFullUrl: j.urlFull ?? j.url })
      toast.push('Фото загружено — не забудьте сохранить точку')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setBusy('')
    }
  }

  const saveLink = async () => {
    setBusy('link')
    setErr('')
    try {
      if (!linkUuid) {
        await api(`/stores/${store.id}/link`, { method: 'DELETE' })
        toast.push('Точка отвязана от кассы')
      } else {
        await api(`/stores/${store.id}/link`, { method: 'POST', body: { storeUuid: linkUuid } })
        toast.push('Точка привязана к кассе')
      }
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось изменить привязку')
    } finally {
      setBusy('')
    }
  }

  const gaps = [
    !d.address?.trim() ? 'адрес' : '',
    d.lat == null || d.lng == null ? 'координаты' : '',
    !d.photoUrl ? 'фото' : '',
    !week ? 'часы работы' : '',
  ].filter(Boolean)

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название для гостя" hint="«6.7 Coffee на Багратиона» понятнее, чем название в кассе">
          <div className="flex gap-2">
            <Input value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />
            {store.evotorName && store.evotorName !== d.name ? (
              <Button type="button" size="sm" onClick={() => set('name', store.evotorName ?? '')} title={`В Эвоторе: ${store.evotorName}`}>
                Из Эв.
              </Button>
            ) : null}
          </div>
        </Field>
        <Field label="Адрес для гостя" hint="Улица, дом — как в картах">
          <div className="flex gap-2">
            <Input value={d.address ?? ''} onChange={(e) => set('address', e.target.value)} maxLength={200} />
            {store.evotorAddress && store.evotorAddress !== d.address ? (
              <Button type="button" size="sm" onClick={() => set('address', store.evotorAddress ?? '')} title={`В Эвоторе: ${store.evotorAddress}`}>
                Из Эв.
              </Button>
            ) : null}
          </div>
        </Field>
      </div>

      <Field label="Координаты" hint={d.lat != null && d.lng != null ? `сейчас: ${fmtCoord(d.lat)}, ${fmtCoord(d.lng)}` : 'без них точка на схеме встанет в центр'}>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="number"
            step="0.000001"
            aria-label={`Широта: ${store.name}`}
            placeholder="широта"
            className="max-w-[140px]"
            value={d.lat ?? ''}
            onChange={(e) => set('lat', e.target.value === '' ? null : Number(e.target.value))}
          />
          <Input
            type="number"
            step="0.000001"
            aria-label={`Долгота: ${store.name}`}
            placeholder="долгота"
            className="max-w-[140px]"
            value={d.lng ?? ''}
            onChange={(e) => set('lng', e.target.value === '' ? null : Number(e.target.value))}
          />
          <Input
            value={mapLink}
            onChange={(e) => setMapLink(e.target.value)}
            placeholder="ссылка из Яндекс/Google/Apple карт"
            aria-label={`Ссылка из карты: ${store.name}`}
            className="min-w-[220px] flex-1"
          />
          <Button
            type="button"
            size="sm"
            aria-label={`Заполнить координаты: ${store.name}`}
            onClick={() => {
              const c = parseCoords(mapLink)
              if (!c) {
                toast.push('Не нашёл координаты в ссылке. Скопируйте ссылку на точку или введите числа вручную', 'bad')
                return
              }
              setD({ ...d, lat: c.lat, lng: c.lng })
              toast.push(`Координаты: ${fmtCoord(c.lat)}, ${fmtCoord(c.lng)}`)
            }}
          >
            Заполнить
          </Button>
        </div>
      </Field>

      <Field label="Фото точки" hint={STORE_PHOTO_HINT}>
        <div className="flex items-start gap-3">
          {d.photoUrl ? (
            <img src={d.photoUrl} alt="" className="h-24 w-32 rounded-xl object-cover border border-line bg-surface-secondary" />
          ) : (
            <div className="h-24 w-32 rounded-xl border border-dashed border-line bg-surface-secondary flex items-center justify-center text-[11px] text-ink-tertiary">
              нет фото
            </div>
          )}
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void uploadPhoto(f)
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={busy === 'photo'}
              icon={<ImagePlus size={16} />}
              onClick={() => fileRef.current?.click()}
            >
              {d.photoUrl ? 'Заменить фото' : 'Загрузить фото'}
            </Button>
            {d.photoUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<Trash2 size={14} />}
                onClick={() => setD({ ...d, photoUrl: null, photoFullUrl: null })}
              >
                Убрать
              </Button>
            ) : null}
          </div>
        </div>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Как найти" hint="Ориентир: «вход со двора, серая дверь»">
          <Input value={d.entranceHint ?? ''} onChange={(e) => set('entranceHint', e.target.value)} maxLength={160} />
        </Field>
        <Field label="Телефон точки" hint="Необязательно">
          <Input value={d.phone ?? ''} onChange={(e) => set('phone', e.target.value)} maxLength={32} placeholder="+7 …" />
        </Field>
      </div>

      <div className="rounded-xl border border-line p-3">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={week != null} onChange={(e) => setWeek(e.target.checked ? new Array<DayHours>(7).fill({ open: d.openTime || '08:00', close: d.closeTime || '21:00' }) : null)} />
          Разные часы по дням
        </label>
        {week ? (
          <div className="mt-2 space-y-1.5">
            {DAY_NAMES.map((name, idx) => {
              const day = week[idx] ?? null
              return (
                <div key={name} className="flex items-center gap-2">
                  <span className="w-7 text-xs font-semibold text-ink-secondary">{name}</span>
                  <label className="flex items-center gap-1 text-xs text-ink-secondary">
                    <input
                      type="checkbox"
                      checked={day == null}
                      onChange={(e) => {
                        const copy = week.slice()
                        copy[idx] = e.target.checked ? null : { open: d.openTime || '08:00', close: d.closeTime || '21:00' }
                        setWeek(copy)
                      }}
                    />
                    выходной
                  </label>
                  <Input
                    type="time"
                    aria-label={`${name} открытие`}
                    value={day?.open ?? ''}
                    disabled={day == null}
                    onChange={(e) => {
                      const copy = week.slice()
                      copy[idx] = { open: e.target.value, close: day?.close ?? '21:00' }
                      setWeek(copy)
                    }}
                    className="max-w-[120px]"
                  />
                  <Input
                    type="time"
                    aria-label={`${name} закрытие`}
                    value={day?.close ?? ''}
                    disabled={day == null}
                    onChange={(e) => {
                      const copy = week.slice()
                      copy[idx] = { open: day?.open ?? '08:00', close: e.target.value }
                      setWeek(copy)
                    }}
                    className="max-w-[120px]"
                  />
                </div>
              )
            })}
            <p className="text-[12px] text-ink-secondary">Выходной — точка закрыта весь день, заказ в неё отправить нельзя.</p>
          </div>
        ) : (
          <p className="mt-1 text-[12px] text-ink-secondary">Пока одна пара «открытие/закрытие» на все дни.</p>
        )}
      </div>

      {(
        <div className="rounded-xl border border-line p-3">
          <div className="text-sm font-semibold">Касса точки</div>
          <p className="mt-1 text-[12px] text-ink-secondary">
            Без привязки заказ уйдёт без UUID товаров — касса не сможет сопоставить позиции.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Select
              value={linkUuid}
              aria-label={`Касса для точки: ${store.name}`}
              onChange={(e) => setLinkUuid(e.target.value)}
              className="min-w-[240px]"
            >
              <option value="">— нет привязки —</option>
              {linkOptions.map((o) => (
                <option key={o.uuid} value={o.uuid}>
                  {o.name ?? o.uuid.slice(0, 8)}
                </option>
              ))}
            </Select>
            <Button type="button" size="sm" loading={busy === 'link'} onClick={() => void saveLink()}>
              Сохранить привязку
            </Button>
            {store.evotorCode ? <span className="text-[12px] text-ink-secondary">код: {store.evotorCode}</span> : null}
          </div>
        </div>
      )}

      {gaps.length ? (
        <p className="text-[12px] text-warn">Гостю не хватает: {gaps.join(', ')}</p>
      ) : null}
      {err ? <p className="text-[12px] text-bad">{err}</p> : null}

      <div>
        <Button size="sm" loading={busy === 'save'} aria-label={`Сохранить точку: ${store.name}`} onClick={() => void save()}>
          Сохранить точку
        </Button>
      </div>
    </div>
  )
}
