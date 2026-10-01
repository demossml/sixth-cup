import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useRecoveryToken } from '../lib/auth'

export default function RecoveryPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [state, setState] = useState<'loading' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!token) {
      setState('error')
      setMessage('QR восстановления не содержит токен.')
      return
    }
    useRecoveryToken(token)
      .then(() => { localStorage.setItem('sc-launch-count', '1'); location.replace('/') })
      .catch((e) => { setState('error'); setMessage((e as Error).message) })
  }, [token])

  if (state === 'loading') return <div className="min-h-screen max-w-[480px] mx-auto bg-page p-6 flex items-center justify-center"><div className="card text-center">Восстанавливаем аккаунт…</div></div>
  return <div className="min-h-screen max-w-[480px] mx-auto bg-page p-6 flex items-center justify-center"><div className="card text-center"><h1 className="text-xl font-bold">Не удалось восстановить аккаунт</h1><p className="text-bad text-sm mt-2">{message}</p><button className="btn mt-4" onClick={() => location.href = '/'}>На главную</button></div></div>
}
