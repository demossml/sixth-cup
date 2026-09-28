import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setJwt, unwrap } from '../api'
import { useApp } from '../lib/app'

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
    <div className="p-4">
      <div className="text-center pt-8 pb-6">
        <div className="text-5xl mb-2">☕</div>
        <h1 className="text-2xl font-bold text-brand">Шестой стакан</h1>
        <p className="text-muted text-sm mt-2">Каждый 6-й стакан — бесплатно.<br />Приведи друга — получай 3% с его покупок.</p>
      </div>
      <input className="input" placeholder="Телефон, например 79001234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
      {!sent ? (
        <>
          <input className="input" placeholder="Код приглашения (если есть)" value={invite} onChange={(e) => setInvite(e.target.value)} />
          <button className="btn" onClick={send}>Получить код</button>
        </>
      ) : (
        <>
          {hint && <p className="text-muted text-sm mb-2">Режим разработки: код <b>{hint}</b></p>}
          <input className="input" placeholder="Код из SMS" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn" onClick={verify}>Войти</button>
        </>
      )}
      {error && <p className="text-bad text-sm mt-2">{error}</p>}
      <p className="text-muted text-xs text-center mt-6">Работает и без интернета после первого входа</p>
    </div>
  )
}
