import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IllCard, IllScan, IllStamps } from '../components/Illustrations'
import { useApp } from '../lib/app'

/**
 * Три коротких слайда, взрослый тон: без «Привет!», без восклицательных знаков.
 * Числа (сколько стаканов до подарка, процент друзей) — из настроек сервера, не зашиты в текст.
 */
export default function OnboardingPage() {
  const { dir, me } = useApp()
  const N = Math.max(1, me?.cupsForFree ?? dir?.cupsForFree ?? 5)
  const pct = dir?.referralCashbackPercent ?? 3
  const slides = [
    { Ill: IllCard, title: 'Карта уже у вас', text: 'Регистрироваться не нужно: код открывается сразу, без телефона и SMS.' },
    { Ill: IllScan, title: 'Покажите код на кассе', text: 'Бариста отметит напиток, и в карте появится штамп. Интернет для показа кода не нужен.' },
    { Ill: IllStamps, title: 'Накопите — получите в подарок', text: `После ${N} оплаченных стаканов следующий — бесплатный. Приглашённый друг приносит вам ${pct}% кэшбэка.` },
  ]
  const [i, setI] = useState(0)
  const nav = useNavigate()
  const s = slides[i]
  const Ill = s.Ill

  function finish() {
    try { localStorage.setItem('sc-onboarded', '1') } catch { /* private mode */ }
    nav('/', { replace: true })
  }
  const last = i === slides.length - 1

  return (
    <div className="max-w-[480px] mx-auto min-h-screen bg-page flex flex-col">
      <div className="flex justify-end px-4" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        {!last && (
          <button type="button" className="min-h-11 px-3 text-[15px] font-semibold text-brand" onClick={finish}>Пропустить</button>
        )}
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <div className="w-full max-w-[280px] aspect-[280/200] rounded-3xl bg-[#EDE7DC] p-4 mb-8">
          <Ill />
        </div>
        <h1 className="font-display text-[22px] leading-7 font-semibold text-ink mb-2">{s.title}</h1>
        <p className="text-ink-secondary text-[15px] leading-[22px] max-w-[300px]">{s.text}</p>
        <div className="flex gap-2 mt-8" aria-hidden>
          {slides.map((_, idx) => (
            <div key={idx} className={`h-1.5 rounded-full transition-all ${idx === i ? 'w-6 bg-brand' : 'w-1.5 bg-line'}`} />
          ))}
        </div>
      </div>
      <div className="px-4 space-y-2" style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}>
        <button className="btn" onClick={() => (last ? finish() : setI(i + 1))}>{last ? 'К карте' : 'Далее'}</button>
      </div>
    </div>
  )
}
