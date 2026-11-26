import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { Badge, Banner, Button, Card, ErrorBox, Input, Skeleton, Toggle, useToast } from '../../ui/kit'
import { HelpLink } from '../../components/HelpLink'
import { ChevronDown, ChevronUp, Plus, RotateCcw, Search, Trash2 } from 'lucide-react'

/** Адрес настроек: с точкой — её собственная, без точки — общая. */
export function cashierUpsellUrl(storeUuid: string | null): string {
  return storeUuid ? `/cashier/upsell?storeUuid=${encodeURIComponent(storeUuid)}` : '/cashier/upsell'
}

export type UpsellDraft = { enabled: boolean; defaultProductIds: number[] }
export type UpsellProduct = { id: number; name: string; price: number }

/** Меняет местами соседей; за границами списка возвращает null (двигать некуда). */
export function movedUpsell(ids: number[], index: number, delta: number): number[] | null {
  const to = index + delta
  if (index < 0 || index >= ids.length || to < 0 || to >= ids.length) return null
  const next = [...ids]
  const a = next[index]
  next[index] = next[to]
  next[to] = a
  return next
}

/** Добавляет товар в конец, если его там ещё нет и не превышен потолок. */
export function addUpsell(ids: number[], id: number, limit: number): number[] {
  if (ids.includes(id) || ids.length >= limit) return ids
  return [...ids, id]
}

/** Что показать в поиске: товары не из списка. */
export function upsellSearch(products: UpsellProduct[], ids: number[], query: string, limit = 20): UpsellProduct[] {
  const q = query.trim().toLocaleLowerCase('ru-RU')
  return products
    .filter((p) => !ids.includes(p.id))
    .filter((p) => (q ? p.name.toLocaleLowerCase('ru-RU').includes(q) : true))
    .slice(0, limit)
}

type UpsellResp = {
  storeUuid: string | null
  own: boolean
  enabled: boolean
  defaultProductIds: number[]
  byProductId: Record<string, number[]>
  defaults: UpsellProduct[]
  missingDefault: number[]
  limit: { defaults: number; perProduct: number }
  products: UpsellProduct[]
}

/**
 * «Рекомендации на кассе»: главный рубильник точки и явный список «к любому заказу».
 * Пока выключено, каталог отдаёт пустые списки — касса блок не показывает.
 * Данные при выключении не стираются: включили обратно — список на месте.
 */
