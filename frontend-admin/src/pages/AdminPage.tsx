/**
 * Admin UI per TZ-ADMIN-EVOTOR-SYNC-FULL:
 * Overview | Points (RO) | Products (assignments) | Groups | Sales | Evotor settings
 * No manual stores, no loyalty, no enroll as primary flow.
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

type Tab = 'overview' | 'stores' | 'products' | 'categories' | 'sales' | 'evotor'

type Overview = {
  stores: number
  products: number
  linked: number
  pending: number
  errors: number
  lastPollAt: number | null
}

type EvotorStore = { uuid: string; name: string; address?: string | null }
type Product = {
  id: number
  name: string
  price: number
  available: number
  categoryId?: number | null
  description?: string | null
  imageUrl?: string | null
  recipeText?: string | null
  tax?: string | null
  measure?: string | null
  evotorLinks?: { storeUuid: string; evotorUuid: string | null; enabled?: number; lastError?: string | null }[]
}
type Category = { id: number; name: string; sortOrder?: number }

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'stores', label: 'Точки' },
  { id: 'products', label: 'Товары' },
  { id: 'categories', label: 'Группы' },
  { id: 'sales', label: 'Продажи' },
  { id: 'evotor', label: 'Эвотор' },
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
  const [sales, setSales] = useState<{ lines: any[]; lastPollAt: number | null; sellDocs: number } | null>(null)
  const [edit, setEdit] = useState<Partial<Product> & { storeUuids: string[] } | null>(null)
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
      const [ov, st, pr, cat] = await Promise.all([
        adminFetch<Overview>('/overview', token).catch(() => null),
        adminFetch<{ stores: EvotorStore[] }>('/evotor/stores', token).catch(() => ({ stores: [] })),
        adminFetch<{ products: Product[] }>('/products', token),
        adminFetch<{ categories: Category[] }>('/categories', token).catch(() => ({ categories: [] })),
      ])
      if (ov) setOverview(ov)
      setStores(st.stores || [])
      setProducts((pr.products || []).filter((p) => true))
      setCategories(cat.categories || [])
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
      <nav className="flex gap-1 overflow-x-auto bg-white border-b px-2 py-2">
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
      <main className="max-w-3xl mx-auto p-4 space-y-4">
        {err && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{err}</div>}

        {tab === 'overview' && overview && (
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Точки Эвотор', overview.stores],
              ['Товары 6.7', overview.products],
              ['Синхронизировано', overview.linked],
              ['Ждут CREATE', overview.pending],
              ['Ошибки sync', overview.errors],
            ].map(([k, v]) => (
              <div key={String(k)} className="bg-white rounded-xl p-4 shadow-sm">
                <div className="text-xs text-slate-500">{k}</div>
                <div className="text-2xl font-bold">{v as number}</div>
              </div>
            ))}
            <div className="bg-white rounded-xl p-4 shadow-sm col-span-2 text-sm text-slate-600">
              Последний poll:{' '}
              {overview.lastPollAt ? new Date(overview.lastPollAt).toLocaleString('ru-RU') : 'ещё не было'}
            </div>
            <button className="col-span-2 border rounded-lg py-2" onClick={() => void load()}>
              Обновить
            </button>
          </div>
        )}

        {tab === 'stores' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="font-semibold">Торговые точки из Эвотор</h2>
              <button
                className="text-sm bg-[#002FA7] text-white px-3 py-1.5 rounded-lg"
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
                Обновить из Эвотор
              </button>
            </div>
            <p className="text-xs text-slate-500">Точки не создаём и не переименовываем — только из Cloud.</p>
            {stores.map((s) => (
              <div key={s.uuid} className="bg-white rounded-xl p-3 shadow-sm">
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-slate-500 font-mono">{s.uuid}</div>
                {s.address && <div className="text-xs text-slate-600">{s.address}</div>}
              </div>
            ))}
            {!stores.length && <p className="text-sm text-slate-500">Нет точек. Проверьте токен и sync.</p>}
          </div>
        )}

        {tab === 'categories' && (
          <div className="space-y-3">
            <h2 className="font-semibold">Группы меню 6.7</h2>
            {categories.map((c) => (
              <div key={c.id} className="bg-white rounded-xl p-3 shadow-sm">
                #{c.id} · {c.name}
              </div>
            ))}
            <p className="text-xs text-slate-500">Создание/редактирование групп — через API categories (как раньше) или расширим UI позже.</p>
          </div>
        )}

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
                    Sync → Эвотор
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
                      disabled={busy || !edit.name}
                      onClick={async () => {
                        setBusy(true)
                        setErr('')
                        try {
                          const body = {
                            id: edit.id,
                            name: edit.name,
                            price: edit.price,
                            available: true,
                            description: edit.description,
                            recipeText: edit.recipeText,
                            tax: edit.tax || 'NO_VAT',
                            measure: edit.measure || 'шт',
                          }
                          await adminFetch('/products', token, { method: 'POST', body: JSON.stringify(body) })
                          // reload to get id if new
                          const pr = await adminFetch<{ products: Product[] }>('/products', token)
                          const list = pr.products || []
                          const found =
                            edit.id != null
                              ? list.find((x) => x.id === edit.id)
                              : list.filter((x) => x.name === edit.name).sort((a, b) => b.id - a.id)[0]
                          if (found) {
                            await adminFetch(`/products/${found.id}/stores`, token, {
                              method: 'PUT',
                              body: JSON.stringify({ storeUuids: edit.storeUuids || [] }),
                            })
                            await adminFetch(`/products/${found.id}/sync`, token, { method: 'POST', body: '{}' })
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
            {!sales?.lines?.length && <p className="text-sm text-slate-500">Нет строк за сутки (нужен poll документов).</p>}
            <button className="border rounded-lg py-2 w-full" onClick={() => void loadSales()}>
              Обновить
            </button>
          </div>
        )}

        {tab === 'evotor' && (
          <div className="space-y-3">
            <h2 className="font-semibold">Настройки Эвотор</h2>
            <p className="text-sm text-slate-600">Токен только на сервере (EVOTOR_API_TOKEN). Здесь — действия sync/poll.</p>
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
