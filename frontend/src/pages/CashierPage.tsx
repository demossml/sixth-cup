import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Qr from '../components/Qr'
import ScanModal from '../components/ScanModal'
import { useApp } from '../lib/app'
import { createReceipt, enroll, loadCreds, syncCashier, type DeviceCreds } from '../lib/cashier'
import { getSeen } from '../lib/db'
import { activeVouchers, discountFor, freeAvailable, progress, verifyProof } from '../lib/proof'
import type { CardState, Directory, ReceiptPayload } from '../lib/types'
import { Check, ChevronLeft, Minus, Plus, ScanLine, X } from '../lib/icons'

/**
 * PWA-режим кассира (лояльность).
 * Фискальная касса Эвотор — отдельный проект; сюда не входит.
 * Здесь: каталог из directory, карта клиента, 6-й/купон/кэшбэк, signed receipt → sync.
 */
export default function CashierPage() {
  const { dir, reload } = useApp()
  const [creds, setCreds] = useState<DeviceCreds | null | undefined>(undefined)
  const [syncState, setSyncState] = useState<'ok' | 'offline' | null>(null)

  useEffect(() => { loadCreds().then((c) => setCreds(c ?? null)) }, [])

  useEffect(() => {
    if (!creds) return
    const run = () => {
      void syncCashier(creds).then((s) => {
        setSyncState(s)
        void reload()
      })
    }
    run()
    const t = setInterval(run, 30_000)
    return () => clearInterval(t)
  }, [creds, reload])

  if (creds === undefined) return <div className="p-4 text-ink-secondary">Загрузка…</div>
  if (!creds) return <Enroll onDone={setCreds} />

  return (
    <div className="p-4 pb-24">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold text-ink">Касса · {creds.storeName}</h1>
        <Link to="/" className="text-brand p-1"><ChevronLeft size={22} /></Link>
      </div>
      <p className="text-ink-tertiary text-xs mb-3">
        Режим лояльности (PWA). Фискальный чек — на кассе Эвотор.
        {syncState === 'offline' ? ' · офлайн, чеки в очереди' : syncState === 'ok' ? ' · синхр. ок' : ''}
      </p>
      {!dir
        ? <p className="text-bad text-sm">Нет справочника. Подключитесь к интернету один раз.</p>
        : <Sale creds={creds} dir={dir} />}
    </div>
  )
}

