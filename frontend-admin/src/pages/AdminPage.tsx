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

type Tab = 'overview' | 'orgs' | 'stores' | 'categories' | 'products' | 'devices' | 'promos' | 'disputes'

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
  sortOrder: number; categoryName?: string
}
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
  { id: 'devices', label: 'Кассы' },
  { id: 'promos', label: 'Акции' },
  { id: 'disputes', label: 'Споры' },
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
  const [devices, setDevices] = useState<Device[]>([])
  const [promos, setPromos] = useState<Array<{ id: number; title: string; body: string; endsAt: number }>>([])
  const [disputes, setDisputes] = useState<Array<{ id: number; kind: string; details: string; created_at: number }>>([])

  // forms
  const [orgForm, setOrgForm] = useState({ name: '', legalName: '', inn: '', taxRegime: 'usn_income', vatRate: 0 })
  const [storeForm, setStoreForm] = useState({ name: '', address: '', organizationId: 0 })
  const [catForm, setCatForm] = useState({ name: '', sortOrder: 0 })
  const [prodForm, setProdForm] = useState({
    name: '', price: 0, icon: 'Coffee', categoryId: 0, description: '', imageUrl: '', sortOrder: 0,
  })
  const [deviceName, setDeviceName] = useState('')
  const [deviceStoreId, setDeviceStoreId] = useState(0)
  const [newCode, setNewCode] = useState('')
  const [promoTitle, setPromoTitle] = useState('')
  const [promoBody, setPromoBody] = useState('')
  const [uploading, setUploading] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (t: string) => {
    setError('')
    try {
      const [s, o, st, cat, p, d, pr, di] = await Promise.all([
        adminFetch<Stats>('/stats', t),
        adminFetch<{ organizations: Org[] }>('/organizations', t),
        adminFetch<{ stores: Store[] }>('/stores', t),
        adminFetch<{ categories: Category[] }>('/categories', t),
        adminFetch<{ products: Product[] }>('/products', t),
        adminFetch<{ devices: Device[] }>('/devices', t),
        adminFetch<{ promos: typeof promos }>('/promos', t),
        adminFetch<{ disputes: typeof disputes }>('/disputes', t),
      ])
      setStats(s)
      setOrgs(o.organizations)
      setStores(st.stores)
      setCategories(cat.categories)
      setProducts(p.products)
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
        <p className="text-ink-tertiary text-sm mb-6">Вход только для владельца · admin.*</p>
        <h1 className="text-xl font-bold mb-4">Админ</h1>
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
        )}

        {tab === 'orgs' && (
          <>
            {orgs.map((o) => (
              <div key={o.id} className="card !mb-0 text-sm">
                <div className="font-semibold">{o.name} {!o.active ? '(выкл)' : ''}</div>
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
                <div className="font-semibold">{s.name}</div>
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
                      })
                    }}
                  >
                    Изменить
                  </button>
                </div>
              </div>
            ))}
            <div className="card space-y-2">
              <div className="font-semibold text-sm">
                {editingId ? `Редактирование #${editingId}` : 'Новый товар'}
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
                      }),
                    })
                    setEditingId(null)
                    setProdForm({
                      name: '', price: 0, icon: 'Coffee', categoryId: categories[0]?.id ?? 0,
                      description: '', imageUrl: '', sortOrder: 0,
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
              {editingId && (
                <button type="button" className="btn-ghost w-full" onClick={() => {
                  setEditingId(null)
                  setProdForm({
                    name: '', price: 0, icon: 'Coffee', categoryId: categories[0]?.id ?? 0,
                    description: '', imageUrl: '', sortOrder: 0,
                  })
                }}>Отмена редактирования</button>
              )}
            </div>
          </>
        )}

{tab === 'devices' && (
          <>
            {devices.map((d) => (
              <div key={d.id} className="card !mb-0 text-sm">
                <div className="font-semibold">{d.name} · {d.storeName}</div>
                <div className="text-ink-tertiary">
                  {d.enrolled ? 'зарег.' : `код ${d.enrollCode}`}
                  {d.revoked ? ' · ОТОЗВАНА' : ''}
                </div>
                {!d.revoked && (
                  <button type="button" className="text-red-600 text-xs mt-1" onClick={async () => {
                    await adminFetch(`/devices/${d.id}/revoke`, token, { method: 'POST' })
                    void load(token)
                  }}>Отозвать</button>
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
          </>
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
            ? <p className="text-ink-tertiary text-sm">Споров нет</p>
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
