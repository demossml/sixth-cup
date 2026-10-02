import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setJwt, unwrap } from '../api'
import { useApp } from '../lib/app'
import { Coffee } from '../lib/icons'

export default function LoginPage() {
  const nav = useNavigate()
  const { sync } = useApp()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [invite, setInvite] = useState(localStorage.getItem('sc-invite') ?? '')
  const [sent, setSent] = useState(false)
  const [hint, setHint] = useState('')
  const [error, setError] = useState('')

  async function send() {
    try {
      setError('')
      const r = await unwrap(api.api.auth['send-code'].$post({ json: { phone } }))
      setSent(true)
      setHint(r.devCode ?? '')
    } catch (e) {
      setError(navigator.onLine ? (e as Error).message : 'Нет интернета. Первый вход — по Wi-Fi.')
    }
  }

  async function verify() {
    try {
      setError('')
      const r = await unwrap(api.api.auth.verify.$post({ json: { phone, code, inviteCode: invite || undefined } }))
      setJwt(r.token)
      await sync()
      nav('/')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="bg-brand px-6 pt-14 pb-10 text-white rounded-b-3xl">
        <div className="w-20 h-20 rounded-2xl bg-white/10 flex items-center justify-center mb-4 overflow-hidden">
          <img src="/logo-alpaca.png" alt="6.7 Coffee" className="w-14 h-14 object-contain" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">6.7 Coffee</h1>
        <p className="text-white/80 text-sm mt-2 leading-relaxed">
          Каждый 6-й стакан бесплатно.<br />
          Приведи друга — получай 3% с его покупок.
        </p>
      </div>

      <div className="px-4 pt-6 flex-1">
        <input className="input" placeholder="Телефон, например 79001234567" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        {!sent ? (
          <>
            <input className="input" placeholder="Код приглашения (если есть)" value={invite} onChange={(e) => setInvite(e.target.value)} />
            <button className="btn" onClick={send}>Получить код</button>
          </>
        ) : (
          <>
            {hint && (
              <div className="card bg-brand-soft border-brand/20 text-sm text-brand mb-3">
                Режим разработки: код <b className="tracking-widest">{hint}</b>
              </div>
            )}
            <input className="input" placeholder="Код из SMS" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={4} />
            <button className="btn" onClick={verify}>Войти</button>
          </>
        )}
        {error && <p className="text-bad text-sm mt-3">{error}</p>}
        <p className="text-ink-tertiary text-xs text-center mt-8">После первого входа работает без интернета</p>
      </div>
    </div>
  )
}