function Enroll({ onDone }: { onDone: (c: DeviceCreds) => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  return (
    <div className="p-4">
      <h1 className="text-xl font-bold text-ink mb-2">Регистрация кассы</h1>
      <p className="text-ink-secondary text-sm mb-3">Код от владельца (из админки). Нужен интернет один раз.</p>
      <input className="input" placeholder="Например DEMO1234" value={code} onChange={(e) => setCode(e.target.value)} />
      <button type="button" className="btn" onClick={async () => {
        try { onDone(await enroll(code)) } catch (e) { setError((e as Error).message) }
      }}>Зарегистрировать</button>
      {error && <p className="text-bad text-sm mt-2">{error}</p>}
    </div>
  )
}

type CartLine = { productId: number; name: string; price: number; qty: number; free: boolean }

function Sale({ creds, dir }: { creds: DeviceCreds; dir: Directory }) {
  const N = dir.cupsForFree
  const [stage, setStage] = useState<'idle' | 'scan' | 'form' | 'done'>('idle')
  const [state, setState] = useState<CardState | null>(null)
  const [error, setError] = useState('')
  const [stale, setStale] = useState<string | null>(null)
  const [cart, setCart] = useState<CartLine[]>([])
  const [useFree, setUseFree] = useState(false)
  const [voucherId, setVoucherId] = useState<number | null>(null)
  const [cashbackUse, setCashbackUse] = useState(0)
  const [result, setResult] = useState<{ token: string; payload: ReceiptPayload } | null>(null)
  const [lastScan, setLastScan] = useState<{ userId: number; at: number } | null>(null)
  const [confirmAgain, setConfirmAgain] = useState<string | null>(null)
  const [catId, setCatId] = useState<number | 'all'>('all')

  const categories = dir.categories ?? []
  const catalog = useMemo(() => {
    const list = [...dir.products].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    if (catId === 'all') return list
    return list.filter((p) => p.categoryId === catId)
  }, [dir.products, catId])

  const lineSum = cart.reduce((s, l) => s + (l.free ? 0 : l.price * l.qty), 0)
  const voucher = state && voucherId != null
    ? activeVouchers(state).find((v) => v[0] === voucherId) ?? null
    : null
  const discount = state && voucher ? discountFor(lineSum, voucher) : 0
  const afterDisc = Math.max(0, lineSum - discount)
  const toPay = Math.max(0, afterDisc - cashbackUse)
  const paidCups = cart.reduce((s, l) => {
    // cups = all units that are not the free drink unit
    if (l.free) return s + Math.max(0, l.qty - 1)
    return s + l.qty
  }, 0)

  function addProduct(p: Directory['products'][0]) {
    setCart((prev) => {
      const i = prev.findIndex((x) => x.productId === p.id && !x.free)
      if (i >= 0) {
        const next = [...prev]
        next[i] = { ...next[i], qty: next[i].qty + 1 }
        return next
      }
      return [...prev, { productId: p.id, name: p.name, price: p.price, qty: 1, free: false }]
    })
  }

  function setQty(productId: number, qty: number) {
    setCart((prev) => {
      if (qty <= 0) return prev.filter((x) => x.productId !== productId)
      return prev.map((x) => (x.productId === productId ? { ...x, qty } : x))
    })
  }

  function toggleFree() {
    if (!state || freeAvailable(state, N) <= 0) return
    if (useFree) {
      setUseFree(false)
      setCart((prev) => prev.map((x) => ({ ...x, free: false })))
      return
    }
    // mark most expensive line as free (one unit conceptually via free flag on line)
    const paid = cart.filter((x) => x.qty > 0)
    if (paid.length === 0) {
      setError('Сначала добавьте напиток в чек')
      return
    }
    const best = [...paid].sort((a, b) => b.price - a.price)[0]
    setUseFree(true)
    setCart((prev) => prev.map((x) => ({
      ...x,
      free: x.productId === best.productId,
    })))
  }

  async function onScan(text: string) {
    setError('')
    setStale(null)
    setConfirmAgain(null)
    const v = verifyProof(text, dir)
    if (!v) {
      setError('Код не распознан или подпись неверна.')
      setStage('idle')
      return
    }
    const seen = await getSeen(v.payload.u)
    if (seen && v.payload.q < seen.q) {
      setStale(seen.token)
      setStage('idle')
      return
    }
    if (lastScan && lastScan.userId === v.payload.u && Date.now() - lastScan.at < 12_000) {
      setConfirmAgain(text)
      setStage('idle')
      return
    }
    setLastScan({ userId: v.payload.u, at: Date.now() })
    setState(v.payload)
    setCart([])
    setUseFree(false)
    setVoucherId(null)
    setCashbackUse(0)
    setStage('form')
  }

  async function confirm() {
    if (!state) return
    if (cart.length === 0 && !useFree && !voucher && cashbackUse === 0) return
    const r = await createReceipt(creds, state, {
      cups: paidCups,
      useFree,
      voucherId,
      cashbackUse,
      amount: toPay,
    })
    setResult(r)
    setStage('done')
  }

  if (stage === 'done' && result) {
    const p = result.payload
    return (
      <>
        <div className="card">
          <div className="flex items-center gap-2 text-ok mb-1">
            <Check size={18} />
            <b>Чек лояльности · клиент №{p.u}</b>
          </div>
          <div className="text-sm text-ink-secondary">
            Стаканов: {p.p} (прогресс {progress(p, N)}/{N})
            {p.df ? ' · выдан бесплатный' : ''}
          </div>
          {p.dcb > 0 && <div className="text-sm text-ok">Списано кэшбэка: {p.dcb} ₽</div>}
          <div className="text-sm text-ink">Сумма в чеке лояльности: {p.a} ₽</div>
        </div>
        <p className="text-ink-secondary text-sm">Клиент сканирует QR в своём приложении (запись стаканов):</p>
        <Qr value={result.token} />
        <button type="button" className="btn mt-3" onClick={() => {
          setStage('idle')
          setState(null)
          setCart([])
          setResult(null)
        }}>Новый клиент</button>
      </>
    )
  }

  if (stage === 'form' && state) {
    const freeN = freeAvailable(state, N)
    const vouchers = activeVouchers(state)
    return (
      <>
        <div className="card !mb-3">
          <div className="font-semibold">Клиент №{state.u}</div>
          <div className="text-sm text-ink-secondary">
            Прогресс {progress(state, N)}/{N} · free {freeN} · кэшбэк {state.cb} ₽
          </div>
        </div>

        {categories.length > 0 && (
          <div className="flex gap-1 overflow-x-auto pb-2">
            <button type="button" className={`shrink-0 px-2 py-1 rounded-full text-xs ${catId === 'all' ? 'bg-brand text-white' : 'bg-white border border-line'}`}
              onClick={() => setCatId('all')}>Все</button>
            {categories.map((c) => (
              <button key={c.id} type="button"
                className={`shrink-0 px-2 py-1 rounded-full text-xs ${catId === c.id ? 'bg-brand text-white' : 'bg-white border border-line'}`}
                onClick={() => setCatId(c.id)}>{c.name}</button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 mb-3">
          {catalog.map((p) => (
            <button key={p.id} type="button" className="card !mb-0 text-left" onClick={() => addProduct(p)}>
              <div className="text-sm font-semibold text-ink">{p.name}</div>
              <div className="text-brand text-sm">{p.price} ₽</div>
            </button>
          ))}
        </div>

        {cart.length > 0 && (
          <div className="card space-y-2">
            <div className="font-semibold text-sm">Чек</div>
            {cart.map((l) => (
              <div key={l.productId} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{l.name}{l.free ? ' · 6-й' : ''}</span>
                <button type="button" className="p-1" onClick={() => setQty(l.productId, l.qty - 1)}><Minus size={14} /></button>
                <span>{l.qty}</span>
                <button type="button" className="p-1" onClick={() => setQty(l.productId, l.qty + 1)}><Plus size={14} /></button>
                <span className="w-12 text-right">{l.free ? 0 : l.price * l.qty} ₽</span>
              </div>
            ))}
          </div>
        )}

        {freeN > 0 && (
          <button type="button" className={`btn-ghost w-full mt-2 ${useFree ? 'text-ok' : ''}`} onClick={toggleFree}>
            {useFree ? 'Бесплатный 6-й: ВКЛ' : 'Выдать 6-й стакан'}
          </button>
        )}

        {vouchers.length > 0 && (
          <>
            <h2 className="text-sm font-semibold mt-3 mb-1">Купон</h2>
            <select className="input" value={voucherId ?? ''} onChange={(e) => setVoucherId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Без купона</option>
              {vouchers.map((v) => (
                <option key={v[0]} value={v[0]}>{v[1] === 'p' ? `−${v[2]}%` : `−${v[2]} ₽`}</option>
              ))}
            </select>
          </>
        )}

        {state.cb > 0 && (
          <>
            <h2 className="text-sm font-semibold mt-3 mb-1">Кэшбэк (списать)</h2>
            <input className="input" type="number" value={cashbackUse || ''}
              onChange={(e) => setCashbackUse(Math.min(state.cb, Math.max(0, Number(e.target.value))))} />
            <div className="text-ink-tertiary text-xs">Макс. {state.cb} ₽ · не больше суммы после скидки</div>
          </>
        )}

        <div className="card mt-3">
          {discount > 0 && <div className="text-ok text-sm">Купон: −{discount} ₽</div>}
          {cashbackUse > 0 && <div className="text-ok text-sm">Кэшбэк: −{Math.min(cashbackUse, afterDisc)} ₽</div>}
          <div className="text-2xl font-extrabold text-center text-ink">К оплате: {toPay} ₽</div>
          <div className="text-center text-xs text-ink-tertiary mt-1">стаканов в лояльность: {paidCups}{useFree ? ' + free' : ''}</div>
        </div>

        {error && <p className="text-bad text-sm mt-2">{error}</p>}

        <button type="button" className="btn mt-2" disabled={cart.length === 0 && !useFree} onClick={() => {
          setCashbackUse((c) => Math.min(c, afterDisc))
          void confirm()
        }}>
          Подтвердить чек лояльности
        </button>
        <button type="button" className="btn-ghost mt-2" onClick={() => setStage('idle')}>Отмена</button>
      </>
    )
  }

  return (
    <>
      <button type="button" className="btn flex items-center justify-center gap-2" onClick={() => setStage('scan')}>
        <ScanLine size={18} /> Сканировать карту клиента
      </button>
      {confirmAgain && (
        <div className="card mt-3 border-amber-200 bg-amber-50">
          <b className="text-sm text-amber-900">Карта уже пробита только что</b>
          <div className="flex gap-2 mt-2">
            <button type="button" className="btn btn-sm" onClick={() => { setLastScan(null); void onScan(confirmAgain) }}>Ещё раз</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirmAgain(null)}>Отмена</button>
          </div>
        </div>
      )}
      {error && <p className="text-bad text-sm mt-2">{error}</p>}
      {stale && (
        <div className="card mt-3">
          <b className="text-bad flex items-center gap-1"><X size={16} /> Карта устарела</b>
          <Qr value={stale} />
        </div>
      )}
      {stage === 'scan' && <ScanModal title="QR карты клиента" onResult={onScan} onClose={() => setStage('idle')} />}
    </>
  )
}
