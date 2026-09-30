import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, RefreshCw, Store } from '../lib/icons'

const TOKEN_KEY = 'sc-admin-token'

async function adminFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    ...init,
    headers: {
      'X-Admin-Token': token,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const body = await res.json()
  if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Ошибка')
  return body as T
}

type Stats = {
  users: number; receipts: number; receiptsToday: number; freeCups: number
  cashbackGranted: number; cashbackSpent: number; amountTotal: number
}

export default function AdminPage() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '')
  const [input, setInput] = useState(token)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [devices, setDevices] = useState<Array<{
    id: number; name: string; storeId: number; storeName: string; revoked: number
    enrollCode: string | null; enrolled: number
  }>>([])
  const [products, setProducts] = useState<Array<{ id: number; name: string; price: number; icon: string; available: number }>>([])
  const [promos, setPromos] = useState<Array<{ id: number; title: string; body: string; endsAt: number }>>([])
  const [disputes, setDisputes] = useState<Array<{ id: number; kind: string; details: string; created_at: number }>>([])
  const [stores, setStores] = useState<Array<{ id: number; name: string }>>([])
  const [deviceName, setDeviceName] = useState('')
  const [storeId, setStoreId] = useState(1)
  const [promoTitle, setPromoTitle] = useState('')
  const [promoBody, setPromoBody] = useState('')
  const [newCode, setNewCode] = useState('')

  const load = useCallback(async (t: string) => {
    setError('')
    try {
      const [s, d, p, pr, di, st] = await Promise.all([
        adminFetch<Stats>('/stats', t),
        adminFetch<{ devices: typeof devices }>('/devices', t),
        adminFetch<{ products: typeof products }>('/products', t),
        adminFetch<{ promos: typeof promos }>('/promos', t),
        adminFetch<{ disputes: typeof disputes }>('/disputes', t),
        adminFetch<{ stores: typeof stores }>('/stores', t),
      ])
      setStats(s)
      setDevices(d.devices)
      setProducts(p.products)
      setPromos(pr.promos)
      setDisputes(di.disputes)
      setStores(st.stores)
      if (st.stores[0]) setStoreId(st.stores[0].id)
    } catch (e) {
      setError((e as Error).message)
      setStats(null)
    }
  }, [])

  useEffect(() => {
    if (token) void load(token)
  }, [token, load])

  function login() {
    localStorage.setItem(TOKEN_KEY, input)
    setToken(input)
  }

  if (!token || !stats) {
    return (
      <div className="max-w-[480px] mx-auto min-h-screen bg-page p-4">
        <Link to="/" className="text-brand text-sm flex items-center gap-1 mb-4"><ChevronLeft size={16} /> Назад</Link>
        <h1 className="text-xl font-bold text-ink mb-2">Админ-панель</h1>
        <p className="text-ink-secondary text-sm mb-3">Введите ADMIN_TOKEN (в dev: <code className="text-brand">dev-admin</code>)</p>
        <input className="input" type="password" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Токен" />
        <button className="btn" onClick={login}>Войти</button>
        {error && <p className="text-bad text-sm mt-2">{error}</p>}
      </div>
    )
  }

  return (
    <div className="max-w-[640px] mx-auto min-h-screen bg-page pb-10">
      <div className="bg-brand text-white px-4 pt-10 pb-5 rounded-b-3xl flex justify-between items-start">
        <div>
          <h1 className="text-xl font-bold">Админ-панель</h1>
          <p className="text-white/70 text-xs mt-1">Управление кофейней</p>
        </div>
        <button type="button" className="p-2 bg-white/15 rounded-xl" onClick={() => load(token)} aria-label="Обновить">
          <RefreshCw size={18} />
        </button>
      </div>

      <div className="px-4 -mt-3">
        <div className="grid grid-cols-2 gap-2 mb-4">
          {[
            ['Клиенты', stats.users],
            ['Чеки сегодня', stats.receiptsToday],
            ['Всего чеков', stats.receipts],
            ['Бесплатных', stats.freeCups],
            ['Кэшбэк начислен', `${stats.cashbackGranted} ₽`],
            ['Кэшбэк списан', `${stats.cashbackSpent} ₽`],
            ['Сумма чеков', `${stats.amountTotal} ₽`],
          ].map(([label, val]) => (
            <div key={String(label)} className="card !mb-0">
              <div className="text-ink-tertiary text-xs">{label}</div>
              <div className="text-lg font-bold text-ink">{val}</div>
            </div>
          ))}
        </div>

        <h2 className="text-sm font-semibold text-ink mb-2 flex items-center gap-1.5"><Store size={16} className="text-brand" /> Кассы</h2>
        {devices.map((d) => (
          <div key={d.id} className="card flex justify-between items-center text-sm">
            <div>
              <b>{d.name}</b>
              <div className="text-ink-tertiary text-xs">{d.storeName} · {d.revoked ? 'отозвана' : d.enrolled ? 'активна' : `код: ${d.enrollCode}`}</div>
            </div>
            {!d.revoked && (
              <button
                className="btn-danger btn-sm"
                onClick={async () => {
                  await adminFetch(`/devices/${d.id}/revoke`, token, { method: 'POST' })
                  await load(token)
                }}
              >
                Отозвать
              </button>
            )}
          </div>
        ))}
        <div className="flex gap-2 mb-4">
          <input className="input !mb-0 flex-1" placeholder="Имя кассы" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
          <select className="input !mb-0 !w-auto" value={storeId} onChange={(e) => setStoreId(Number(e.target.value))}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button
            className="btn !w-auto px-3"
            onClick={async () => {
              if (!deviceName.trim()) return
              const r = await adminFetch<{ enrollCode: string }>('/devices', token, {
                method: 'POST',
                body: JSON.stringify({ storeId, name: deviceName.trim() }),
              })
              setNewCode(r.enrollCode)
              setDeviceName('')
              await load(token)
            }}
          >
            +
          </button>
        </div>
        {newCode && (
          <div className="card bg-brand-soft text-brand text-sm mb-4">
            Код регистрации кассы: <b className="tracking-widest">{newCode}</b>
          </div>
        )}

        <h2 className="text-sm font-semibold text-ink mb-2">Товары</h2>
        {products.map((p) => (
          <div key={p.id} className="card flex justify-between text-sm !py-2">
            <span>{p.name}</span>
            <span className="font-semibold">{p.price} ₽</span>
          </div>
        ))}

        <h2 className="text-sm font-semibold text-ink mt-4 mb-2">Акции</h2>
        {promos.map((p) => (
          <div key={p.id} className="card flex justify-between items-start text-sm gap-2">
            <div>
              <b>{p.title}</b>
              <div className="text-ink-tertiary text-xs">{p.body}</div>
            </div>
            <button
              className="btn-danger btn-sm shrink-0"
              onClick={async () => {
                await adminFetch(`/promos/${p.id}`, token, { method: 'DELETE' })
                await load(token)
              }}
            >
              Удалить
            </button>
          </div>
        ))}
        <input className="input" placeholder="Заголовок акции" value={promoTitle} onChange={(e) => setPromoTitle(e.target.value)} />
        <input className="input" placeholder="Текст" value={promoBody} onChange={(e) => setPromoBody(e.target.value)} />
        <button
          className="btn mb-4"
          onClick={async () => {
            if (!promoTitle.trim()) return
            await adminFetch('/promos', token, {
              method: 'POST',
              body: JSON.stringify({ title: promoTitle, body: promoBody, days: 14 }),
            })
            setPromoTitle('')
            setPromoBody('')
            await load(token)
          }}
        >
          Создать акцию (14 дней)
        </button>

        <h2 className="text-sm font-semibold text-ink mb-2">Споры</h2>
        {disputes.length === 0 && <p className="text-ink-tertiary text-sm">Споров нет</p>}
        {disputes.map((d) => (
          <div key={d.id} className="card text-sm">
            <b className="text-bad">{d.kind}</b>
            <div className="text-ink-secondary text-xs mt-1">{d.details}</div>
            <div className="text-ink-tertiary text-xs">{new Date(d.created_at).toLocaleString()}</div>
          </div>
        ))}

        <button
          className="btn-danger mt-6"
          onClick={() => {
            localStorage.removeItem(TOKEN_KEY)
            setToken('')
            setStats(null)
          }}
        >
          Выйти из админки
        </button>
      </div>
    </div>
  )
}
