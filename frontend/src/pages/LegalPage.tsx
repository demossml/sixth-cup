import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ru } from '../copy/ru'
import { ArrowLeft } from '../lib/icons'

type Content = { legal_loyalty?: string; legal_privacy?: string; seller_info?: string }

export default function LegalPage() {
  const [c, setC] = useState<Content>({})
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/public/content')
        if (!r.ok) return
        const j = (await r.json()) as Content
        if (!cancelled) setC(j)
      } catch { /* offline fallbacks */ }
    })()
    return () => { cancelled = true }
  }, [])
  const block = (title: string, body: string) => (
    <section className="card mb-3">
      <h2 className="text-[16px] font-semibold text-ink mb-2">{title}</h2>
      <p className="text-[14px] text-ink-secondary leading-5 whitespace-pre-wrap">{body}</p>
    </section>
  )
  return (
    <div className="pb-8">
      <header className="px-4 pb-3 flex items-center gap-2" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
        <Link to="/more" className="text-brand p-1" aria-label="Назад"><ArrowLeft size={22} /></Link>
        <h1 className="text-[22px] font-semibold text-ink">{ru.legal.title}</h1>
      </header>
      <div className="px-4">
        {block(ru.legal.loyalty, c.legal_loyalty || ru.legal.fallbackLoyalty)}
        {block(ru.legal.privacy, c.legal_privacy || ru.legal.fallbackPrivacy)}
        {block(ru.legal.seller, c.seller_info || ru.legal.fallbackSeller)}
      </div>
    </div>
  )
}
