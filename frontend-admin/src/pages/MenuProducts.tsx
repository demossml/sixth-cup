import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Archive, Download, Plus, Pencil } from 'lucide-react'
import { api, download } from '../api/client'
import { useApi } from '../api/useApi'
import type { BulkPlan, Category, EvotorStore, Product, Scheme } from '../api/types'
import { useSyncStores } from '../api/useStores'
import { FIELD_LABEL, filterProducts, showChangeValue, sortProducts, syncState, tabCounts } from '../lib/menu'
import type { MenuTab, SortKey } from '../lib/menu'
import { fmtNum } from '../lib/format'
import { setParams } from '../lib/query'
import { Badge, Banner, Button, Card, Check, ConfirmDialog, DataTable, Drawer, ErrorBox, Field, Input, Select, Spinner, Tabs, Toggle, useToast } from '../ui/kit'
import type { Column } from '../ui/kit'

const SYNC: Record<string, { tone: 'ok' | 'warn' | 'bad' | 'neutral'; label: string }> = {
  ok: { tone: 'ok', label: 'В кассе' },
  pending: { tone: 'warn', label: 'Ждёт выгрузки' },
  error: { tone: 'bad', label: 'Ошибка выгрузки' },
  none: { tone: 'neutral', label: 'Не на кассе' },
}

type Draft = Partial<Product> & { name: string; price: number; storeUuids: string[] }

