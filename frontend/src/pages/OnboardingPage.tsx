import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Coffee, Gift, Users } from '../lib/icons'

const slides = [
  {
    icon: Coffee,
    title: 'Каждый 6-й бесплатно',
    text: 'Копите оплаченные стаканы. После пяти покупок следующий кофе — в подарок. Покажите QR на кассе — телефону интернет не нужен.',
  },
  {
    icon: Users,
    title: '3% с покупок друзей',
    text: 'Поделитесь ссылкой или QR. С каждой покупки приглашённого друга вам начисляется 3% кэшбэком — навсегда.',
  },
  {
    icon: Gift,
    title: 'Скидки и акции',
    text: 'Бонусы и предложения всегда актуальны: баланс считает сервер, а QR на экране — это ваша карта.',
  },
]

export default function OnboardingPage() {
  const [i, setI] = useState(0)
  const nav = useNavigate()
  const s = slides[i]
  const Icon = s.icon

  function next() {
    if (i < slides.length - 1) setI(i + 1)
    else {
      localStorage.setItem('sc-onboarded', '1')
      nav('/', { replace: true })
    }
  }

  function skip() {
    localStorage.setItem('sc-onboarded', '1')
    nav('/', { replace: true })
  }

  return (
    <div className="max-w-[480px] mx-auto min-h-screen bg-page flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <div className="w-20 h-20 rounded-3xl bg-brand-soft flex items-center justify-center mb-6">
          <Icon size={40} className="text-brand" strokeWidth={1.5} />
        </div>
        <h1 className="text-2xl font-bold text-ink mb-3">{s.title}</h1>
        <p className="text-ink-secondary text-[15px] leading-relaxed">{s.text}</p>
        <div className="flex gap-2 mt-8">
          {slides.map((_, idx) => (
            <div key={idx} className={`h-1.5 rounded-full transition-all ${idx === i ? 'w-6 bg-brand' : 'w-1.5 bg-line'}`} />
          ))}
        </div>
      </div>
      <div className="px-4 pb-10 space-y-2">
        <button className="btn" onClick={next}>
          {i < slides.length - 1 ? 'Далее' : 'Начать'}
        </button>
        {i < slides.length - 1 && (
          <button className="btn-ghost" onClick={skip}>Пропустить</button>
        )}
      </div>
    </div>
  )
}
