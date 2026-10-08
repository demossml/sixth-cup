/**
 * Admin: groups (categories) CRUD + toppings (modifiers) + schemes + product links.
 * Backend routes already exist: /categories, /modifiers, /modifier-schemes, /products
 */
import { useCallback, useEffect, useState } from 'react'

const API = (import.meta as any).env?.VITE_API_URL ?? ''

async function adminFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/api/admin${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': token,
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error || res.statusText)
  }
  return res.json() as Promise<T>
}

type Tab = 'overview' | 'stores' | 'products' | 'categories' | 'modifiers' | 'sales' | 'evotor'

type Overview = {
  stores: number
  products: number
  linked: number
  pending: number
  errors: number
  lastPollAt: number | null
}

type EvotorStore = { uuid: string; name: string; address?: string | null; syncEnabled?: boolean }
type Product = {
  id: number
  name: string
  price: number
  available: number
  categoryId?: number | null
  categoryName?: string | null
  description?: string | null
  imageUrl?: string | null
  recipeText?: string | null
  tax?: string | null
  measure?: string | null
  modifierSchemeId?: number | null
  evotorLinks?: { storeUuid: string; evotorUuid: string | null; enabled?: number; lastError?: string | null }[]
}
type Category = { id: number; name: string; sortOrder?: number; available?: number }
type Modifier = {
  id: number
  name: string
  price: number
  groupKey: string
  available: number
  sortOrder?: number
}
type Scheme = {
  id: number
  name: string
  items: { schemeId: number; modifierId: number; required?: number; maxCount?: number }[]
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'stores', label: 'Точки' },
  { id: 'products', label: 'Товары' },
  { id: 'categories', label: 'Группы' },
  { id: 'modifiers', label: 'Добавки' },
  { id: 'sales', label: 'Продажи' },
  { id: 'evotor', label: 'Эвотор' },
]

const GROUP_KEYS = [
  { id: 'syrup', label: 'Сироп' },
  { id: 'topping', label: 'Топпинг' },
  { id: 'milk', label: 'Молоко' },
  { id: 'other', label: 'Другое' },
]

