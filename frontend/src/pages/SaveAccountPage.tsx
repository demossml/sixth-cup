import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Qr from '../components/Qr'
import { createRecoveryToken } from '../lib/auth'
import { ChevronLeft, Share2 } from '../lib/icons'

export default function SaveAccountPage() {
  const nav = useNavigate()
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    createRecoveryToken()
      .then((token) => setUrl(`${location.origin}/recover?token=${encodeURIComponent(token)}`))
      .catch((e) => setError((e as Error).message))
  }, [])

  async function share() {
    if (!url) return
    if (navigator.share) await navigator.share({ title: '6.7 Coffee — восстановление аккаунта', url })
    else await navigator.clipboard?.writeText(url)
  }

  return (
    <div className="pb-8">
      <div className="bg-brand text-white px-4 pt-8 pb-6 rounded-b-3xl">
        <button className="flex items-center gap-1 text-white/80 text-sm mb-4" onClick={() => nav(-1)}><ChevronLeft size={18} /> Назад</button>
        <h1 className="text-xl font-bold">Сохранить аккаунт</h1>
        <p className="text-white/75 text-sm mt-1">Этот QR поможет восстановить ваши стаканы и кэшбэк на другом телефоне.</p>
      </div>
      <div className="px-4 pt-5">
        <div className="card text-center">
          {url ? <><p className="text-sm font-semibold">Сохраните этот QR-код</p><div className="flex justify-center py-5"><Qr value={url} /></div><button className="btn flex items-center justify-center gap-2" onClick={share}><Share2 size={18} /> Поделиться / сохранить</button></> : <p className="text-sm text-ink-secondary">Готовим QR-код…</p>}
          {error && <p className="text-bad text-sm mt-3">{error}</p>}
        </div>
        <p className="text-xs text-ink-tertiary text-center mt-3">QR восстановления одноразовый. После восстановления будет создан новый.</p>
      </div>
    </div>
  )
}
