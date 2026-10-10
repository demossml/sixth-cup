import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminFetch } from '../../api/client'
import { formatMoneyRub } from '../../lib/format'
import { PageHeader } from '../../ui/PageHeader'
import { EmptyState } from '../../ui/EmptyState'
import { Badge } from '../../ui/Badge'

type Product = {
  id: number
  name: string
  price: number
  available: number | boolean
  countsAsCup?: number | boolean
  freeEligible?: number | boolean
  categoryId?: number | null
  modifierSchemeId?: number | null
  description?: string | null
  recipeText?: string | null
  imageUrl?: string | null
  tax?: string | null
  measure?: string | null
  costPriceKopecks?: number
  icon?: string | null
  sortOrder?: number
  evotorLinks?: { storeUuid: string; evotorUuid?: string; lastError?: string }[]
}

type Cat = { id: number; name: string }
type Scheme = { id: number; name: string }
type Store = { store_uuid?: string; storeUuid?: string; name: string; sync_enabled?: number; syncEnabled?: boolean }

const emptyForm = (): Partial<Product> & { storeUuids?: string[] } => ({
  name: '',
  price: 150,
  available: true,
  countsAsCup: true,
  freeEligible: false,
  categoryId: null,
  modifierSchemeId: null,
  recipeText: '',
  description: '',
  imageUrl: '',
  tax: 'NO_VAT',
  measure: 'шт',
  costPriceKopecks: 0,
  icon: 'cup',
  sortOrder: 0,
  storeUuids: [],
})

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Cat[]>([])
  const [schemes, setSchemes] = useState<Scheme[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'on' | 'off' | 'cup' | 'err'>('all')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [edit, setEdit] = useState<(Partial<Product> & { storeUuids?: string[] }) | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setErr('')
    try {
      const [pr, cat, sch, st] = await Promise.all([
        adminFetch<{ products: Product[] }>('/products'),
        adminFetch<{ categories?: Cat[] } | Cat[]>('/categories'),
        adminFetch<{ schemes?: Scheme[] } | Scheme[]>('/modifier-schemes'),
        adminFetch<{ stores?: Store[] } | Store[]>('/evotor/stores'),
      ])
      setProducts(pr.products ?? [])
      setCategories(Array.isArray(cat) ? cat : (cat as any).categories ?? [])
      setSchemes(Array.isArray(sch) ? sch : (sch as any).schemes ?? (sch as any).items ?? [])
      const rawStores = Array.isArray(st) ? st : (st as any).stores ?? []
      setStores(rawStores)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    let list = products
    const s = q.trim().toLowerCase()
    if (s) list = list.filter((p) => p.name.toLowerCase().includes(s) || String(p.id) === s)
    if (filter === 'on') list = list.filter((p) => !!p.available)
    if (filter === 'off') list = list.filter((p) => !p.available)
    if (filter === 'cup') list = list.filter((p) => !!p.countsAsCup)
    if (filter === 'err') list = list.filter((p) => p.evotorLinks?.some((l) => l.lastError))
    return list
  }, [products, q, filter])

  function openNew() {
    const syncStores = stores
      .filter((s) => s.syncEnabled || s.sync_enabled)
      .map((s) => s.storeUuid || s.store_uuid || '')
      .filter(Boolean)
    setEdit({ ...emptyForm(), storeUuids: syncStores })
  }

  function openEdit(p: Product) {
    setEdit({
      ...p,
      available: !!p.available,
      countsAsCup: !!p.countsAsCup,
      freeEligible: !!p.freeEligible,
      recipeText: p.recipeText || p.description || '',
      storeUuids: (p.evotorLinks ?? []).map((l) => l.storeUuid).filter(Boolean),
    })
  }

  async function save() {
    if (!edit?.name?.trim()) {
      setErr('Укажите название')
      return
    }
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const body: any = {
        id: edit.id,
        name: edit.name.trim(),
        price: Number(edit.price) || 0,
        available: !!edit.available,
        countsAsCup: !!edit.countsAsCup,
        freeEligible: !!edit.freeEligible,
        categoryId: edit.categoryId || null,
        modifierSchemeId: edit.modifierSchemeId || null,
        recipeText: edit.recipeText || null,
        description: edit.recipeText || edit.description || null,
        imageUrl: edit.imageUrl || null,
        tax: edit.tax || 'NO_VAT',
        measure: edit.measure || 'шт',
        costPriceKopecks: Number(edit.costPriceKopecks) || 0,
        icon: edit.icon || 'cup',
        sortOrder: Number(edit.sortOrder) || 0,
      }
      const res = await adminFetch<{ ok: boolean; id: number }>('/products', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const id = res.id ?? edit.id
      if (id && edit.storeUuids) {
        await adminFetch(`/products/${id}/stores`, {
          method: 'PUT',
          body: JSON.stringify({ storeUuids: edit.storeUuids }),
        }).catch(() => {
          /* older API may differ */
        })
      }
      setMsg(edit.id ? 'Товар обновлён' : 'Товар создан')
      setEdit(null)
      await load()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    if (!confirm('Скрыть товар (available=0)?')) return
    setBusy(true)
    try {
      await adminFetch(`/products/${id}`, { method: 'DELETE' })
      await load()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function bulk(patch: Record<string, unknown>) {
    const ids = [...selected]
    if (!ids.length) return
    try {
      await adminFetch('/products/bulk', { method: 'POST', body: JSON.stringify({ ids, patch }) })
      setSelected(new Set())
      setMsg(`Обновлено: ${ids.length}`)
      await load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function toggleStore(uuid: string) {
    if (!edit) return
    const set = new Set(edit.storeUuids ?? [])
    if (set.has(uuid)) set.delete(uuid)
    else set.add(uuid)
    setEdit({ ...edit, storeUuids: [...set] })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Товары"
        subtitle="Создание, правка, стакан, точки Эвотор"
        actions={
          <button type="button" onClick={openNew} className="rounded-xl bg-brand text-white px-4 py-2 text-sm font-medium">
            + Новый товар
          </button>
        }
      />
      <div className="flex flex-wrap gap-2">
        <input
          className="rounded-xl border border-line px-3 py-2 text-sm flex-1 min-w-[140px]"
          placeholder="Поиск"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {(
          [
            ['all', 'Все'],
            ['on', 'В продаже'],
            ['off', 'Скрыты'],
            ['cup', 'Стакан'],
            ['err', 'Ошибка sync'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`rounded-xl px-3 py-2 text-sm border ${filter === k ? 'bg-brand text-white border-brand' : 'bg-white border-line'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {selected.size > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="text-ink-secondary">Выбрано: {selected.size}</span>
          <button type="button" className="underline" onClick={() => bulk({ available: false })}>
            Скрыть
          </button>
          <button type="button" className="underline" onClick={() => bulk({ available: true })}>
            В продажу
          </button>
          <button type="button" className="underline" onClick={() => bulk({ countsAsCup: true })}>
            Стакан = да
          </button>
          <button type="button" className="underline" onClick={() => bulk({ countsAsCup: false })}>
            Стакан = нет
          </button>
        </div>
      )}
      {err ? <p className="text-red-600 text-sm">{err}</p> : null}
      {msg ? <p className="text-emerald-700 text-sm">{msg}</p> : null}
      {!filtered.length ? (
        <EmptyState title="Нет товаров" description="Нажмите «Новый товар»" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line">
                <th className="p-3 w-8" />
                <th>Название</th>
                <th className="text-right">Цена</th>
                <th className="text-center">Продажа</th>
                <th className="text-center">Стакан</th>
                <th className="pr-3">Sync</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const errL = p.evotorLinks?.find((l) => l.lastError)
                return (
                  <tr key={p.id} className="border-b border-line/50 hover:bg-slate-50">
                    <td className="p-3">
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                    </td>
                    <td>
                      <button type="button" className="text-brand font-medium text-left" onClick={() => openEdit(p)}>
                        {p.name}
                      </button>
                      <div className="text-xs text-ink-tertiary">#{p.id}</div>
                    </td>
                    <td className="text-right tabular-nums">{formatMoneyRub(p.price)}</td>
                    <td className="text-center">{p.available ? '✓' : '—'}</td>
                    <td className="text-center">{p.countsAsCup ? '✓' : '—'}</td>
                    <td className="pr-3">
                      {errL ? <Badge level="bad">err</Badge> : <Badge level="ok">ok</Badge>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-tertiary">
        <Link className="text-brand" to="/menu/groups">
          Группы
        </Link>
        {' · '}
        <Link className="text-brand" to="/menu/modifiers">
          Добавки
        </Link>
      </p>

      {edit && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-4 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-3">
            <h3 className="font-semibold text-lg">{edit.id ? `Товар #${edit.id}` : 'Новый товар'}</h3>
            <label className="block text-xs text-ink-secondary">Название</label>
            <input
              className="w-full border border-line rounded-xl px-3 py-2"
              value={edit.name || ''}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
            <label className="block text-xs text-ink-secondary">Цена ₽</label>
            <input
              type="number"
              step="0.01"
              className="w-full border border-line rounded-xl px-3 py-2"
              value={edit.price ?? 0}
              onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })}
            />
            <label className="block text-xs text-ink-secondary">Группа</label>
            <select
              className="w-full border border-line rounded-xl px-3 py-2"
              value={edit.categoryId ?? ''}
              onChange={(e) => setEdit({ ...edit, categoryId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">— без группы —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="block text-xs text-ink-secondary">Схема добавок</label>
            <select
              className="w-full border border-line rounded-xl px-3 py-2"
              value={edit.modifierSchemeId ?? ''}
              onChange={(e) => setEdit({ ...edit, modifierSchemeId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">— нет —</option>
              {schemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <label className="block text-xs text-ink-secondary">Рецепт / описание</label>
            <textarea
              className="w-full border border-line rounded-xl px-3 py-2 min-h-[80px]"
              value={edit.recipeText || ''}
              onChange={(e) => setEdit({ ...edit, recipeText: e.target.value, description: e.target.value })}
            />
            <label className="block text-xs text-ink-secondary">URL фото</label>
            <input
              className="w-full border border-line rounded-xl px-3 py-2"
              value={edit.imageUrl || ''}
              onChange={(e) => setEdit({ ...edit, imageUrl: e.target.value })}
              placeholder="https://…"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-ink-secondary">НДС / tax</label>
                <input
                  className="w-full border border-line rounded-xl px-3 py-2"
                  value={edit.tax || 'NO_VAT'}
                  onChange={(e) => setEdit({ ...edit, tax: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs text-ink-secondary">Ед. изм.</label>
                <input
                  className="w-full border border-line rounded-xl px-3 py-2"
                  value={edit.measure || 'шт'}
                  onChange={(e) => setEdit({ ...edit, measure: e.target.value })}
                />
              </div>
            </div>
            <label className="block text-xs text-ink-secondary">Себестоимость (копейки)</label>
            <input
              type="number"
              className="w-full border border-line rounded-xl px-3 py-2"
              value={edit.costPriceKopecks ?? 0}
              onChange={(e) => setEdit({ ...edit, costPriceKopecks: Number(e.target.value) })}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!edit.available}
                onChange={(e) => setEdit({ ...edit, available: e.target.checked })}
              />
              В продаже
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!edit.countsAsCup}
                onChange={(e) => setEdit({ ...edit, countsAsCup: e.target.checked })}
              />
              Считается стаканом (6-й бесплатно)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!edit.freeEligible}
                onChange={(e) => setEdit({ ...edit, freeEligible: e.target.checked })}
              />
              Можно дарить как бесплатный
            </label>
            <div>
              <div className="text-xs text-ink-secondary mb-1">Точки Эвотор (sync)</div>
              <div className="space-y-1 max-h-32 overflow-y-auto border border-line rounded-xl p-2">
                {stores.map((s) => {
                  const uuid = s.storeUuid || s.store_uuid || ''
                  return (
                    <label key={uuid} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={(edit.storeUuids ?? []).includes(uuid)}
                        onChange={() => toggleStore(uuid)}
                      />
                      {s.name}
                    </label>
                  )
                })}
                {!stores.length ? <p className="text-xs text-ink-tertiary">Нет магазинов — обновите Эвотор</p> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                disabled={busy}
                onClick={save}
                className="rounded-xl bg-brand text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {busy ? '…' : 'Сохранить'}
              </button>
              <button type="button" onClick={() => setEdit(null)} className="rounded-xl border border-line px-4 py-2 text-sm">
                Отмена
              </button>
              {edit.id ? (
                <button type="button" onClick={() => remove(edit.id!)} className="rounded-xl border border-red-200 text-red-700 px-4 py-2 text-sm ml-auto">
                  Скрыть
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