export default function CashierUpsellPanel({ storeUuid, storeName }: { storeUuid: string | null; storeName?: string }) {
  const shared = storeUuid == null
  const toast = useToast()
  const { data, error, loading, reload } = useApi<UpsellResp>(cashierUpsellUrl(storeUuid))
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<UpsellDraft>({ enabled: false, defaultProductIds: [] })

  useEffect(() => {
    if (data) setDraft({ enabled: data.enabled, defaultProductIds: data.defaultProductIds })
  }, [data])

  const products = data?.products ?? []
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const limit = data?.limit.defaults ?? 12
  const dirty = !!data && (draft.enabled !== data.enabled || draft.defaultProductIds.join(',') !== data.defaultProductIds.join(','))
  const found = upsellSearch(products, draft.defaultProductIds, query)

  const save = async () => {
    setBusy(true)
    try {
      const body = { ...(storeUuid ? { storeUuid } : {}), enabled: draft.enabled, defaultProductIds: draft.defaultProductIds }
      const r = await api<{ skipped?: string[] }>('/cashier/upsell', { method: 'PUT', body })
      if (r.skipped?.length) toast.push(`Пропущены добавки: ${r.skipped.join(', ')}`, 'neutral')
      toast.push('Рекомендации сохранены')
      setSaved(true)
      reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      if (shared || !storeUuid) {
        await api('/cashier/upsell', { method: 'PUT', body: { enabled: false, defaultProductIds: [] } })
        toast.push('Рекомендации выключены, список очищен')
      } else {
        await api(cashierUpsellUrl(storeUuid), { method: 'DELETE' })
        toast.push('Точка снова на общей настройке')
      }
      setSaved(false)
      reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const relative = (index: number, delta: number) => {
    const next = movedUpsell(draft.defaultProductIds, index, delta)
    if (next) setDraft((d) => ({ ...d, defaultProductIds: next }))
  }

  return (
    <Card className="mt-3">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className="text-[14px] font-semibold">{shared ? 'Рекомендации на кассе — общие' : 'Рекомендации на кассе'}</span>
          {data && (
            <Badge tone={data.enabled ? 'ok' : 'neutral'}>{data.enabled ? 'включены' : 'выключены'}</Badge>
          )}
          {data && !shared && (
            <Badge tone={data.own ? 'brand' : 'neutral'}>{data.own ? 'своя настройка' : 'как у всех'}</Badge>
          )}
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && (
        <div className="mt-3">
          {loading && !data && <Skeleton className="h-16" />}
          {error && <ErrorBox message={error} onRetry={reload} />}
          {data && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-secondary">
                <span>
                  {shared
                    ? 'Значения по умолчанию: так касса выглядит, пока у точки нет своей настройки.'
                    : `Только для точки «${storeName ?? storeUuid}». Другие кассы не затрагиваются.`}
                </span>
                <HelpLink article="cashier-upsell" label="Как это работает" className="inline-flex items-center gap-1" />
              </div>

              <div className="rounded-xl border border-line px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold">Показывать рекомендации на кассе</div>
                    <p className="mt-0.5 text-[12px] text-ink-secondary">
                      Блок «Добавить к заказу» и подсказки перед оплатой. Не влияет на молоко, сиропы и добавки к напитку.
                    </p>
                  </div>
                  <Toggle
                    checked={draft.enabled}
                    label="Показывать рекомендации на кассе"
                    onChange={(v) => { setDraft((d) => ({ ...d, enabled: v })); setSaved(false) }}
                  />
                </div>
              </div>

              <div className={draft.enabled ? 'mt-3' : 'mt-3 opacity-50'} aria-disabled={!draft.enabled}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px] font-medium text-ink-secondary">К любому заказу</div>
                  <span className="text-[11px] text-ink-tertiary">{draft.defaultProductIds.length} из {limit}</span>
                </div>

                {!draft.defaultProductIds.length && (
                  <p className="mt-1 text-[12px] text-ink-tertiary">
                    Список пуст. Пока здесь ничего нет, касса рекомендации не показывает.
                  </p>
                )}
                <ul className="mt-1 space-y-1">
                  {draft.defaultProductIds.map((id, i) => {
                    const p = byId.get(id)
                    return (
                      <li key={id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1.5">
                        <span className="min-w-0 truncate text-[13px]">
                          {i + 1}. {p ? `${p.name} — ${p.price} ₽` : `товар #${id} (нет в продаже)`}
                        </span>
                        <span className="flex shrink-0 gap-1">
                          <Button size="sm" variant="ghost" aria-label="Выше" disabled={busy || i === 0} onClick={() => relative(i, -1)}>
                            <ChevronUp size={14} />
                          </Button>
                          <Button size="sm" variant="ghost" aria-label="Ниже" disabled={busy || i === draft.defaultProductIds.length - 1} onClick={() => relative(i, 1)}>
                            <ChevronDown size={14} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Убрать"
                            disabled={busy}
                            onClick={() => { setDraft((d) => ({ ...d, defaultProductIds: d.defaultProductIds.filter((x) => x !== id) })); setSaved(false) }}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </span>
                      </li>
                    )
                  })}
                </ul>

                {draft.defaultProductIds.length < limit && (
                  <div className="mt-2">
                    <label className="relative block">
                      <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-tertiary" aria-hidden />
                      <Input
                        className="pl-7"
                        placeholder="Найти товар: круассан, эклер…"
                        value={query}
                        disabled={busy || !draft.enabled}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    {query.trim() !== '' && (
                      <ul className="mt-1 max-h-52 space-y-1 overflow-auto">
                        {!found.length && <li className="px-2 py-1 text-[12px] text-ink-tertiary">Ничего не найдено</li>}
                        {found.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 rounded-lg border border-line px-2 py-1.5 text-left text-[13px] hover:bg-surface-2"
                              disabled={busy || !draft.enabled}
                              onClick={() => {
                                setDraft((d) => ({ ...d, defaultProductIds: addUpsell(d.defaultProductIds, p.id, limit) }))
                                setQuery('')
                                setSaved(false)
                              }}
                            >
                              <span className="min-w-0 truncate">{p.name} — {p.price} ₽</span>
                              <Plus size={14} className="shrink-0" aria-hidden />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {data.missingDefault.length > 0 && (
                <p className="mt-2 text-[12px] text-warn">
                  Часть товаров из списка больше не продаётся и не покажется на кассе: {data.missingDefault.map((id) => `#${id}`).join(', ')}.
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" loading={busy} disabled={!dirty} onClick={save}>
                  Сохранить
                </Button>
                <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} loading={busy} onClick={reset}>
                  {shared ? 'Выключить и очистить' : data.own ? 'Сбросить к общей настройке' : 'Выключить и очистить'}
                </Button>
              </div>

              {saved && (
                <Banner tone="ok">
                  Сохранено. На кассе обновите каталог (потянуть список или подождать до ~60 с) — рекомендации появятся
                  после обновления. Добавки к напиткам, молоко и сиропы не изменились.
                </Banner>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  )
}
