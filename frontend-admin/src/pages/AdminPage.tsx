import { useCallback, useEffect, useState } from 'react'

import { ChevronLeft, RefreshCw } from './icons'

const TOKEN_KEY = 'sc-admin-token'

async function adminFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    ...init,
    headers: {
      'X-Admin-Token': token,
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Ошибка ${res.status}`)
  return body as T
}

type Tab = 'overview' | 'orgs' | 'stores' | 'categories' | 'products' | 'modifiers' | 'schemes' | 'devices' | 'promos' | 'disputes'

type Stats = {
  users: number; receipts: number; receiptsToday: number; freeCups: number
  cashbackGranted: number; cashbackSpent: number; amountTotal: number
}

type Org = {
  id: number; name: string; legalName: string; inn: string; kpp: string | null
  taxRegime: string; vatRate: number; active: number
}
type Store = {
  id: number; name: string; address: string; organizationId: number | null; organizationName?: string
}
type Category = { id: number; name: string; sortOrder: number; available: number }
type Product = {
  id: number; name: string; price: number; icon: string; available: number
  description: string | null; categoryId: number | null; imageUrl: string | null
  sortOrder: number; categoryName?: string | null
  modifierSchemeId?: number | null; recipeText?: string | null
  recipeCostRub?: number | null; recipeSeconds?: number | null
}
type Modifier = { id: number; name: string; price: number; groupKey: string; available: number | boolean }
type Scheme = { id: number; name: string; items: { modifierId: number }[] }
type Device = {
  id: number; name: string; storeId: number; storeName: string; revoked: number
  enrollCode: string | null; enrolled: number
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'orgs', label: 'Юрлица' },
  { id: 'stores', label: 'Точки' },
  { id: 'categories', label: 'Категории' },
  { id: 'products', label: 'Товары' },
  { id: 'modifiers', label: 'Добавки' },
  { id: 'schemes', label: 'Схемы' },
  { id: 'devices', label: 'Кассы' },
  { id: 'promos', label: 'Акции' },
  { id: 'disputes', label: 'Конфликты' },
]

const TAX = [
  { v: 'usn_income', l: 'УСН доходы' },
  { v: 'usn_income_expense', l: 'УСН доходы-расходы' },
  { v: 'osn', l: 'ОСН' },
  { v: 'patent', l: 'Патент' },
]

export default function AdminPage() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '')
  const [input, setInput] = useState(token)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<Stats | null>(null)
  const [orgs, setOrgs] = useState<Org[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [modifiers, setModifiers] = useState<Modifier[]>([])
  const [schemes, setSchemes] = useState<Scheme[]>([])
  const [modForm, setModForm] = useState({ name: '', price: 40, groupKey: 'syrup' })
  const [schemeForm, setSchemeForm] = useState({ name: '', modifierIds: [] as number[], copyFrom: 0 })
  const [devices, setDevices] = useState<Device[]>([])
  const [promos, setPromos] = useState<Array<{ id: number; title: string; body: string; endsAt: number }>>([])
  const [disputes, setDisputes] = useState<Array<{ id: number; kind: string; details: string; created_at: number }>>([])

  // forms
  const [orgForm, setOrgForm] = useState({ name: '', legalName: '', inn: '', taxRegime: 'usn_income', vatRate: 0 })
  const [storeForm, setStoreForm] = useState({ name: '', address: '', organizationId: 0 })
  const [catForm, setCatForm] = useState({ name: '', sortOrder: 0 })
  const [prodForm, setProdForm] = useState({
    name: '', price: 0, icon: 'Coffee', categoryId: 0, description: '', imageUrl: '', sortOrder: 0,
    modifierSchemeId: 0, recipeText: '', recipeCostRub: 0, recipeSeconds: 0,
  })
  const [deviceName, setDeviceName] = useState('')
  const [deviceStoreId, setDeviceStoreId] = useState(0)
  const [newCode, setNewCode] = useState('')
  const [promoTitle, setPromoTitle] = useState('')
  const [promoBody, setPromoBody] = useState('')
  const [uploading, setUploading] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [productModalOpen, setProductModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (t: string) => {
    setError('')
    try {
      const [s, o, st, cat, p, mod, sch, d, pr, di] = await Promise.all([
        adminFetch<Stats>('/stats', t),
        adminFetch<{ organizations: Org[] }>('/organizations', t),
        adminFetch<{ stores: Store[] }>('/stores', t),
        adminFetch<{ categories: Category[] }>('/categories', t),
        adminFetch<{ products: Product[] }>('/products', t),
        adminFetch<{ modifiers: Modifier[] }>('/modifiers', t).catch(() => ({ modifiers: [] as Modifier[] })),
        adminFetch<{ schemes: Scheme[] }>('/modifier-schemes', t).catch(() => ({ schemes: [] as Scheme[] })),
        adminFetch<{ devices: Device[] }>('/devices', t),
        adminFetch<{ promos: typeof promos }>('/promos', t),
        adminFetch<{ disputes: typeof disputes }>('/disputes', t),
      ])
      setStats(s)
      setOrgs(o.organizations)
      setStores(st.stores)
      setCategories(cat.categories)
      setProducts(p.products)
      setModifiers(mod.modifiers)
      setSchemes(sch.schemes)
      setDevices(d.devices)
      setPromos(pr.promos)
      setDisputes(di.disputes)
      if (o.organizations[0] && !storeForm.organizationId) {
        setStoreForm((f) => ({ ...f, organizationId: o.organizations[0].id }))
      }
      if (st.stores[0] && !deviceStoreId) setDeviceStoreId(st.stores[0].id)
      if (cat.categories[0] && !prodForm.categoryId) {
        setProdForm((f) => ({ ...f, categoryId: cat.categories[0].id }))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
      setStats(null)
    }
  }, [])

  useEffect(() => {
    if (token) void load(token)
  }, [token, load])

  function login() {
    const t = input.trim()
    localStorage.setItem(TOKEN_KEY, t)
    setToken(t)
  }

  async function uploadImage(file: File) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/upload', {
        method: 'POST',
        headers: { 'X-Admin-Token': token },
        body: fd,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Upload failed')
      setProdForm((f) => ({ ...f, imageUrl: body.url as string }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload error')
    } finally {
      setUploading(false)
    }
  }

  if (!token || !stats) {
    return (
      <div className="max-w-[480px] mx-auto min-h-screen bg-page p-4">
        <img src="/logo-mark.png" alt="6.7 Coffee Admin" className="w-16 h-16 rounded-2xl mb-4 ring-2 ring-amber-400/50" />
        <p className="text-ink-tertiary text-sm mb-1">Кабинет владельца · не клиентское приложение</p>
        <h1 className="text-xl font-bold mb-4">6.7 Coffee · Админ</h1>
        <p className="text-xs text-amber-700 mb-3">Золотая альпака = admin. Белая на синем = приложение гостя.</p>
        {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
        <input className="input mb-3" placeholder="ADMIN_TOKEN" value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="button" className="btn-primary w-full" onClick={login}>Войти</button>
      </div>
    )
  }

  return (
    <div className="max-w-[480px] mx-auto min-h-screen bg-page pb-24">
      <div className="bg-brand text-white px-4 pt-10 pb-3">
        <div className="flex items-center justify-between">
          <span className="text-white/80 text-sm">Кабинет владельца</span>
          <button type="button" className="text-white/90" onClick={() => void load(token)} aria-label="Обновить">
            <RefreshCw size={18} />
          </button>
        </div>
        <h1 className="text-xl font-bold mt-2">Бизнес-панель</h1>
      </div>

      <div className="flex gap-1 overflow-x-auto px-2 py-2 bg-white border-b border-line sticky top-0 z-10">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${
              tab === t.id ? 'bg-brand text-white' : 'bg-page text-ink-secondary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-red-600 text-sm px-4 pt-2">{error}</p>}

      <div className="p-4 space-y-3">
        {tab === 'overview' && (
          <>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['Клиенты', stats.users],
              ['Чеки сегодня', stats.receiptsToday],
              ['Всего чеков', stats.receipts],
              ['Бесплатных', stats.freeCups],
              ['Кэшбэк +', `${stats.cashbackGranted} ₽`],
              ['Кэшбэк −', `${stats.cashbackSpent} ₽`],
              ['Сумма', `${stats.amountTotal} ₽`],
              ['Юрлица', orgs.length],
            ].map(([k, v]) => (
              <div key={String(k)} className="card !mb-0">
                <div className="text-ink-tertiary text-xs">{k}</div>
                <div className="text-lg font-bold text-ink">{v}</div>
              </div>
            ))}
          </div>
            <div className="card mt-4 space-y-2">
              <p className="text-sm font-semibold text-ink">Данные</p>
              <p className="text-xs text-ink-secondary">Обзор считает клиентов и чеки лояльности. Демо можно обнулить.</p>
              <button type="button" className="btn-ghost w-full text-sm" onClick={async () => {
                if (!confirm('Сбросить клиентов, чеки, кэшбэк, споры? Товары и точки останутся.')) return
                await adminFetch('/reset', token, { method: 'POST', body: JSON.stringify({ mode: 'loyalty', confirm: true }) })
                void load(token)
              }}>Сбросить лояльность (обзор → 0)</button>
              <button type="button" className="btn-ghost w-full text-sm text-red-700" onClick={async () => {
                if (!confirm('Удалить ВСЕ юрлица, точки, товары, кассы, акции?')) return
                if (!confirm('Точно полный сброс каталога?')) return
                await adminFetch('/reset', token, { method: 'POST', body: JSON.stringify({ mode: 'full', confirm: true }) })
                void load(token)
              }}>Полный сброс каталога + лояльности</button>
            </div>
          </>
        )}

        {tab === 'orgs' && (
          <>
            {orgs.map((o) => (
              <div key={o.id} className="card !mb-0 text-sm">
                <div className="flex justify-between gap-2">
                  <div className="font-semibold">{o.name} {!o.active ? '(выкл)' : ''}</div>
                  <button type="button" className="text-xs text-red-600 shrink-0" onClick={async () => {
                    if (!confirm('Удалить юрлицо? Только если нет точек.')) return
                    try {
                      await adminFetch(`/organizations/${o.id}`, token, { method: 'DELETE' })
                      void load(token)
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Не удалось удалить')
                    }
                  }}>Удалить</button>
                </div>
                <div className="text-ink-secondary">{o.legalName}</div>
                <div className="text-ink-tertiary">ИНН {o.inn} · {o.taxRegime} · НДС {o.vatRate}%</div>
              </div>
            ))}
            <div className="card space-y-2">
              <div className="font-semibold text-sm">Новое юрлицо</div>
              <input className="input" placeholder="Краткое имя" value={orgForm.name}
                onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })} />
              <input className="input" placeholder="Официальное наименование" value={orgForm.legalName}
                onChange={(e) => setOrgForm({ ...orgForm, legalName: e.target.value })} />
              <input className="input" placeholder="ИНН" value={orgForm.inn}
                onChange={(e) => setOrgForm({ ...orgForm, inn: e.target.value })} />
              <select className="input" value={orgForm.taxRegime}
                onChange={(e) => setOrgForm({ ...orgForm, taxRegime: e.target.value })}>
                {TAX.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
              <select className="input" value={orgForm.vatRate}
                onChange={(e) => setOrgForm({ ...orgForm, vatRate: Number(e.target.value) })}>
                <option value={0}>НДС 0%</option>
                <option value={10}>НДС 10%</option>
                <option value={20}>НДС 20%</option>
                <option value={22}>НДС 22%</option>
              </select>
              <button type="button" className="btn-primary w-full" onClick={async () => {
                await adminFetch('/organizations', token, {
                  method: 'POST',
                  body: JSON.stringify(orgForm),
                })
                setOrgForm({ name: '', legalName: '', inn: '', taxRegime: 'usn_income', vatRate: 0 })
                void load(token)
              }}>Создать</button>
            </div>
          </>
        )}

        {tab === 'stores' && (
          <>
            {stores.map((s) => (
              <div key={s.id} className="card !mb-0 text-sm">
                <div className="flex justify-between gap-2">
                  <div className="font-semibold">{s.name}</div>
                  <button type="button" className="text-xs text-red-600" onClick={async () => {
                    if (!confirm('Удалить точку?')) return
                    try {
                      await adminFetch(`/stores/${s.id}`, token, { method: 'DELETE' })
                      void load(token)
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Ошибка')
                    }
                  }}>Удалить</button>
                </div>
                <div className="text-ink-secondary">{s.address}</div>
                <div className="text-ink-tertiary">{s.organizationName ?? `org #${s.organizationId}`}</div>
              </div>
            ))}
            <div className="card space-y-2">
              <div className="font-semibold text-sm">Новая точка</div>
              <input className="input" placeholder="Название" value={storeForm.name}
                onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })} />
              <input className="input" placeholder="Адрес" value={storeForm.address}
                onChange={(e) => setStoreForm({ ...storeForm, address: e.target.value })} />
              <select className="input" value={storeForm.organizationId}
                onChange={(e) => setStoreForm({ ...storeForm, organizationId: Number(e.target.value) })}>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <button type="button" className="btn-primary w-full" onClick={async () => {
                await adminFetch('/stores', token, { method: 'POST', body: JSON.stringify(storeForm) })
                setStoreForm((f) => ({ ...f, name: '', address: '' }))
                void load(token)
              }}>Создать точку</button>
            </div>
          </>
        )}

        {tab === 'categories' && (
          <>
            {categories.map((c) => (
              <div key={c.id} className="card !mb-0 flex justify-between items-center text-sm">
                <span>{c.name} <span className="text-ink-tertiary">#{c.sortOrder}</span></span>
                <button type="button" className="text-red-600 text-xs" onClick={async () => {
                  try {
                    await adminFetch(`/categories/${c.id}`, token, { method: 'DELETE' })
                    void load(token)
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'err')
                  }
                }}>Удалить</button>
              </div>
            ))}
            <div className="card space-y-2">
              <input className="input" placeholder="Название категории" value={catForm.name}
                onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} />
              <button type="button" className="btn-primary w-full" onClick={async () => {
                await adminFetch('/categories', token, {
                  method: 'POST',
                  body: JSON.stringify({ name: catForm.name, sortOrder: catForm.sortOrder }),
                })
                setCatForm({ name: '', sortOrder: 0 })
                void load(token)
              }}>Добавить</button>
            </div>
          </>
        )}

        {tab === 'products' && (
          <>
            {products.map((p) => (
              <div key={p.id} className="card !mb-0 text-sm">
                <div className="flex gap-3">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover bg-brand-soft" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-brand-soft" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{p.name} · {p.price} ₽</div>
                    <div className="text-ink-tertiary truncate">{p.categoryName ?? 'без категории'} · {p.icon}</div>
                    <div className={`text-xs mt-0.5 ${p.available ? 'text-ok' : 'text-red-600'}`}>
                      {p.available ? 'В меню' : 'Скрыт из меню'}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded-lg bg-page border border-line"
                    disabled={saving}
                    onClick={async () => {
                      setSaving(true)
                      try {
                        await adminFetch('/products', token, {
                          method: 'POST',
                          body: JSON.stringify({
                            id: p.id,
                            name: p.name,
                            price: p.price,
                            icon: p.icon,
                            available: !p.available,
                            description: p.description,
                            categoryId: p.categoryId,
                            imageUrl: p.imageUrl,
                            sortOrder: p.sortOrder ?? 0,
                            modifierSchemeId: p.modifierSchemeId ?? null,
                            recipeText: p.recipeText ?? null,
                            recipeCostRub: p.recipeCostRub ?? null,
                            recipeSeconds: p.recipeSeconds ?? null,
                          }),
                        })
                        await load(token)
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Ошибка')
                      } finally {
                        setSaving(false)
                      }
                    }}
                  >
                    {p.available ? 'Скрыть из меню' : 'Показать в меню'}
                  </button>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded-lg bg-brand-soft text-brand"
                    onClick={() => {
                      setEditingId(p.id)
                      setProdForm({
                        name: p.name,
                        price: p.price,
                        icon: p.icon || 'Coffee',
                        categoryId: p.categoryId ?? categories[0]?.id ?? 0,
                        description: p.description ?? '',
                        imageUrl: p.imageUrl ?? '',
                        sortOrder: p.sortOrder ?? 0,
                        modifierSchemeId: p.modifierSchemeId ?? 0,
                        recipeText: p.recipeText ?? '',
                        recipeCostRub: p.recipeCostRub ?? 0,
                        recipeSeconds: p.recipeSeconds ?? 0,
                      })
                      setProductModalOpen(true)
                    }}
                  >
                    Изменить
                  </button>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded-lg text-red-600 border border-red-200"
                    onClick={async () => {
                      if (!confirm('Удалить товар «' + p.name + '»?')) return
                      await adminFetch('/products/' + p.id, token, { method: 'DELETE' })
                      void load(token)
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className="btn-primary w-full" onClick={() => {
              setEditingId(null)
              setProdForm({
                name: '', price: 0, icon: 'Coffee', categoryId: categories[0]?.id ?? 0,
                description: '', imageUrl: '', sortOrder: 0,
                modifierSchemeId: 0, recipeText: '', recipeCostRub: 0, recipeSeconds: 0,
              })
              setProductModalOpen(true)
            }}>+ Новый товар</button>

            {productModalOpen && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={() => setProductModalOpen(false)}>
            <div className="card space-y-2 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center">
              <div className="font-semibold text-sm">
                {editingId ? `Товар #${editingId}` : 'Новый товар'}
              </div>
              <button type="button" className="text-ink-secondary text-sm px-2" onClick={() => setProductModalOpen(false)}>Закрыть</button>
              </div>
              <input className="input" placeholder="Название" value={prodForm.name}
                onChange={(e) => setProdForm({ ...prodForm, name: e.target.value })} />
              <input className="input" type="number" placeholder="Цена ₽" value={prodForm.price || ''}
                onChange={(e) => setProdForm({ ...prodForm, price: Number(e.target.value) })} />
              <input className="input" placeholder="Описание" value={prodForm.description}
                onChange={(e) => setProdForm({ ...prodForm, description: e.target.value })} />
              <select className="input" value={prodForm.categoryId}
                onChange={(e) => setProdForm({ ...prodForm, categoryId: Number(e.target.value) })}>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input className="input" placeholder="Lucide icon (Coffee)" value={prodForm.icon}
                onChange={(e) => setProdForm({ ...prodForm, icon: e.target.value })} />
              <label className="text-xs text-ink-secondary block">Схема добавок</label>
              <select className="input" value={prodForm.modifierSchemeId ?? 0}
                onChange={(e) => setProdForm({ ...prodForm, modifierSchemeId: Number(e.target.value) })}>
                <option value={0}>— без добавок —</option>
                {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <label className="text-sm font-semibold text-ink block mt-2">Рецепт для бариста</label>
              <p className="text-xs text-ink-secondary">Текст увидит кассир на кассе (long-press / рецепт)</p>
              <textarea className="input min-h-[80px]" placeholder="Как готовить…"
                value={prodForm.recipeText ?? ''}
                onChange={(e) => setProdForm({ ...prodForm, recipeText: e.target.value })} />
              <input className="input" type="number" placeholder="Себес ₽ (только касса)"
                value={prodForm.recipeCostRub ?? 0}
                onChange={(e) => setProdForm({ ...prodForm, recipeCostRub: Number(e.target.value) })} />
              <label className="text-xs text-ink-secondary block">
                Фото (jpeg/png/webp, до 2 МБ)
                <input type="file" accept="image/jpeg,image/png,image/webp" className="block mt-1 text-xs w-full"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void uploadImage(f)
                  }} />
              </label>
              {uploading && <div className="text-xs text-ink-tertiary">Загрузка фото…</div>}
              {prodForm.imageUrl && (
                <div className="flex items-center gap-2">
                  <img src={prodForm.imageUrl} alt="" className="w-16 h-16 rounded object-cover" />
                  <span className="text-xs text-brand break-all">{prodForm.imageUrl}</span>
                </div>
              )}
              <button
                type="button"
                className="btn-primary w-full"
                disabled={saving || uploading || !prodForm.name.trim() || prodForm.price < 0}
                onClick={async () => {
                  if (!prodForm.name.trim()) {
                    setError('Название обязательно')
                    return
                  }
                  setSaving(true)
                  setError('')
                  try {
                    await adminFetch('/products', token, {
                      method: 'POST',
                      body: JSON.stringify({
                        id: editingId ?? undefined,
                        name: prodForm.name.trim(),
                        price: prodForm.price,
                        icon: prodForm.icon || 'Coffee',
                        categoryId: prodForm.categoryId || null,
                        description: prodForm.description || null,
                        imageUrl: prodForm.imageUrl || null,
                        sortOrder: prodForm.sortOrder,
                        available: true,
                        modifierSchemeId: prodForm.modifierSchemeId || null,
                        recipeText: prodForm.recipeText || null,
                        recipeCostRub: prodForm.recipeCostRub || null,
                        recipeSeconds: prodForm.recipeSeconds || null,
                      }),
                    })
                    setEditingId(null)
                    setProductModalOpen(false)
                    setProdForm({
                      name: '', price: 0, icon: 'Coffee', categoryId: categories[0]?.id ?? 0,
                      description: '', imageUrl: '', sortOrder: 0,
                      modifierSchemeId: 0, recipeText: '', recipeCostRub: 0, recipeSeconds: 0,
                    })
                    await load(token)
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Не удалось сохранить товар')
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                {saving ? 'Сохраняем…' : editingId ? 'Сохранить изменения' : 'Создать товар'}
              </button>
              <button type="button" className="btn-ghost w-full" onClick={() => {
                  setEditingId(null)
                  setProductModalOpen(false)
                  setProdForm({
                    name: '', price: 0, icon: 'Coffee', categoryId: categories[0]?.id ?? 0,
                    description: '', imageUrl: '', sortOrder: 0,
                    modifierSchemeId: 0, recipeText: '', recipeCostRub: 0, recipeSeconds: 0,
                  })
                }}>Отмена</button>
            </div>
            </div>
            )}
          </>
        )}

        {tab === 'modifiers' && (
          <div className="space-y-3">
            <p className="text-sm text-ink-secondary">Сиропы, топпинги, молоко — справочник добавок.</p>
            {modifiers.map((m) => (
              <div key={m.id} className="card flex justify-between items-center">
                <span className="text-sm">{m.name} · {m.price} ₽ · {m.groupKey}</span>
                <button type="button" className="text-xs text-red-600" onClick={async () => {
                  await adminFetch(`/modifiers/${m.id}`, token, { method: 'DELETE' })
                  void load(token)
                }}>Удалить</button>
              </div>
            ))}
            <div className="card space-y-2">
              <input className="input" placeholder="Название" value={modForm.name}
                onChange={(e) => setModForm({ ...modForm, name: e.target.value })} />
              <input className="input" type="number" placeholder="Цена ₽" value={modForm.price}
                onChange={(e) => setModForm({ ...modForm, price: Number(e.target.value) })} />
              <select className="input" value={modForm.groupKey}
                onChange={(e) => setModForm({ ...modForm, groupKey: e.target.value })}>
                <option value="syrup">Сироп</option>
                <option value="topping">Топпинг</option>
                <option value="milk">Молоко</option>
                <option value="other">Другое</option>
              </select>
              <button type="button" className="btn" onClick={async () => {
                await adminFetch('/modifiers', token, { method: 'POST', body: JSON.stringify(modForm) })
                setModForm({ name: '', price: 40, groupKey: 'syrup' })
                void load(token)
              }}>Добавить добавку</button>
            </div>
          </div>
        )}

        {tab === 'schemes' && (
          <div className="space-y-3">
            <p className="text-sm text-ink-secondary">Схема = набор добавок. Один набор можно повесить на капучино и латте.</p>
            {schemes.map((s) => (
              <div key={s.id} className="card">
                <div className="flex justify-between">
                  <b className="text-sm">{s.name}</b>
                  <button type="button" className="text-xs text-red-600" onClick={async () => {
                    await adminFetch(`/modifier-schemes/${s.id}`, token, { method: 'DELETE' })
                    void load(token)
                  }}>Удалить</button>
                </div>
                <p className="text-xs text-ink-secondary mt-1">
                  Добавок: {s.items?.length ?? 0} · id схемы {s.id} (укажите в товаре)
                </p>
              </div>
            ))}
            <div className="card space-y-2">
              <input className="input" placeholder="Имя схемы" value={schemeForm.name}
                onChange={(e) => setSchemeForm({ ...schemeForm, name: e.target.value })} />
              <p className="text-xs">Отметьте добавки или скопируйте существующую схему:</p>
              <select className="input" value={schemeForm.copyFrom}
                onChange={(e) => setSchemeForm({ ...schemeForm, copyFrom: Number(e.target.value) })}>
                <option value={0}>— не копировать —</option>
                {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {modifiers.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={schemeForm.modifierIds.includes(m.id)}
                      onChange={(e) => {
                        const ids = e.target.checked
                          ? [...schemeForm.modifierIds, m.id]
                          : schemeForm.modifierIds.filter((x) => x !== m.id)
                        setSchemeForm({ ...schemeForm, modifierIds: ids })
                      }} />
                    {m.name} ({m.price} ₽)
                  </label>
                ))}
              </div>
              <button type="button" className="btn" onClick={async () => {
                await adminFetch('/modifier-schemes', token, {
                  method: 'POST',
                  body: JSON.stringify({
                    name: schemeForm.name || 'Схема',
                    modifierIds: schemeForm.modifierIds,
                    copyFromSchemeId: schemeForm.copyFrom || undefined,
                  }),
                })
                setSchemeForm({ name: '', modifierIds: [], copyFrom: 0 })
                void load(token)
              }}>Создать схему</button>
            </div>
          </div>
        )}

{tab === 'devices' && (
          <div className="space-y-3">
          <p className="text-xs text-ink-secondary mb-3">На кассе Эвотор вводится только <b>код регистрации</b> из этой вкладки и URL API. Пароль 6.7 Coffee / SMS не нужны.</p>
            {devices.map((d) => (
              <div key={d.id} className="card !mb-0 text-sm">
                <div className="font-semibold">{d.name} · {d.storeName}</div>
                <div className="text-ink-tertiary">
                  {d.enrolled ? 'зарег.' : `код ${d.enrollCode}`}
                  {d.revoked ? ' · ОТОЗВАНА' : ''}
                </div>
                {!d.revoked && (
                  <>
                  <button type="button" className="text-red-600 text-xs mt-1" onClick={async () => {
                    await adminFetch(`/devices/${d.id}/revoke`, token, { method: 'POST' })
                    void load(token)
                  }}>Отозвать</button>
                  <button type="button" className="text-xs text-red-600 ml-2" onClick={async () => {
                    if (!confirm('Удалить кассу из списка?')) return
                    await adminFetch(`/devices/${d.id}`, token, { method: 'DELETE' })
                    void load(token)
                  }}>Удалить</button>
                  </>
                )}
              </div>
            ))}
            <div className="card space-y-2">
              <input className="input" placeholder="Имя кассы" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
              <select className="input" value={deviceStoreId} onChange={(e) => setDeviceStoreId(Number(e.target.value))}>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button type="button" className="btn-primary w-full" onClick={async () => {
                const r = await adminFetch<{ enrollCode: string }>('/devices', token, {
                  method: 'POST',
                  body: JSON.stringify({ storeId: deviceStoreId, name: deviceName }),
                })
                setNewCode(r.enrollCode)
                setDeviceName('')
                void load(token)
              }}>Выпустить код</button>
              {newCode && <div className="text-center font-mono text-lg text-brand">{newCode}</div>}
            </div>
          </div>
        )}

        {tab === 'promos' && (
          <>
            {promos.map((p) => (
              <div key={p.id} className="card !mb-0 text-sm flex justify-between">
                <div>
                  <div className="font-semibold">{p.title}</div>
                  <div className="text-ink-tertiary">{p.body}</div>
                </div>
                <button type="button" className="text-red-600 text-xs" onClick={async () => {
                  await adminFetch(`/promos/${p.id}`, token, { method: 'DELETE' })
                  void load(token)
                }}>×</button>
              </div>
            ))}
            <div className="card space-y-2">
              <input className="input" placeholder="Заголовок" value={promoTitle} onChange={(e) => setPromoTitle(e.target.value)} />
              <input className="input" placeholder="Текст" value={promoBody} onChange={(e) => setPromoBody(e.target.value)} />
              <button type="button" className="btn-primary w-full" onClick={async () => {
                await adminFetch('/promos', token, {
                  method: 'POST',
                  body: JSON.stringify({ title: promoTitle, body: promoBody, days: 14 }),
                })
                setPromoTitle('')
                setPromoBody('')
                void load(token)
              }}>Создать акцию</button>
            </div>
          </>
        )}

        {tab === 'disputes' && (
          disputes.length === 0
            ? <p className="text-ink-tertiary text-sm">Конфликтов нет</p>
            : disputes.map((d) => (
              <div key={d.id} className="card !mb-0 text-xs">
                <div className="font-semibold">{d.kind}</div>
                <div className="text-ink-secondary">{d.details}</div>
              </div>
            ))
        )}
      </div>
    </div>
  )
}
