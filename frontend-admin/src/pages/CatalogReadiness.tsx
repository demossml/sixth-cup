import { useState } from 'react'
import { useApi } from '../api/useApi'
import { useSyncStores } from '../api/useStores'
import type { Product } from '../api/types'
import { READINESS_KIND_LABEL, reasonLabel, type CardReadiness, type Readiness } from '../lib/readiness'
import { Badge, Banner, Card, EmptyState, ErrorBox, Field, PageHeader, Select, Spinner } from '../ui/kit'

/** Предпросмотр: что именно касса покажет кассиру после тапа по плитке. */
function CardPreview({ productId, storeUuid }: { productId: number; storeUuid: string }) {
  const qs = storeUuid ? `?storeUuid=${encodeURIComponent(storeUuid)}` : ''
  const { data, error, loading } = useApi<CardReadiness>(`/catalog/product/${productId}/card${qs}`)
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} />
  if (!data) return null

  const row = (key: string, name: string, price: number | null, ok: boolean, reason: string | null, tag?: string) => (
    <li key={key} className="flex items-center gap-2 py-1 text-[13px]">
      <span className="flex-1">
        {name}
        {tag ? <span className="text-ink-tertiary"> · {tag}</span> : null}
        {price != null ? ` · ${price} ₽` : ''}
      </span>
      {ok ? <Badge tone="ok">готово</Badge> : <Badge tone="warn">{reasonLabel(reason)}</Badge>}
    </li>
  )

  return (
    <div className="mt-3 space-y-3">
      <Banner tone={data.ready ? 'ok' : 'warn'}>
        {data.ready ? 'Касса сможет пробить этот напиток' : 'Касса не сможет пробить этот напиток'}
      </Banner>
      <div>
        <div className="text-[13px] font-medium">Объёмы</div>
        <ul>
          {data.volumes.map((v) =>
            row(`v${v.productId}`, v.label || data.name, v.price, v.ready, v.reason, v.evotorUuid ?? 'без UUID'),
          )}
        </ul>
      </div>
      {data.milk.schemeId != null && (
        <div>
          <div className="text-[13px] font-medium">Молоко {data.milk.required ? '(обязательно)' : ''}</div>
          <ul>
            {data.milk.options.map((o, i) =>
              row(`m${i}`, o.name, null, o.ready, o.reason, o.isFree ? 'бесплатно, без чека' : undefined),
            )}
            {!data.milk.options.length && <li className="py-1 text-[13px] text-bad">Выбрать нечего — схема пуста</li>}
          </ul>
        </div>
      )}
      {data.addons.options.length > 0 && (
        <div>
          <div className="text-[13px] font-medium">Добавки (по желанию)</div>
          <ul>
            {data.addons.options.map((o, i) => row(`a${i}`, o.name, o.price, o.ready, o.reason, o.group))}
          </ul>
        </div>
      )}
      {data.volumeScheme.schemeId != null && (
        <div>
          <div className="text-[13px] font-medium">Схема объёмов</div>
          <ul>
            {data.volumeScheme.items.map((i) => (
              <li key={i.label} className="py-1 text-[13px]">
                {i.label} · {i.price} ₽
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Готовность каталога точки: что касса не сможет продать и почему. */
export default function CatalogReadiness() {
  const { stores } = useSyncStores()
  const [store, setStore] = useState('')
  const [preview, setPreview] = useState('')
  const products = useApi<{ products: Product[] }>('/products')
  const qs = store ? `?storeUuid=${encodeURIComponent(store)}` : ''
  const ready = useApi<Readiness>(`/catalog/readiness${qs}`)
  const drinks = (products.data?.products ?? []).filter((p) => p.countsAsCup)

  return (
    <>
      <PageHeader
        title="Готовность кассы"
        subtitle="Что касса не сможет продать и почему. Считается по связям товаров с Эвотором этой точки."
      />
      <div className="space-y-4">
        <Card>
          <Field label="Точка" hint="Выберите точку — проверка пойдёт по её UUID из Эвотова. Без точки проверяется, есть ли товар в Эвотор хоть где-то.">
            <Select value={store} onChange={(e) => { setStore(e.target.value); setPreview('') }}>
              <option value="">Все точки (общая проверка)</option>
              {stores.map((s) => (
                <option key={s.uuid} value={s.uuid}>{s.name ?? s.uuid.slice(0, 8)}</option>
              ))}
            </Select>
          </Field>
        </Card>

        {ready.loading && !ready.data ? (
          <Spinner />
        ) : ready.error ? (
          <ErrorBox message={ready.error} onRetry={ready.reload} />
        ) : ready.data && (
          <Card>
            <Banner tone={ready.data.notReady.length ? 'warn' : 'ok'}>
              Готово к продаже: <b>{ready.data.readyCards}</b> из {ready.data.cards} карточек.
              {ready.data.notReady.length ? ` Проблем: ${ready.data.notReady.length}.` : ' Проблем нет.'}
            </Banner>
            {ready.data.notReady.length === 0 ? (
              <EmptyState title="Всё выгружено в Эвотор" />
            ) : (
              <ul className="divide-y divide-line text-[13px]">
                {ready.data.notReady.map((e, i) => (
                  <li key={`${e.kind}-${e.productId ?? e.name}-${i}`} className="flex items-center gap-2 py-2">
                    <Badge tone="neutral">{READINESS_KIND_LABEL[e.kind] ?? e.kind}</Badge>
                    <span className="flex-1">{e.name}</span>
                    <span className="text-warn">{reasonLabel(e.reason)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card>
          <Field label="Предпросмотр: что увидит кассир после тапа по напитку">
            <Select value={preview} onChange={(e) => setPreview(e.target.value)}>
              <option value="">— выберите напиток —</option>
              {drinks.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
          {preview && <CardPreview key={`${preview}-${store}`} productId={Number(preview)} storeUuid={store} />}
        </Card>
      </div>
    </>
  )
}
