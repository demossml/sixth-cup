import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ru } from '../copy/ru'
import { vibrationEnabled, setVibrationEnabled } from '../lib/haptics'
import { ArrowLeft, Smartphone } from '../lib/icons'

export default function AboutPage() {
  const [vib, setVib] = useState(() => vibrationEnabled())
  return (
    <div className="pb-6">
      <header className="px-4 pb-3 flex items-center gap-2" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <Link to="/more" aria-label="Назад" className="w-11 h-11 -ml-2 flex items-center justify-center text-ink"><ArrowLeft size={22} strokeWidth={1.75} /></Link>
        <h1 className="text-[22px] leading-7 font-semibold text-ink">{ru.more.about}</h1>
      </header>
      <div className="px-4 space-y-3">
        <div className="bg-white border border-line rounded-2xl shadow-card p-5 text-center">
          <img src="/logo-mark.png" alt="" width={64} height={64} className="w-16 h-16 rounded-2xl mx-auto bg-brand" />
          <p className="font-display text-[18px] font-semibold mt-3">6.7 Coffee</p>
          <p className="text-[13px] text-ink-secondary mt-1">Хороший кофе ближе, чем ты думаешь</p>
        </div>
        <div className="bg-white border border-line rounded-2xl shadow-card overflow-hidden">
          <button type="button" className="flex items-center gap-3 px-3.5 py-3 min-h-14 w-full text-left active:bg-brand-tint/60"
            onClick={() => { const next = !vib; setVibrationEnabled(next); setVib(next) }}>
            <Smartphone size={20} strokeWidth={1.75} className="text-brand shrink-0" />
            <span className="flex-1 min-w-0">
              <b className="block text-ink text-[15px] font-semibold">{ru.more.vibration}</b>
              <small className="block text-ink-secondary text-[13px] leading-[18px] mt-0.5">{ru.more.vibrationDetail}</small>
            </span>
            <span className={`text-[13px] font-semibold ${vib ? 'text-ok' : 'text-ink-tertiary'}`}>{vib ? 'Вкл' : 'Выкл'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
