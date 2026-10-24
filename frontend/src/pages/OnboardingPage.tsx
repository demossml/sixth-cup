import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IllCard, IllScan, IllStamps } from '../components/Illustrations'
import { useApp } from '../lib/app'

type Slide = {
  Ill: () => JSX.Element
  title: string
  text: string
}

/**
 * Онбординг по стильборду: 3 слайда, логотип 6.7 (наш PNG), тексты с API.
 * Фото: public/onboarding/1.jpg … 3.jpg — если есть; иначе иллюстрация.
 * Лого: /logo-mark.png без mix-blend (lighten прятал mark).
 */
export default function OnboardingPage() {
  const { dir, me } = useApp()
  const N = Math.max(1, me?.cupsForFree ?? dir?.cupsForFree ?? 5)
  const pct = dir?.referralCashbackPercent ?? 3

  const slides: Slide[] = [
    {
      Ill: IllCard,
      title: 'Ваша карта уже в телефоне',
      text: 'Никаких SMS и регистрации. Просто откройте приложение.',
    },
    {
      Ill: IllScan,
      title: 'Покажите QR на кассе',
      text: 'Бариста отсканирует код и начислит стаканы.',
    },
    {
      Ill: IllStamps,
      title: `Ещё ${N} стаканов до подарка`,
      text: `Пригласите друга — получите ${pct}% кэшбэка.`,
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

  const [photoOk, setPhotoOk] = useState<Record<number, boolean>>({ 0: true, 1: true, 2: true })

  return (
    <div className="max-w-[480px] mx-auto min-h-screen bg-[#0E0E0F] text-white flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 bg-brand" />
      {photoOk[i] ? (
        <img
          key={i}
          src={`/onboarding/${i + 1}.jpg`}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setPhotoOk((m) => ({ ...m, [i]: false }))}
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/25 to-black/90" />

      <div
        className="relative z-10 flex flex-col flex-1 px-6"
        style={{
          paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
        }}
      >
        {/* Наш логотип: mark PNG + wordmark, без mix-blend */}
        <div className="flex items-center gap-2.5">
          <img
            src="/logo-mark.png"
            alt=""
            width={36}
            height={36}
            className="w-9 h-9 rounded-xl bg-brand object-contain p-0.5 shrink-0"
          />
          <span className="font-display text-[16px] font-semibold leading-5 tracking-tight">6.7 Coffee</span>
        </div>

        <div className="flex-1 flex items-center justify-center py-5 min-h-[40vh]">
          {!photoOk[i] ? (
            <div className="w-full max-w-[300px] aspect-[300/220] rounded-3xl bg-white/10 backdrop-blur-sm border border-white/15 p-4 flex items-center justify-center">
              <Ill />
            </div>
          ) : null}
        </div>

        <h1 className="font-display text-[28px] leading-8 font-semibold">{s.title}</h1>
        <p className="mt-2 text-white/80 text-[15px] leading-[22px] max-w-[340px]">{s.text}</p>

        <div className="flex gap-2 mt-5" aria-hidden>
          {slides.map((_, idx) => (
            <div
              key={idx}
              className={`h-1.5 rounded-full transition-all ${idx === i ? 'w-6 bg-white' : 'w-1.5 bg-white/35'}`}
            />
          ))}
        </div>

        <div className="mt-6 space-y-1">
          <button
            type="button"
            className="btn min-h-12"
            onClick={() => (last ? finish() : setI(i + 1))}
          >
            {last ? 'К карте' : 'Далее'}
          </button>
          <button type="button" className="w-full min-h-11 text-[14px] font-semibold text-white/75" onClick={finish}>
            Пропустить
          </button>
        </div>
      </div>
    </div>
  )
}
