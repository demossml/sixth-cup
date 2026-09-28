import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Qr from '../components/Qr'
import ScanModal from '../components/ScanModal'
import { useApp } from '../lib/app'
import { createReceipt, enroll, loadCreds, syncCashier, type DeviceCreds } from '../lib/cashier'
import { getSeen } from '../lib/db'
import { activeVouchers, discountFor, freeAvailable, progress, verifyProof } from '../lib/proof'
import type { CardState, Directory, ReceiptPayload } from '../lib/types'

export default function CashierPage() {
  const { dir, reload } = useApp()
  const [creds, setCreds] = useState<DeviceCreds | null | undefined>(undefined)

  useEffect(() => { loadCreds().then((c) => setCreds(c ?? null)) }, [])

  useEffect(() => {
    if (!creds) return
    const run = () => { void syncCashier(creds).then(reload) }
    run()
    const t = setInterval(run, 30_000)
    return () => clearInterval(t)
  }, [creds, reload])

  if (creds === undefined) return <div className="p-4 text-muted">Загрузка…</div>
  if (!creds) return <Enroll onDone={setCreds} />

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-3">
        <h1 className="text-xl font-bold">Касса · {creds.storeName}</h1>
        <Link to="/" className="text-brand">←</Link>
      </div>
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
      <h1 className="text-xl font-bold mb-2">Регистрация кассы</h1>
      <p className="text-muted text-sm mb-3">Введите код от владельца. Нужен интернет (один раз).</p>
      <input className="input" placeholder="Код, например DEMO1234" value={code} onChange={(e) => setCode(e.target.value)} />
      <button className="btn" onClick={async () => {
        try { onDone(await enroll(code)) } catch (e) { setError((e as Error).message) }
      }}>Зарегистрировать</button>
      {error && <p className="text-bad text-sm mt-2">{error}</p>}
    </div>
  )
}

