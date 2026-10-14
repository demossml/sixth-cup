import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IllCard, IllScan, IllStamps } from '../components/Illustrations'
import { useApp } from '../lib/app'

type Slide = {
  Ill: () => JSX.Element
  title: string
  text: string
  /** Brand gradient tone for hero panel */
  tone: 'brand' | 'deep' | 'crema'
}

/**
 * Онбординг photo-first: крупный visual-блок (~45% экрана) + короткий текст + один CTA.
 * Числа (чашки до подарка, % друзей) — с сервера. Без emoji, без «Привет!».
 * Когда появятся реальные фото — можно подставить через public/ или CMS; пока — brand panel + SVG.
 */
export default function OnboardingPage() {
  const { dir, me } = useApp()
  const N = Math.max(1, me?.cupsForFree ?? dir?.cupsForFree ?? 5)
  const pct = dir?.referralCashbackPercent ?? 3
  const slides: Slide[] = [
    {
      Ill: IllCard,
      title: 'Карта уже у вас',
      text: 'Регистрироваться не нужно: код открывается сразу, без телефона и SMS.',
      tone: 'brand',
    },
    {
      Ill: IllScan,
      title: 'Покажите код на кассе',
      text: 'Бариста отметит напиток, и в карте появится штамп. Интернет для показа кода не нужен.',
      tone: 'deep',
    },
    {
      Ill: IllStamps,
      title: 'Накопите — получите в подарок',
      text: `После ${N} оплаченных стаканов следующий — бесплатный. Приглашённый друг приносит вам ${pct}% кэшбэка.`,
      tone: 'crema',
    },
  ]
  const [i, setI] = useState(0)
  const nav = useNavigate()
  const s = slides[i]
  const Ill = s.Ill
  const last = i === slides.length - 1

  function finish() {
    try {
      localStorage.setItem('sc-onboarded', '1')
    } catch {
      /* private mode */
    }
    nav('/', { replace: true })
  }

  const heroBg =
    s.tone === 'crema'
      ? 'bg-gradient-to-br from-[#C8A26E] via-[#002FA7] to-[#001F6B]'
      : s.tone === 'deep'
        ? 'bg-gradient-to-br from-[#001F6B] via-[#002FA7] to-[#1a4dd6]'
        : 'bg-gradient-to-br from-[#1a4dd6] via-[#002FA7] to-[#001F6B]'

  return (
    <div className="max-w-[480px] mx-auto min-h-screen bg-page flex flex-col">
      {/* Hero visual — ~45% first screen */}
      <section className={`relative min-h-[42vh] overflow-hidden ${heroBg}`}>
        <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/40" />
        <div
          className="relative z-10 flex flex-col h-full min-h-[42vh] px-5"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img
                src="/logo-mark.png"
                alt=""
                width={28}
                height={28}
                className="w-7 h-7 rounded-lg"
                style={{ mixBlendMode: 'lighten' }}
              />
              <span className="text-[12px] font-semibold tracking-wide text-white/90">6.7 Coffee</span>
            </div>
            {!last && (
              <button
                type="button"
                className="min-h-11 px-3 text-[14px] font-semibold text-white/90"
                onClick={finish}
              >
                Пропустить
              </button>
            )}
          </div>

          <div className="flex-1 flex items-center justify-center py-4">
            <div className="w-full max-w-[300px] aspect-[280/200] rounded-3xl bg-white/95 shadow-lift p-3">
              <Ill />
            </div>
          </div>
        </div>
      </section>

      {/* Copy + dots + CTA */}
      <div className="flex-1 flex flex-col px-6 pt-6 text-center">
        <h1 className="font-display text-[24px] leading-8 font-semibold text-ink">{s.title}</h1>
        <p className="mt-2 text-ink-secondary text-[15px] leading-[22px] max-w-[320px] mx-auto">{s.text}</p>

        <div className="flex gap-2 mt-6 justify-center" aria-hidden>
          {slides.map((_, idx) => (
            <div
              key={idx}
              className={`h-1.5 rounded-full transition-all ${idx === i ? 'w-6 bg-brand' : 'w-1.5 bg-line'}`}
            />
          ))}
        </div>

        <div className="flex-1" />

        <div className="space-y-2 pb-2" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
          <button type="button" className="btn min-h-12" onClick={() => (last ? finish() : setI(i + 1))}>
            {last ? 'К карте' : 'Далее'}
          </button>
          {last ? (
            <p className="text-[12px] leading-4 text-ink-tertiary">Заказ и оплата — на кассе</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