/* ───────── single product drawer ───────── */
function ProductDrawer({ draft, onClose, onSaved, categories, schemes, stores }: {
  draft: Draft | null; onClose: () => void; onSaved: () => void; categories: Category[]; schemes: Scheme[]; stores: EvotorStore[]
}) {
  const [d, setD] = useState<Draft | null>(draft)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const toast = useToast()
  // re-seed when a different product is opened
  const key = draft ? `${draft.id ?? 'new'}` : ''
  const [seen, setSeen] = useState(key)
  if (key !== seen) { setSeen(key); setD(draft); setErr('') }
  
  const [storeAvail, setStoreAvail] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!draft?.id) { setStoreAvail({}); return }
    let cancelled = false
    api<{ rows: { storeUuid: string; available: number }[] }>(`/products/${draft.id}/availability`)
      .then((r) => {
        if (cancelled) return
        const m: Record<string, boolean> = {}
        for (const row of r.rows) m[row.storeUuid] = !!row.available
        setStoreAvail(m)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [draft?.id])
if (!d) return <Drawer open={false} onClose={onClose} title="" children={null} />
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v })

  const save = async () => {
    if (!d.name.trim()) { setErr('Введите название'); return }
    if (!Number.isInteger(d.price) || d.price < 0) { setErr('Цена — целое число рублей, не меньше 0'); return }
    setBusy(true)
    setErr('')
    try {
      // POST /products rewrites the whole row, so every field is sent back (unchanged ones keep their value).
      const r = await api<{ id: number }>('/products', {
        method: 'POST',
        body: {
          id: d.id, name: d.name.trim(), price: d.price, icon: d.icon || 'Coffee', available: !!d.available,
          description: d.description || null, categoryId: d.categoryId ?? null, imageUrl: d.imageUrl ?? null,
          sortOrder: d.sortOrder ?? 0, modifierSchemeId: d.modifierSchemeId ?? null,
          recipeText: d.recipeText ?? null, recipeCostRub: d.recipeCostRub ?? null, recipeSeconds: d.recipeSeconds ?? null,
          countsAsCup: !!d.countsAsCup, freeEligible: !!d.freeEligible,
          tax: d.tax || undefined, measure: d.measure || undefined, costPriceKopecks: d.costPriceKopecks ?? undefined,
          seasonStartAt: d.seasonStartAt ?? null, seasonEndAt: d.seasonEndAt ?? null, evotorExtraJson: d.evotorExtraJson ?? null,
        },
      })
      await api(`/products/${r.id}/stores`, { method: 'PUT', body: { storeUuids: d.storeUuids } })
      toast.push(d.id ? 'Товар сохранён' : 'Товар создан')
      onSaved()
      onClose()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Не удалось сохранить') } finally { setBusy(false) }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={d.id ? 'Товар' : 'Новый товар'}
      footer={<><Button variant="secondary" onClick={onClose}>Отмена</Button><Button onClick={save} loading={busy}>Сохранить</Button></>}
    >
      {err && <ErrorBox message={err} />}
      <div className="mt-3" />
      <Field label="Название"><Input value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={60} /></Field>
      <Field label="Цена, ₽"><Input type="number" inputMode="numeric" min={0} value={Number.isFinite(d.price) ? d.price : ''} onChange={(e) => set('price', e.target.value === '' ? NaN : Number(e.target.value))} /></Field>
      <Field label="Группа">
        <Select value={d.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value ? Number(e.target.value) : null)}>
          <option value="">Без группы</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <div className="mb-3 rounded-xl border border-line p-3">
        <div className="mb-1 flex items-center justify-between gap-3"><span className="text-[15px]">В продаже</span><Toggle checked={!!d.available} onChange={(v) => set('available', v ? 1 : 0)} label="В продаже" /></div>
        {d.id && stores.length > 0 && (
          <div className="mb-3 rounded-xl border border-line p-3">
            <div className="text-sm font-semibold mb-2">Доступность по точкам (приложение 6.7; не скрывает позицию в меню Эвотор)</div>
            <p className="text-xs text-ink-secondary mb-2">Если не задано — действует глобальный «В продаже». На кассу Эвотор это не пушится автоматически.</p>
            <div className="space-y-2">
              {stores.filter((s) => s.sync_enabled !== 0).map((s) => {
                const uuid = String(s.uuid || s.storeUuid || s.id)
                const checked = storeAvail[uuid] !== undefined ? storeAvail[uuid] : !!d.available
                return (
                  <div key={String(uuid)} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{s.name || uuid}</span>
                    <Toggle
                      checked={checked}
                      label={s.name || uuid}
                      onChange={async (v) => {
                        setStoreAvail((m) => ({ ...m, [uuid]: v }))
                        try {
                          await api(`/products/${d.id}/availability`, { method: 'PUT', body: { storeUuid: uuid, available: v } })
                        } catch (e) {
                          toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
                        }
                      }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <Check checked={!!d.countsAsCup} onChange={(v) => set('countsAsCup', v ? 1 : 0)} label="Считается чашкой (идёт в счётчик лояльности)" />
        <Check checked={!!d.freeEligible} onChange={(v) => set('freeEligible', v ? 1 : 0)} label="Можно выдать бесплатно по лояльности" />
      </div>
      <Field label="На каких точках продаётся" hint={stores.length ? 'Показаны только точки с включённой синхронизацией' : 'Нет точек с включённой синхронизацией — см. раздел «Касса»'}>
        <div className="rounded-xl border border-line px-3">
          {stores.map((s) => (
            <Check key={s.uuid} label={s.name ?? s.uuid.slice(0, 8)} checked={d.storeUuids.includes(s.uuid)}
              onChange={(v) => set('storeUuids', v ? [...d.storeUuids, s.uuid] : d.storeUuids.filter((x) => x !== s.uuid))} />
          ))}
          {!stores.length && <p className="py-3 text-sm text-ink-secondary">—</p>}
        </div>
      </Field>
      <Field label="Схема добавок">
        <Select value={d.modifierSchemeId ?? ''} onChange={(e) => set('modifierSchemeId', e.target.value ? Number(e.target.value) : null)}>
          <option value="">Без добавок</option>
          {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      <Field label="Описание"><Input value={d.description ?? ''} onChange={(e) => set('description', e.target.value)} maxLength={500} /></Field>
      <Field label="Рецепт (для бариста)" hint="Текст виден на кассе и в админке">
        <textarea
          className="w-full rounded-xl border border-line px-3 py-2 text-[15px] min-h-[88px]"
          value={d.recipeText ?? ''}
          onChange={(e) => set('recipeText', e.target.value)}
          maxLength={4000}
        />
      </Field>
      <Field label="Фото товара" hint="JPEG/PNG/WebP до 2 МБ. Гость видит это фото в меню PWA.">
        {d.imageUrl ? (
          <div className="mb-2 flex items-start gap-3">
            <img
              src={d.imageUrl}
              alt=""
              className="h-20 w-20 rounded-xl object-cover border border-line bg-[#EDE7DC]"
            />
            <div className="flex flex-col gap-2">
              <Button type="button" variant="ghost" onClick={() => set('imageUrl', null)}>
                Удалить фото
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-secondary mb-2">Фото ещё нет — в меню будет нейтральная заглушка.</p>
        )}
        <Input value={d.imageUrl ?? ''} onChange={(e) => set('imageUrl', e.target.value || null)} placeholder="https://… или /uploads/…" />
      </Field>
      <Field label="Загрузить файл">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="block w-full text-sm"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            setBusy(true)
            setErr('')
            try {
              const fd = new FormData()
              fd.append('file', f)
              const token = (await import('../api/client')).tokenStore.get()
              const base = (import.meta as any).env?.VITE_API_URL ?? ''
              const res = await fetch(`${base}/api/admin/upload`, {
                method: 'POST',
                headers: { 'X-Admin-Token': token },
                body: fd,
              })
              if (!res.ok) throw new Error((await res.text()) || res.statusText)
              const j = await res.json() as { url?: string }
              if (!j.url) throw new Error('Нет url в ответе')
              set('imageUrl', j.url)
              toast.push('Фото загружено')
            } catch (err) {
              setErr(err instanceof Error ? err.message : 'Ошибка загрузки')
            } finally {
              setBusy(false)
              e.target.value = ''
            }
          }}
        />
      </Field>
      <details className="mb-3">
        <summary className="cursor-pointer text-sm font-semibold text-brand">Дополнительно</summary>
        <div className="mt-3">
          <Field label="Иконка в приложении"><Input value={d.icon ?? 'Coffee'} onChange={(e) => set('icon', e.target.value)} maxLength={24} /></Field>
          <Field label="Порядок сортировки"><Input type="number" value={d.sortOrder ?? 0} onChange={(e) => set('sortOrder', Number(e.target.value) || 0)} /></Field>
          <Field label="Налог"><Input value={d.tax ?? ''} onChange={(e) => set('tax', e.target.value)} placeholder="NO_VAT" /></Field>
          <Field label="Единица измерения"><Input value={d.measure ?? ''} onChange={(e) => set('measure', e.target.value)} placeholder="шт" /></Field>
          <Field label="Себестоимость, ₽"><Input type="number" min={0} value={d.recipeCostRub ?? ''} onChange={(e) => set('recipeCostRub', e.target.value === '' ? null : Number(e.target.value))} /></Field>
          <Field label="Время приготовления, сек"><Input type="number" min={0} value={d.recipeSeconds ?? ''} onChange={(e) => set('recipeSeconds', e.target.value === '' ? null : Number(e.target.value))} /></Field>
        </div>
      </details>
      {d.id && d.evotorLinks && d.evotorLinks.some((l) => l.lastError) && (
        <Banner tone="bad">Последняя выгрузка в Эвотор: {d.evotorLinks.find((l) => l.lastError)?.lastError}</Banner>
      )}
    </Drawer>
  )
}

/* ───────── bulk drawer ───────── */
function BulkDrawer({ ids, onClose, onDone, categories, stores }: { ids: number[]; onClose: () => void; onDone: () => void; categories: Category[]; stores: EvotorStore[] }) {
  const toast = useToast()
  const [mode, setMode] = useState<'none' | 'price' | 'delta' | 'percent'>('none')
  const [amount, setAmount] = useState('')
  const [available, setAvailable] = useState('')
  const [cat, setCat] = useState('')
  const [cup, setCup] = useState('')
  const [free, setFree] = useState('')
  const [storeEnable, setStoreEnable] = useState('')
  const [storeDisable, setStoreDisable] = useState('')
  const [plan, setPlan] = useState<BulkPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const body = (dryRun: boolean) => {
    const patch: Record<string, unknown> = {}
    const n = Number(amount)
    if (mode !== 'none') {
      if (amount === '' || !Number.isFinite(n)) throw new Error('Введите число для цены')
      if (mode === 'price') patch.price = n
      if (mode === 'delta') patch.priceDelta = n
      if (mode === 'percent') patch.pricePercent = n
    }
    if (available) patch.available = available === '1'
    if (cat) patch.categoryId = cat === 'none' ? null : Number(cat)
    if (cup) patch.countsAsCup = cup === '1'
    if (free) patch.freeEligible = free === '1'
    return {
      ids, dryRun,
      patch: Object.keys(patch).length ? patch : undefined,
      stores: storeEnable || storeDisable ? { enable: storeEnable ? [storeEnable] : [], disable: storeDisable ? [storeDisable] : [] } : undefined,
    }
  }
  const run = async (dryRun: boolean) => {
    setBusy(true); setErr('')
    try {
      const r = await api<BulkPlan & { stores?: { enable: string[]; disable: string[] } }>('/products/bulk', { method: 'POST', body: body(dryRun) })
      if (dryRun) setPlan(r)
      else { toast.push(`Изменено товаров: ${r.changedProducts}`); onDone(); onClose() }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Ошибка') } finally { setBusy(false) }
  }
  const touched = () => { setPlan(null) }
  const sel = (v: string, f: (x: string) => void, children: React.ReactNode) => (
    <Select value={v} onChange={(e) => { f(e.target.value); touched() }}>{children}</Select>
  )
  const yn = <><option value="">Не менять</option><option value="1">Да</option><option value="0">Нет</option></>
  return (
    <Drawer open onClose={onClose} title={`Изменить товары: ${ids.length}`} wide
      footer={<>
        <Button variant="secondary" onClick={onClose}>Отмена</Button>
        {!plan ? <Button onClick={() => run(true)} loading={busy}>Показать, что изменится</Button>
          : <Button onClick={() => run(false)} loading={busy} disabled={!plan.changedProducts && !storeEnable && !storeDisable}>Применить</Button>}
      </>}>
      {err && <ErrorBox message={err} />}
      <Field label="Цена">
        <div className="grid grid-cols-[1fr_1fr] gap-2">
          {sel(mode, (v) => setMode(v as typeof mode), <><option value="none">Не менять</option><option value="price">Задать цену, ₽</option><option value="delta">Прибавить / убавить, ₽</option><option value="percent">Изменить на, %</option></>)}
          <Input type="number" disabled={mode === 'none'} value={amount} onChange={(e) => { setAmount(e.target.value); touched() }} placeholder={mode === 'percent' ? 'например 10 или −5' : 'число'} />
        </div>
      </Field>
      <Field label="В продаже">{sel(available, setAvailable, yn)}</Field>
      <Field label="Группа">{sel(cat, setCat, <><option value="">Не менять</option><option value="none">Без группы</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</>)}</Field>
      <Field label="Считается чашкой">{sel(cup, setCup, yn)}</Field>
      <Field label="Бесплатная позиция">{sel(free, setFree, yn)}</Field>
      <Field label="Включить на точке">{sel(storeEnable, setStoreEnable, <><option value="">—</option>{stores.map((s) => <option key={s.uuid} value={s.uuid}>{s.name ?? s.uuid.slice(0, 8)}</option>)}</>)}</Field>
      <Field label="Убрать с точки">{sel(storeDisable, setStoreDisable, <><option value="">—</option>{stores.map((s) => <option key={s.uuid} value={s.uuid}>{s.name ?? s.uuid.slice(0, 8)}</option>)}</>)}</Field>
      {plan && (
        <div className="mt-4">
          <Banner tone={plan.changedProducts ? 'brand' : 'neutral'}>Изменится товаров: <b>{plan.changedProducts}</b> из {plan.products}. Проверьте и нажмите «Применить».</Banner>
          <ul className="max-h-72 divide-y divide-line overflow-auto rounded-xl border border-line text-sm">
            {plan.plan.filter((p) => p.changes.length).map((p) => (
              <li key={p.id} className="px-3 py-2">
                <div className="font-semibold">{p.name}</div>
                {p.changes.map((c) => (
                  <div key={c.field} className="text-ink-secondary">{FIELD_LABEL[c.field] ?? c.field}: {showChangeValue(c.field, c.from, categories)} → <b className="text-ink">{showChangeValue(c.field, c.to, categories)}</b></div>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  )
}

/* ───────── products tab ───────── */
export default function MenuProducts() {
  const [sp, setSp] = useSearchParams()
  const toast = useToast()
  const products = useApi<{ products: Product[] }>('/products')
  const cats = useApi<{ categories: Category[] }>('/categories')
  const schemes = useApi<{ schemes: Scheme[] }>('/modifier-schemes')
  const { stores: syncStores } = useSyncStores()
  const tab = (sp.get('tab') ?? 'all') as MenuTab
  const q = sp.get('q') ?? ''
  const group = sp.get('group') ?? 'all'
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'order', dir: 'asc' })
  const [sel, setSel] = useState<Set<string | number>>(new Set())
  const [edit, setEdit] = useState<Draft | null>(null)
  const [bulk, setBulk] = useState(false)
  const [archive, setArchive] = useState<Product | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const patch = (p: Record<string, string | null>) => setSp(setParams(sp, p), { replace: true })

  const all = products.data?.products ?? []
  const categories = cats.data?.categories ?? []
  const counts = useMemo(() => tabCounts(all), [all])
  const rows = useMemo(
    () => sortProducts(filterProducts(all, { tab, q, categoryId: group === 'all' ? 'all' : Number(group) }), sort.key, sort.dir),
    [all, tab, q, group, sort],
  )

  const quick = async (p: Product, body: Record<string, unknown>) => {
    setBusyId(p.id)
    try {
      await api(`/products/${p.id}`, { method: 'PATCH', body: { ...body, expectedUpdatedAt: p.updatedAt } })
      products.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось сохранить', 'bad')
      products.reload()
    } finally { setBusyId(null) }
  }
  const openEdit = (p: Product) => setEdit({ ...p, storeUuids: p.evotorLinks.filter((l) => l.enabled !== 0).map((l) => l.storeUuid) })
  const doArchive = async () => {
    if (!archive) return
    try { await api(`/products/${archive.id}`, { method: 'DELETE' }); toast.push('Товар убран из продажи'); products.reload() }
    catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad') }
    setArchive(null)
  }

  const cols: Column<Product>[] = [
    {
      key: 'photo',
      header: '',
      hideOnPhone: true,
      render: (row) => row.imageUrl
        ? <img src={row.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover bg-[#EDE7DC]" />
        : <div className="h-10 w-10 rounded-lg bg-[#EDE7DC] text-[10px] text-brand/40 flex items-center justify-center font-semibold">6.7</div>,
    },
    { key: 'name', header: 'Название', primary: true, sortKey: 'name', render: (p) => <span className={p.available ? '' : 'text-ink-tertiary'}>{p.name}</span> },
    { key: 'group', header: 'Группа', sortKey: 'category', render: (p) => p.categoryName ?? <span className="text-ink-tertiary">—</span> },
    {
      key: 'price', header: 'Цена, ₽', align: 'right', sortKey: 'price',
      render: (p) => <PriceCell p={p} busy={busyId === p.id} onSave={(v) => quick(p, { price: v })} />,
    },
    {
      key: 'sale', header: 'В продаже',
      render: (p) => <span onClick={(e) => e.stopPropagation()}><Toggle checked={!!p.available} disabled={busyId === p.id} label={`В продаже: ${p.name}`} onChange={(v) => quick(p, { available: v })} /></span>,
    },
    { key: 'cup', header: 'Чашка', hideOnPhone: true, render: (p) => (p.countsAsCup ? <Badge tone="brand" icon={false}>считается</Badge> : <span className="text-ink-tertiary">нет</span>) },
    { key: 'sync', header: 'Касса', render: (p) => { const s = SYNC[syncState(p)]; return <Badge tone={s.tone}>{s.label}</Badge> } },
    {
      key: 'act', header: '', align: 'right',
      render: (p) => (
        <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" aria-label={`Изменить ${p.name}`} icon={<Pencil size={14} />} onClick={() => openEdit(p)}>Изменить</Button>
          {p.available ? <Button size="sm" variant="ghost" aria-label={`Убрать ${p.name} из продажи`} icon={<Archive size={14} />} onClick={() => setArchive(p)} /> : null}
        </span>
      ),
    },
  ]

  const selIds = [...sel].map(Number)
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button icon={<Plus size={16} />} onClick={() => setEdit({ name: '', price: 0, available: 1, countsAsCup: 1, storeUuids: syncStores.map((s) => s.uuid) })}>Новый товар</Button>
        <Button variant="secondary" icon={<Download size={14} />} onClick={() => download('/products.csv', 'products.csv').catch((e) => toast.push(String(e.message ?? e), 'bad'))}>CSV</Button>
      </div>
      <Tabs
        items={[
          { key: 'all', label: 'Все', count: counts.all }, { key: 'on', label: 'В продаже', count: counts.on }, { key: 'hidden', label: 'Скрытые', count: counts.hidden },
          { key: 'errors', label: 'Ошибки кассы', count: counts.errors }, { key: 'nogroup', label: 'Без группы', count: counts.nogroup },
        ]}
        value={tab}
        onChange={(k) => patch({ tab: k === 'all' ? null : k })}
      />
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input value={q} onChange={(e) => patch({ q: e.target.value })} placeholder="Поиск по названию" aria-label="Поиск товара" />
        <Select value={group} onChange={(e) => patch({ group: e.target.value === 'all' ? null : e.target.value })} aria-label="Группа">
          <option value="all">Все группы</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>
      {sel.size > 0 && (
        <div className="sticky top-14 z-20 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand p-3 text-white shadow-soft">
          <span className="text-sm font-semibold">Выбрано: {sel.size}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setBulk(true)}>Изменить выбранные</Button>
            <Button size="sm" variant="ghost" className="!text-white hover:!bg-white/20" onClick={() => setSel(new Set())}>Снять</Button>
          </div>
        </div>
      )}
      {products.error && <ErrorBox message={products.error} onRetry={products.reload} />}
      {products.loading && !products.data && <Spinner />}
      {products.data && (
        <DataTable
          rows={rows}
          columns={cols}
          rowKey={(p) => p.id}
          selection={sel}
          onSelectionChange={setSel}
          sort={sort}
          onSort={(k) => setSort((s) => ({ key: k as SortKey, dir: s.key === k && s.dir === 'asc' ? 'desc' : 'asc' }))}
          onRowClick={openEdit}
        />
      )}
      <p className="mt-3 text-xs text-ink-secondary">Показано {fmtNum(rows.length)} из {fmtNum(all.length)}. «Убрать из продажи» скрывает товар, а не удаляет: история чеков остаётся целой.</p>

      <ProductDrawer draft={edit} onClose={() => setEdit(null)} onSaved={products.reload} categories={categories} schemes={schemes.data?.schemes ?? []} stores={syncStores} />
      {bulk && <BulkDrawer ids={selIds} onClose={() => setBulk(false)} onDone={() => { setSel(new Set()); products.reload() }} categories={categories} stores={syncStores} />}
      <ConfirmDialog open={!!archive} title="Убрать из продажи?" confirmLabel="Убрать" danger onConfirm={doArchive} onCancel={() => setArchive(null)}>
        «{archive?.name}» исчезнет из приложения и с кассы на включённых точках. Вернуть можно переключателем «В продаже».
      </ConfirmDialog>
    </>
  )
}

function PriceCell({ p, onSave, busy }: { p: Product; onSave: (v: number) => void; busy: boolean }) {
  const [v, setV] = useState<string | null>(null)
  if (v === null) {
    return <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); setV(String(p.price)) }} className="min-h-[36px] rounded-lg px-2 font-semibold tabular-nums hover:bg-brand-soft" aria-label={`Изменить цену: ${p.name}`}>{fmtNum(p.price)}</button>
  }
  const commit = () => {
    const n = Number(v)
    setV(null)
    if (v !== '' && Number.isInteger(n) && n >= 0 && n !== p.price) onSave(n)
  }
  return (
    <input
      autoFocus type="number" inputMode="numeric" min={0} value={v} aria-label={`Цена: ${p.name}`}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setV(null) }}
      className="min-h-[36px] w-24 rounded-lg border border-brand-mid px-2 text-right tabular-nums"
    />
  )
}