function Sale({ creds, dir }: { creds: DeviceCreds; dir: Directory }) {
  const N = dir.cupsForFree
  const [stage, setStage] = useState<'idle' | 'scan' | 'form' | 'done'>('idle')
  const [state, setState] = useState<CardState | null>(null)
  const [error, setError] = useState('')
  const [stale, setStale] = useState<string | null>(null)
  const [cups, setCups] = useState(1)
  const [useFree, setUseFree] = useState(false)
  const [voucherId, setVoucherId] = useState<number | null>(null)
  const [cashbackUse, setCashbackUse] = useState(0)
  const [amount, setAmount] = useState(0)
  const [result, setResult] = useState<{ token: string; payload: ReceiptPayload } | null>(null)

  async function onScan(text: string) {
    setError('')
    setStale(null)
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
    setState(v.payload)
    setCups(1)
    setUseFree(false)
    setVoucherId(null)
    setCashbackUse(0)
    setAmount(0)
    setStage('form')
  }

  async function confirm() {
    if (!state) return
    const r = await createReceipt(creds, state, { cups, useFree, voucherId, cashbackUse, amount })
    setResult(r)
    setStage('done')
  }

  if (stage === 'done' && result) {
    const p = result.payload
    return (
      <>
        <div className="card">
          <b>Чек создан · клиент №{p.u}</b>
          <div className="text-sm mt-1">Стаканов: {p.p} (прогресс {progress(p, N)}/{N}){p.df ? ' · выдан бесплатный' : ''}</div>
          {p.dcb > 0 && <div className="text-sm text-ok">Списано кэшбэка: {p.dcb} ₽</div>}
        </div>
        <p className="text-muted text-sm">Пусть клиент нажмёт «Сканировать чек»:</p>
        <Qr value={result.token} />
        <details>
          <summary className="text-muted text-sm cursor-pointer">Технический код чека</summary>
          <textarea className="input text-xs" readOnly value={result.token} rows={3} onFocus={(e) => e.target.select()} />
        </details>
        <button className="btn mt-2" onClick={() => setStage('idle')}>Готово</button>
      </>
    )
  }

  if (stage === 'form' && state) {
    const vouchers = activeVouchers(state)
    const voucher = vouchers.find((v) => v[0] === voucherId)
    const discount = discountFor(voucher, amount)
    const free = freeAvailable(state, N)
    const toPay = Math.max(0, amount - discount - cashbackUse)

    return (
      <>
        <div className="card">
          <b>Клиент №{state.u}</b>
          <div className="text-sm">Прогресс: {progress(state, N)}/{N} · бесплатных: {free}</div>
          {state.cb > 0 && <div className="text-ok text-sm">Кэшбэк на карте: {state.cb} ₽</div>}
        </div>

        <h2 className="text-base font-semibold mt-3 mb-1">Куплено оплачиваемых стаканов</h2>
        <div className="flex items-center justify-center gap-4 my-2">
          <button className="btn-ghost btn-sm" onClick={() => setCups(Math.max(0, cups - 1))}>−</button>
          <div className="text-4xl font-extrabold">{cups}</div>
          <button className="btn-ghost btn-sm" onClick={() => setCups(cups + 1)}>+</button>
        </div>

        {free > 0 && (
          <label className="card flex justify-between items-center cursor-pointer">
            <span>🎁 Выдать бесплатный стакан</span>
            <input type="checkbox" className="w-6 h-6" checked={useFree} onChange={(e) => setUseFree(e.target.checked)} />
          </label>
        )}

        <h2 className="text-base font-semibold mt-3 mb-1">Купон</h2>
        <div className="flex flex-wrap gap-2 mb-2">
          <span className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer ${voucherId === null ? 'bg-brand-soft border-brand text-brand' : 'border-line'}`} onClick={() => setVoucherId(null)}>Без купона</span>
          {vouchers.map((v) => (
            <span key={v[0]} className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer ${voucherId === v[0] ? 'bg-brand-soft border-brand text-brand' : 'border-line'}`} onClick={() => setVoucherId(v[0])}>
              {v[1] === 'p' ? `−${v[2]}%` : `−${v[2]} ₽`}
            </span>
          ))}
        </div>

        {state.cb > 0 && (
          <>
            <h2 className="text-base font-semibold mt-3 mb-1">Списать кэшбэк, ₽</h2>
            <input className="input" type="number" inputMode="numeric" value={cashbackUse || ''} onChange={(e) => setCashbackUse(Math.min(state.cb, Math.max(0, Number(e.target.value))))} />
            <div className="text-muted text-xs -mt-1 mb-2">Максимум: {state.cb} ₽</div>
          </>
        )}

        <h2 className="text-base font-semibold mt-3 mb-1">Сумма по чеку, ₽</h2>
        <input className="input" type="number" inputMode="numeric" value={amount || ''} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} />
        <div className="card">
          {discount > 0 && <div className="text-ok text-sm">Скидка по купону: −{discount} ₽</div>}
          {cashbackUse > 0 && <div className="text-ok text-sm">Кэшбэк: −{cashbackUse} ₽</div>}
          <div className="text-3xl font-extrabold text-center mt-1">К оплате: {toPay} ₽</div>
        </div>

        <button className="btn" disabled={cups === 0 && !useFree && !voucher && cashbackUse === 0} onClick={confirm}>
          Подтвердить и создать чек
        </button>
        <button className="btn-ghost mt-2" onClick={() => setStage('idle')}>Отмена</button>
      </>
    )
  }

  return (
    <>
      <button className="btn" onClick={() => setStage('scan')}>📷 Сканировать карту клиента</button>
      {error && <p className="text-bad text-sm mt-2">{error}</p>}
      {stale && (
        <div className="card mt-3">
          <b className="text-bad">Карта клиента устарела</b>
          <p className="text-muted text-sm">Пусть клиент отсканирует актуальный чек, а потом покажет карту снова:</p>
          <Qr value={stale} />
        </div>
      )}
      {stage === 'scan' && <ScanModal title="Отсканируйте QR карты клиента" onResult={onScan} onClose={() => setStage('idle')} />}
    </>
  )
}
