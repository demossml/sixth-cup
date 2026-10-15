import BrandLogo from '../components/BrandLogo'
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

  // Необязательное фото слайда: положите public/onboarding/1.jpg … 3.jpg — оно появится само;
  // нет файла — остаётся тёмный фон с иллюстрацией.
  const [photoOk, setPhotoOk] = useState<Record<number, boolean>>({ 0: true, 1: true, 2: true })

  return (
    <div className="max-w-[480px] mx-auto min-h-screen bg-night text-white flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(110%_70%_at_80%_0%,#3a2c1b_0%,#16130f_55%,#0e0e0f_100%)]" />
      {photoOk[i] && (
        <img
          key={i}
          src={`/onboarding/${i + 1}.jpg`}
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-80"
          onError={() => setPhotoOk((m) => ({ ...m, [i]: false }))}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/90" />

      <div
        className="relative z-10 flex flex-col flex-1 px-6"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
      >
        <BrandLogo tone="onDark" size="sm" />

        <div className="flex-1 flex items-center justify-center py-4">
          {!photoOk[i] && (
            <div className="w-full max-w-[280px] aspect-[280/200] rounded-3xl bg-white/10 backdrop-blur-sm border border-white/15 p-3">
              <Ill />
            </div>
          )}
        </div>

        <h1 className="font-display text-[28px] leading-8 font-semibold">{s.title}</h1>
        <p className="mt-2 text-white/75 text-[15px] leading-[22px] max-w-[340px]">{s.text}</p>

        <div className="flex gap-2 mt-5" aria-hidden>
          {slides.map((_, idx) => (
            <div key={idx} className={`h-1.5 rounded-full transition-all ${idx === i ? 'w-6 bg-white' : 'w-1.5 bg-white/35'}`} />
          ))}
        </div>

        <div className="mt-6 space-y-1">
          <button type="button" className="btn min-h-12" onClick={() => (last ? finish() : setI(i + 1))}>
            {last ? 'К карте' : 'Далее'}
          </button>
          <button type="button" className="w-full min-h-11 text-[14px] font-semibold text-white/80" onClick={finish}>
            {last ? 'Заказ и оплата — на кассе' : 'Пропустить'}
          </button>
        </div>
      </div>
    </div>
  )
}
