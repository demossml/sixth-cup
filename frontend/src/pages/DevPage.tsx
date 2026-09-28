import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setJwt, unwrap } from '../api'
import { useApp } from '../lib/app'
import { enroll, loadCreds, createReceipt, syncCashier, type DeviceCreds } from '../lib/cashier'
import { syncCustomer } from '../lib/customer'
import { allReceipts, resetLocal } from '../lib/db'
import { activeVouchers } from '../lib/proof'
import { isDev, type DevUser } from '../lib/dev'
import type { CardState } from '../lib/types'

const CUSTOMER_PHONE = '79000000001'
const FRIEND_PHONE = '79000000002'

export default function DevPage() {
  const nav = useNavigate()
  const { dir, me, best, reload } = useApp()
  const [creds, setCreds] = useState<DeviceCreds | null | undefined>(undefined)
  const [users, setUsers] = useState<DevUser[]>([])
  const [msg, setMsg] = useState('')
  const [pending, setPending] = useState(0)

  // форма покупки клиента
  const [cups, setCups] = useState(1)
  const [useFree, setUseFree] = useState(false)
  const [voucherId, setVoucherId] = useState<number | null>(null)
  const [cashbackUse, setCashbackUse] = useState(0)
  const [amount, setAmount] = useState(190)
  const [friendAmount, setFriendAmount] = useState(300)

  useEffect(() => { loadCreds().then((c) => setCreds(c ?? null)) }, [])
  useEffect(() => {
    if (!isDev) return
    void loadUsers()
  }, [])
  useEffect(() => { void refreshPending() }, [me, best])

  async function loadUsers() {
    try { setUsers((await unwrap(api.api.dev.users.$get())).users as DevUser[]) } catch { /* noop */ }
  }
  async function refreshPending() { setPending((await allReceipts()).filter((r) => !r.uploaded).length) }

  if (!isDev) {
    return <div className="p-4 text-muted">Режим разработчика доступен только в dev-сборке (NODE_ENV != production).</div>
  }

  const customer = users.find((u) => u.phone === CUSTOMER_PHONE)
  const friend = users.find((u) => u.phone === FRIEND_PHONE)

  async function loginAs(phone: string) {
    const r = await unwrap(api.api.dev.login.$post({ json: { phone } }))
    setJwt(r.token)
    await syncCustomer()
    await reload()
    setMsg(`Вошли как ${r.user.nickname} (№${r.user.id})`)
    nav('/')
  }

  async function doEnroll() {
    const c = await enroll('DEMO1234')
    setCreds(c)
    setMsg(`Касса «${c.storeName}» зарегистрирована`)
  }

  async function simCustomer() {
    if (!creds || !best) { setMsg('Сначала войдите как демо-клиент и зарегистрируйте кассу.'); return }
    const r = await createReceipt(creds, best.state, { cups, useFree, voucherId, cashbackUse, amount })
    await reload()
    await refreshPending()
    setMsg(`✅ Чек клиента: +${r.payload.dp} стакан${r.payload.df ? ', выдан бесплатный' : ''}, списано кэшбэка ${r.payload.dcb} ₽, сумма ${r.payload.a} ₽`)
  }

  async function simFriend() {
    if (!creds || !friend) { setMsg('Сначала зарегистрируйте кассу (друг №2 должен быть засидирован).'); return }
    const base: CardState = { u: friend.id, q: 0, p: 0, f: 0, v: [], cb: 0 }
    await createReceipt(creds, base, { cups: 1, useFree: false, voucherId: null, cashbackUse: 0, amount: friendAmount })
    await syncCashier(creds)
    await syncCustomer()
    await reload()
    await loadUsers()
    await refreshPending()
    setMsg(`✅ Покупка друга на ${friendAmount} ₽ → сервер начислил 3% демо-клиенту. Проверьте кэшбэк на карте.`)
  }

  async function syncAll() {
    if (creds) await syncCashier(creds)
    await syncCustomer()
    await reload()
    await loadUsers()
    await refreshPending()
    setMsg('Синхронизация выполнена')
  }

  async function doResetLocal() {
    await resetLocal()
    setJwt(null)
    setCreds(null)
    await reload()
    setMsg('Локальное состояние очищено')
  }

  async function doResetServer() {
    await unwrap(api.api.dev.reset.$post({ json: {} }))
    await syncAll()
    setMsg('Сервер сброшен к базовому состоянию (4/5 + 47 ₽)')
  }

  const vouchers = best ? activeVouchers(best.state) : []

  return (
    <div className="p-4 pb-10">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold">🧪 Режим разработчика</h1>
        <button className="btn-ghost !w-auto px-3" onClick={() => nav('/')}>←</button>
      </div>

      <section className="card">
        <h2 className="font-semibold">Вход</h2>
        <div className="flex gap-2 mt-2">
          <button className="btn" onClick={() => loginAs(CUSTOMER_PHONE)}>Войти как Демо Клиент</button>
          <button className="btn" onClick={() => loginAs(FRIEND_PHONE)}>Войти как Друг</button>
        </div>
        <p className="text-muted text-xs mt-2">Текущий: {me ? `${me.nickname} №${me.id}` : 'не авторизован'}</p>
      </section>

      <section className="card">
        <h2 className="font-semibold">Касса</h2>
        {creds
          ? <p className="text-ok text-sm mt-1">Зарегистрирована: {creds.storeName} (device #{creds.deviceId})</p>
          : <button className="btn mt-2" onClick={doEnroll}>Зарегистрировать Demo tablet (DEMO1234)</button>}
      </section>

      <section className="card">
        <h2 className="font-semibold">Симуляция покупки клиента</h2>
        {best ? (
          <>
            <div className="text-sm text-muted mt-1">Прогресс: {best.state.p % (dir?.cupsForFree ?? 5)}/{dir?.cupsForFree ?? 5} · кэшбэк {best.state.cb} ₽</div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <label className="text-sm">Стаканов<input className="input" type="number" value={cups} onChange={(e) => setCups(Math.max(0, Number(e.target.value)))} /></label>
              <label className="text-sm">Сумма, ₽<input className="input" type="number" value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} /></label>
            </div>
            {best.state.cb > 0 && (
              <label className="text-sm">Списать кэшбэк, ₽<input className="input" type="number" value={cashbackUse || ''} onChange={(e) => setCashbackUse(Math.min(best.state.cb, Math.max(0, Number(e.target.value))))} /></label>
            )}
            {vouchers.length > 0 && (
              <label className="text-sm">Купон
                <select className="input" value={voucherId ?? ''} onChange={(e) => setVoucherId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Без купона</option>
                  {vouchers.map((v) => <option key={v[0]} value={v[0]}>{v[1] === 'p' ? `−${v[2]}%` : `−${v[2]} ₽`}</option>)}
                </select>
              </label>
            )}
            <label className="flex items-center gap-2 mt-2 text-sm"><input type="checkbox" checked={useFree} onChange={(e) => setUseFree(e.target.checked)} /> Выдать бесплатный стакан</label>
            <button className="btn mt-3" onClick={simCustomer}>Создать чек и обновить карту</button>
          </>
        ) : <p className="text-muted text-sm mt-1">Войдите как демо-клиент, чтобы симулировать покупку.</p>}
      </section>

      <section className="card">
        <h2 className="font-semibold">Реферальный кэшбэк 3%</h2>
        <label className="text-sm">Сумма покупки друга, ₽<input className="input" type="number" value={friendAmount} onChange={(e) => setFriendAmount(Math.max(0, Number(e.target.value)))} /></label>
        <button className="btn mt-2" onClick={simFriend}>Симулировать покупку друга</button>
        <p className="text-muted text-xs mt-2">Друг (№{friend?.id ?? '—'}) покупает → сервер начислит {Math.floor(friendAmount * 0.03)} ₽ демо-клиенту.</p>
      </section>

      <section className="card">
        <h2 className="font-semibold">Управление</h2>
        <div className="flex flex-wrap gap-2 mt-2">
          <button className="btn" onClick={syncAll}>🔄 Синхронизировать</button>
          <button className="btn-ghost" onClick={doResetLocal}>Сброс локально</button>
          <button className="btn-ghost" onClick={doResetServer}>Сброс на сервере</button>
        </div>
        <p className="text-muted text-xs mt-2">Неотправленных чеков: {pending}</p>
      </section>

      <section className="card">
        <h2 className="font-semibold">Состояние</h2>
        <pre className="text-xs overflow-auto mt-2">{JSON.stringify({
          me,
          best: best?.state ?? null,
          creds: creds ? { deviceId: creds.deviceId, store: creds.storeName } : null,
          users: users.map((u) => ({ id: u.id, nickname: u.nickname, paidTotal: u.paidTotal, cb: u.cashbackBalance, invitedBy: u.invitedBy })),
        }, null, 2)}</pre>
      </section>

      {msg && <p className="text-sm mt-3 text-ok">{msg}</p>}
    </div>
  )
}