export default function AdminPage() {
  const [token, setToken] = useState(() => localStorage.getItem('admin_token') || '')
  const [authed, setAuthed] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [err, setErr] = useState('')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [stores, setStores] = useState<EvotorStore[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [modifiers, setModifiers] = useState<Modifier[]>([])
  const [schemes, setSchemes] = useState<Scheme[]>([])
  const [sales, setSales] = useState<{ lines: any[]; lastPollAt: number | null; sellDocs: number } | null>(null)
  const [edit, setEdit] = useState<(Partial<Product> & { storeUuids: string[] }) | null>(null)
  const [catEdit, setCatEdit] = useState<Partial<Category> | null>(null)
  const [modEdit, setModEdit] = useState<Partial<Modifier> | null>(null)
  const [schemeEdit, setSchemeEdit] = useState<{ id?: number; name: string; modifierIds: number[]; copyFromId?: number } | null>(null)
  const [busy, setBusy] = useState(false)

  const login = async () => {
    setErr('')
    try {
      await adminFetch('/overview', token)
      localStorage.setItem('admin_token', token)
      setAuthed(true)
    } catch (e: any) {
      setErr(e.message || 'Неверный токен')
    }
  }

  const load = useCallback(async () => {
    if (!token) return
    setErr('')
    try {
      const [ov, st, pr, cat, mod, sch] = await Promise.all([
        adminFetch<Overview>('/overview', token).catch(() => null),
        adminFetch<{ stores: EvotorStore[] }>('/evotor/stores', token).catch(() => ({ stores: [] })),
        adminFetch<{ products: Product[] }>('/products', token),
        adminFetch<{ categories: Category[] }>('/categories', token).catch(() => ({ categories: [] })),
        adminFetch<{ modifiers: Modifier[] }>('/modifiers', token).catch(() => ({ modifiers: [] })),
        adminFetch<{ schemes: Scheme[] }>('/modifier-schemes', token).catch(() => ({ schemes: [] })),
      ])
      if (ov) setOverview(ov)
      setStores(st.stores || [])
      setProducts(pr.products || [])
      setCategories(cat.categories || [])
      setModifiers(mod.modifiers || [])
      setSchemes(sch.schemes || [])
    } catch (e: any) {
      setErr(e.message)
    }
  }, [token])

  useEffect(() => {
    if (authed) void load()
  }, [authed, load])

  const loadSales = async () => {
    try {
      const s = await adminFetch<{ lines: any[]; lastPollAt: number | null; sellDocs: number }>('/sales/summary', token)
      setSales(s)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <div className="w-full max-w-sm space-y-3 bg-white p-6 rounded-xl shadow">
          <h1 className="text-xl font-bold text-[#002FA7]">6.7 Coffee — админка</h1>
          <p className="text-sm text-slate-500">Токен владельца (ADMIN_TOKEN)</p>
          <input
            className="w-full border rounded-lg px-3 py-2"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="X-Admin-Token"
          />
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button className="w-full bg-[#002FA7] text-white rounded-lg py-2" onClick={() => void login()}>
            Войти
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-[#002FA7] text-white px-4 py-3 flex items-center justify-between">
        <div className="font-semibold">6.7 Coffee · Админ</div>
        <button
          className="text-sm opacity-80"
          onClick={() => {
            localStorage.removeItem('admin_token')
            setAuthed(false)
          }}
        >
          Выйти
        </button>
      </header>

      <nav className="flex gap-1 px-2 py-2 overflow-x-auto bg-white border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap ${tab === t.id ? 'bg-[#002FA7] text-white' : 'bg-slate-100'}`}
            onClick={() => {
              setTab(t.id)
              if (t.id === 'sales') void loadSales()
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="p-4 max-w-3xl mx-auto space-y-4">
        {err && <p className="text-sm text-red-600 bg-red-50 p-2 rounded-lg">{err}</p>}

        {tab === 'overview' && overview && (
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Точки Эвотор', overview.stores],
              ['Товары 6.7', overview.products],
              ['С uuid', overview.linked],
              ['Ожидают sync', overview.pending],
              ['Ошибки sync', overview.errors],
            ].map(([k, v]) => (
              <div key={String(k)} className="bg-white rounded-xl p-3 shadow-sm">
                <div className="text-xs text-slate-500">{k}</div>
                <div className="text-2xl font-semibold">{v}</div>
              </div>
            ))}
            <p className="col-span-2 text-xs text-slate-500">
              Последний poll: {overview.lastPollAt ? new Date(overview.lastPollAt).toLocaleString('ru-RU') : '—'}
            </p>
            <button className="col-span-2 border rounded-lg py-2" onClick={() => void load()}>
              Обновить
            </button>
          </div>
        )}

        {tab === 'stores' && (
          <div className="space-y-3">
            <h2 className="font-semibold">Торговые точки (Эвотор)</h2>
            <p className="text-xs text-slate-500">
              Список из Cloud. Галочка «Синхронизировать» — только такие магазины в pull/push.
              Без галочки чужие SKU в 6.7 не тянутся.
            </p>
            {stores.map((s) => (
              <div key={s.uuid} className="bg-white rounded-xl p-3 shadow-sm flex gap-3 items-start">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={!!s.syncEnabled}
                  disabled={busy}
                  onChange={async (e) => {
                    const on = e.target.checked
                    setBusy(true)
                    try {
                      await adminFetch(`/evotor/stores/${encodeURIComponent(s.uuid)}`, token, {
                        method: 'PATCH',
                        body: JSON.stringify({ syncEnabled: on }),
                      })
                      setStores((prev) => prev.map((x) => (x.uuid === s.uuid ? { ...x, syncEnabled: on } : x)))
                    } catch (err: any) {
                      setErr(err.message)
                    } finally {
                      setBusy(false)
                    }
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-slate-500 font-mono truncate">{s.uuid}</div>
                  {s.address && <div className="text-xs text-slate-500">{s.address}</div>}
                  <div className="text-xs mt-1">{s.syncEnabled ? 'sync включён' : 'sync выключен'}</div>
                  {s.syncEnabled && (
                    <button
                      type="button"
                      className="mt-2 text-xs border border-red-300 text-red-700 rounded-lg px-2 py-1"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          !confirm(
                            'Очистить ВСЮ номенклатуру в облаке Эвотор для «' +
                              (s.name || s.uuid) +
                              '» и залить заново из 6.7?\n\nКак очистка в 1С. После: на кассе Ещё → Обмен → Загрузить в терминал.',
                          )
                        )
                          return
                        setBusy(true)
                        setErr('')
                        try {
                          const r = await adminFetch<{
                            listed: number
                            deleted: number
                            pushed: number
                            deleteErrors?: string[]
                            pushErrors?: string[]
                          }>(`/evotor/stores/${encodeURIComponent(s.uuid)}/wipe-catalog`, token, {
                            method: 'POST',
                            body: '{}',
                          })
                          const delErr = r.deleteErrors?.length
                            ? '\nУдаление: ' + r.deleteErrors.slice(0, 3).join('; ')
                            : ''
                          const pushErr = r.pushErrors?.length
                            ? '\nЗаливка: ' + r.pushErrors.slice(0, 3).join('; ')
                            : ''
                          alert(
                            'Облако: было ' +
                              r.listed +
                              ', удалено ' +
                              r.deleted +
                              ', залито ' +
                              r.pushed +
                              delErr +
                              pushErr,
                          )
                          await load()
                        } catch (err: any) {
                          setErr(err.message || String(err))
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      Очистить Эвотор и залить заново
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!stores.length && <p className="text-sm text-slate-500">Нет точек — сначала обновите список (Эвотор → Sync после галочек).</p>}
          </div>
        )}

        {/* ——— ГРУППЫ ——— */}
        {tab === 'categories' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="font-semibold">Группы меню</h2>
              <button
                className="text-sm bg-[#002FA7] text-white px-3 py-1.5 rounded-lg"
                onClick={() => setCatEdit({ name: '', sortOrder: categories.length, available: 1 })}
              >
                + Группа
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Группы 6.7 → при sync товара уходит parentUuid группы в Эвотор (если настроен push групп).
            </p>
            {categories.map((c) => (
              <div key={c.id} className="bg-white rounded-xl p-3 shadow-sm flex justify-between items-center gap-2">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-slate-500">#{c.id} · порядок {c.sortOrder ?? 0}</div>
                </div>
                <div className="flex gap-2">
                  <button className="text-xs border rounded px-2 py-1" onClick={() => setCatEdit({ ...c })}>
                    Изменить
                  </button>
                  <button
                    className="text-xs border border-red-200 text-red-700 rounded px-2 py-1"
                    disabled={busy}
                    onClick={async () => {
                      if (!confirm(`Удалить группу «${c.name}»?`)) return
                      setBusy(true)
                      try {
                        await adminFetch(`/categories/${c.id}`, token, { method: 'DELETE' })
                        await load()
                      } catch (e: any) {
                        setErr(e.message)
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ))}
            {!categories.length && <p className="text-sm text-slate-500">Пока нет групп — создайте «Кофе», «Выпечка»…</p>}

            {catEdit && (
              <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl p-4 w-full max-w-md space-y-3">
                  <h3 className="font-semibold">{catEdit.id ? `Группа #${catEdit.id}` : 'Новая группа'}</h3>
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="Название"
                    value={catEdit.name || ''}
                    onChange={(e) => setCatEdit({ ...catEdit, name: e.target.value })}
                  />
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    type="number"
                    placeholder="Порядок"
                    value={catEdit.sortOrder ?? 0}
                    onChange={(e) => setCatEdit({ ...catEdit, sortOrder: Number(e.target.value) })}
                  />
                  <div className="flex gap-2">
                    <button className="flex-1 border rounded-lg py-2" onClick={() => setCatEdit(null)}>
                      Отмена
                    </button>
                    <button
                      className="flex-1 bg-[#002FA7] text-white rounded-lg py-2"
                      disabled={busy || !catEdit.name?.trim()}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          if (catEdit.id) {
                            await adminFetch(`/categories/${catEdit.id}`, token, {
                              method: 'PATCH',
                              body: JSON.stringify({
                                name: catEdit.name,
                                sortOrder: catEdit.sortOrder ?? 0,
                                available: catEdit.available !== 0,
                              }),
                            })
                          } else {
                            await adminFetch('/categories', token, {
                              method: 'POST',
                              body: JSON.stringify({
                                name: catEdit.name,
                                sortOrder: catEdit.sortOrder ?? 0,
                                available: true,
                              }),
                            })
                          }
                          setCatEdit(null)
                          await load()
                        } catch (e: any) {
                          setErr(e.message)
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      Сохранить
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ——— ДОБАВКИ / ТОПИНГИ ——— */}
        {tab === 'modifiers' && (
          <div className="space-y-6">
            <section className="space-y-3">
              <div className="flex justify-between items-center">
                <h2 className="font-semibold">Справочник добавок</h2>
                <button
                  className="text-sm bg-[#002FA7] text-white px-3 py-1.5 rounded-lg"
                  onClick={() => setModEdit({ name: '', price: 0, groupKey: 'syrup', available: 1, sortOrder: 0 })}
                >
                  + Добавка
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Сиропы, молоко, топпинги. Набор к напитку задаётся схемами ниже. В ProductExtra при sync уходит список для кассы.
              </p>
              {modifiers.map((m) => (
                <div key={m.id} className="bg-white rounded-xl p-3 shadow-sm flex justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      {m.name} · {m.price} ₽
                    </div>
                    <div className="text-xs text-slate-500">
                      {GROUP_KEYS.find((g) => g.id === m.groupKey)?.label || m.groupKey}
                      {m.available ? '' : ' · выкл'}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="text-xs border rounded px-2 py-1" onClick={() => setModEdit({ ...m })}>
                      Изменить
                    </button>
                    <button
                      className="text-xs border border-red-200 text-red-700 rounded px-2 py-1"
                      disabled={busy}
                      onClick={async () => {
                        if (!confirm(`Удалить «${m.name}»?`)) return
                        setBusy(true)
                        try {
                          await adminFetch(`/modifiers/${m.id}`, token, { method: 'DELETE' })
                          await load()
                        } catch (e: any) {
                          setErr(e.message)
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
            </section>

            <section className="space-y-3">
              <div className="flex justify-between items-center">
                <h2 className="font-semibold">Наборы (схемы) к напиткам</h2>
                <button
                  className="text-sm bg-[#002FA7] text-white px-3 py-1.5 rounded-lg"
                  onClick={() => setSchemeEdit({ name: '', modifierIds: [] })}
                >
                  + Набор
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Пример: «Все сиропы» → привязать к RAF. «Сиропы без мёда» → к капучино. Можно скопировать набор.
              </p>
              {schemes.map((s) => (
                <div key={s.id} className="bg-white rounded-xl p-3 shadow-sm space-y-1">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-slate-500">
                    {(s.items || [])
                      .map((i) => modifiers.find((m) => m.id === i.modifierId)?.name || `#${i.modifierId}`)
                      .join(', ') || 'пусто'}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      className="text-xs border rounded px-2 py-1"
                      onClick={() =>
                        setSchemeEdit({
                          id: s.id,
                          name: s.name,
                          modifierIds: (s.items || []).map((i) => i.modifierId),
                        })
                      }
                    >
                      Изменить
                    </button>
                    <button
                      className="text-xs border rounded px-2 py-1"
                      onClick={() =>
                        setSchemeEdit({
                          name: `${s.name} (копия)`,
                          modifierIds: (s.items || []).map((i) => i.modifierId),
                          copyFromId: s.id,
                        })
                      }
                    >
                      Копировать
                    </button>
                    <button
                      className="text-xs border border-red-200 text-red-700 rounded px-2 py-1"
                      disabled={busy}
                      onClick={async () => {
                        if (!confirm(`Удалить набор «${s.name}»?`)) return
                        setBusy(true)
                        try {
                          await adminFetch(`/modifier-schemes/${s.id}`, token, { method: 'DELETE' })
                          await load()
                        } catch (e: any) {
                          setErr(e.message)
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
            </section>

            {modEdit && (
              <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl p-4 w-full max-w-md space-y-3">
                  <h3 className="font-semibold">{modEdit.id ? `Добавка #${modEdit.id}` : 'Новая добавка'}</h3>
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="Название"
                    value={modEdit.name || ''}
                    onChange={(e) => setModEdit({ ...modEdit, name: e.target.value })}
                  />
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    type="number"
                    placeholder="Цена ₽"
                    value={modEdit.price ?? 0}
                    onChange={(e) => setModEdit({ ...modEdit, price: Number(e.target.value) })}
                  />
                  <select
                    className="w-full border rounded-lg px-3 py-2"
                    value={modEdit.groupKey || 'other'}
                    onChange={(e) => setModEdit({ ...modEdit, groupKey: e.target.value })}
                  >
                    {GROUP_KEYS.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={modEdit.available !== 0}
                      onChange={(e) => setModEdit({ ...modEdit, available: e.target.checked ? 1 : 0 })}
                    />
                    Доступна
                  </label>
                  <div className="flex gap-2">
                    <button className="flex-1 border rounded-lg py-2" onClick={() => setModEdit(null)}>
                      Отмена
                    </button>
                    <button
                      className="flex-1 bg-[#002FA7] text-white rounded-lg py-2"
                      disabled={busy || !modEdit.name?.trim()}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          await adminFetch('/modifiers', token, {
                            method: 'POST',
                            body: JSON.stringify({
                              id: modEdit.id,
                              name: modEdit.name,
                              price: modEdit.price ?? 0,
                              groupKey: modEdit.groupKey || 'other',
                              available: modEdit.available !== 0,
                              sortOrder: modEdit.sortOrder ?? 0,
                            }),
                          })
                          setModEdit(null)
                          await load()
                        } catch (e: any) {
                          setErr(e.message)
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      Сохранить
                    </button>
                  </div>
                </div>
              </div>
            )}

            {schemeEdit && (
              <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl p-4 w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto">
                  <h3 className="font-semibold">{schemeEdit.id ? `Набор #${schemeEdit.id}` : 'Новый набор'}</h3>
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="Название набора"
                    value={schemeEdit.name}
                    onChange={(e) => setSchemeEdit({ ...schemeEdit, name: e.target.value })}
                  />
                  <div className="text-sm font-medium">Состав</div>
                  <div className="space-y-1 max-h-48 overflow-y-auto border rounded-lg p-2">
                    {modifiers.map((m) => {
                      const checked = schemeEdit.modifierIds.includes(m.id)
                      return (
                        <label key={m.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const set = new Set(schemeEdit.modifierIds)
                              if (checked) set.delete(m.id)
                              else set.add(m.id)
                              setSchemeEdit({ ...schemeEdit, modifierIds: [...set] })
                            }}
                          />
                          {m.name} ({m.price} ₽)
                        </label>
                      )
                    })}
                    {!modifiers.length && <p className="text-xs text-slate-500">Сначала создайте добавки</p>}
                  </div>
                  <div className="flex gap-2">
                    <button className="flex-1 border rounded-lg py-2" onClick={() => setSchemeEdit(null)}>
                      Отмена
                    </button>
                    <button
                      className="flex-1 bg-[#002FA7] text-white rounded-lg py-2"
                      disabled={busy || !schemeEdit.name.trim()}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          await adminFetch('/modifier-schemes', token, {
                            method: 'POST',
                            body: JSON.stringify({
                              id: schemeEdit.id,
                              name: schemeEdit.name,
                              modifierIds: schemeEdit.modifierIds,
                              copyFromSchemeId: schemeEdit.copyFromId,
                            }),
                          })
                          setSchemeEdit(null)
                          await load()
                        } catch (e: any) {
                          setErr(e.message)
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      Сохранить
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ——— ТОВАРЫ ——— */}
        {tab === 'products' && (
          <div className="space-y-3">
            <div className="flex justify-between">
              <h2 className="font-semibold">Товары 6.7</h2>
              <button
                className="text-sm bg-[#002FA7] text-white px-3 py-1.5 rounded-lg"
                onClick={() =>
                  setEdit({
                    name: '',
                    price: 0,
                    available: 1,
                    storeUuids: [],
                    tax: 'NO_VAT',
                    measure: 'шт',
                    categoryId: null,
                    modifierSchemeId: null,
                  })
                }
              >
                + Товар
              </button>
            </div>
            {products.map((p) => (
              <div key={p.id} className="bg-white rounded-xl p-3 shadow-sm space-y-1">
                <div className="font-medium">
                  {p.name} · {p.price} ₽
                </div>
                <div className="text-xs text-slate-500">
                  {p.categoryName || (p.categoryId ? `группа #${p.categoryId}` : 'без группы')}
                  {p.modifierSchemeId
                    ? ` · набор #${p.modifierSchemeId} (${schemes.find((s) => s.id === p.modifierSchemeId)?.name || '…'})`
                    : ' · без добавок'}
                </div>
                <div className="text-xs text-slate-500">
                  {(p.evotorLinks || [])
                    .map((l) => `${l.storeUuid.slice(0, 8)}… → ${l.evotorUuid ? l.evotorUuid.slice(0, 8) + '…' : 'нет uuid'}`)
                    .join(' · ') || 'не назначен на точки'}
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    className="text-xs border rounded px-2 py-1"
                    onClick={() =>
                      setEdit({
                        ...p,
                        storeUuids: (p.evotorLinks || []).filter((l) => l.enabled !== 0).map((l) => l.storeUuid),
                      })
                    }
                  >
                    Изменить
                  </button>
                  <button
                    className="text-xs border rounded px-2 py-1"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await adminFetch(`/products/${p.id}/sync`, token, { method: 'POST', body: '{}' })
                        await load()
                      } catch (e: any) {
                        setErr(e.message)
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    Sync
                  </button>
                  <button
                    className="text-xs border border-red-200 text-red-700 rounded px-2 py-1"
                    disabled={busy}
                    onClick={async () => {
                      if (!confirm(`Удалить «${p.name}»?`)) return
                      setBusy(true)
                      try {
                        await adminFetch(`/products/${p.id}`, token, { method: 'DELETE' })
                        await load()
                      } catch (e: any) {
                        setErr(e.message)
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ))}

            {edit && (
              <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl p-4 w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto">
                  <h3 className="font-semibold">{edit.id ? `Товар #${edit.id}` : 'Новый товар'}</h3>
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="Название"
                    value={edit.name || ''}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  />
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    type="number"
                    placeholder="Цена ₽"
                    value={edit.price ?? 0}
                    onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })}
                  />
                  <label className="text-xs text-slate-500">Группа</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2"
                    value={edit.categoryId ?? ''}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        categoryId: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  >
                    <option value="">— без группы —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <label className="text-xs text-slate-500">Набор добавок (топпинги)</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2"
                    value={edit.modifierSchemeId ?? ''}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        modifierSchemeId: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  >
                    <option value="">— без добавок —</option>
                    {schemes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <textarea
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="Описание / рецепт"
                    value={edit.recipeText || edit.description || ''}
                    onChange={(e) => setEdit({ ...edit, recipeText: e.target.value, description: e.target.value })}
                  />
                  <div className="text-sm font-medium">Где продаётся</div>
                  <div className="space-y-1 max-h-40 overflow-y-auto border rounded-lg p-2">
                    {stores.map((s) => {
                      const checked = (edit.storeUuids || []).includes(s.uuid)
                      return (
                        <label key={s.uuid} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const set = new Set(edit.storeUuids || [])
                              if (checked) set.delete(s.uuid)
                              else set.add(s.uuid)
                              setEdit({ ...edit, storeUuids: [...set] })
                            }}
                          />
                          {s.name}
                        </label>
                      )
                    })}
                    {!stores.length && <p className="text-xs text-slate-500">Сначала обновите точки из Эвотор</p>}
                  </div>
                  <div className="flex gap-2">
                    <button className="flex-1 border rounded-lg py-2" onClick={() => setEdit(null)}>
                      Отмена
                    </button>
                    <button
                      className="flex-1 bg-[#002FA7] text-white rounded-lg py-2"
                      disabled={busy || !edit.name?.trim()}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          const body = {
                            id: edit.id,
                            name: edit.name,
                            price: edit.price ?? 0,
                            available: edit.available !== 0,
                            categoryId: edit.categoryId ?? null,
                            modifierSchemeId: edit.modifierSchemeId ?? null,
                            description: edit.description ?? null,
                            recipeText: edit.recipeText ?? null,
                            imageUrl: edit.imageUrl ?? null,
                            tax: edit.tax || 'NO_VAT',
                            measure: edit.measure || 'шт',
                            storeUuids: edit.storeUuids || [],
                          }
                          const saved = await adminFetch<{ product?: { id: number }; id?: number }>('/products', token, {
                            method: 'POST',
                            body: JSON.stringify(body),
                          })
                          const pid = saved.product?.id ?? saved.id ?? edit.id
                          if (pid && (edit.storeUuids || []).length) {
                            await adminFetch(`/products/${pid}/stores`, token, {
                              method: 'PUT',
                              body: JSON.stringify({ storeUuids: edit.storeUuids }),
                            }).catch(async () => {
                              await adminFetch(`/products/${pid}/sync`, token, { method: 'POST', body: '{}' })
                            })
                          }
                          setEdit(null)
                          await load()
                        } catch (e: any) {
                          setErr(e.message)
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      Сохранить + sync
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'sales' && (
          <div className="space-y-3">
            <h2 className="font-semibold">Продажи (24ч)</h2>
            <p className="text-xs text-slate-500">
              Документов SELL: {sales?.sellDocs ?? '—'} · poll:{' '}
              {sales?.lastPollAt ? new Date(sales.lastPollAt).toLocaleString('ru-RU') : '—'}
            </p>
            {(sales?.lines || []).map((l, i) => (
              <div key={i} className="bg-white rounded-xl p-3 text-sm shadow-sm">
                {l.storeUuid?.slice?.(0, 8)}… · {l.name} · ×{l.qty}
              </div>
            ))}
            {!sales?.lines?.length && <p className="text-sm text-slate-500">Нет строк за сутки.</p>}
            <button className="border rounded-lg py-2 w-full" onClick={() => void loadSales()}>
              Обновить
            </button>
          </div>
        )}

        {tab === 'evotor' && (
          <div className="space-y-3">
            <h2 className="font-semibold">Настройки Эвотор</h2>
            <p className="text-sm text-slate-600">Токен только на сервере (EVOTOR_API_TOKEN).</p>
            <button
              className="w-full bg-[#002FA7] text-white rounded-lg py-2"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await adminFetch('/evotor/sync', token, { method: 'POST', body: '{}' })
                  await load()
                } catch (e: any) {
                  setErr(e.message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              Sync магазины / каталог
            </button>
            <button
              className="w-full border rounded-lg py-2"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await adminFetch('/evotor/poll', token, { method: 'POST', body: '{}' })
                  await loadSales()
                } catch (e: any) {
                  setErr(e.message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              Poll документы (продажи)
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
