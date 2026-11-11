import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IllCard, IllScan, IllStamps } from '../components/Illustrations'
import { useApp } from '../lib/app'
import { isValidInviteCode, parseInviteInput } from '../lib/invite'
import { applyInvite } from '../lib/ensureGuest'
import { Gift, RefreshCw } from '../lib/icons'

type Slide = {
  Ill: () => JSX.Element
  title: string
  text: string
}

/**
 * Онбординг по стильборду: 3 слайда, логотип 6.7 (наш PNG), тексты с API.
 * Фото: public/onboarding/1.jpg … 3.jpg — если есть; иначе иллюстрация.
 * Лого: /logo-mark.png на белой подложке (маскот цветной, светлый фон читается на тёмной шапке).
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

  // Код друга можно ввести до создания карты: после регистрации привязка уже невозможна.
  const [codeOpen, setCodeOpen] = useState(false)
  const [code, setCode] = useState('')
  const [codeBusy, setCodeBusy] = useState(false)
  const [codeResult, setCodeResult] = useState<'ok' | 'invalid' | 'offline' | 'rate_limited' | null>(null)

  async function applyCode() {
    const value = parseInviteInput(code)
    setCodeResult(null)
    if (!isValidInviteCode(value)) { setCodeResult('invalid'); return }
    setCodeBusy(true)
    const r = await applyInvite(value)
    setCodeBusy(false)
    setCodeResult(r === 'ok' ? 'ok' : r === 'invalid_invite' ? 'invalid' : r)
    if (r === 'ok') setCode(value)
  }

  const codeMessage =
    codeResult === 'invalid' ? 'Код не найден. Проверьте ссылку друга — код состоит из 4–40 символов: буквы, цифры, «-» и «_».'
      : codeResult === 'offline' ? 'Нет сети. Код сохранён и применится, когда появится интернет.' 
        : codeResult === 'rate_limited' ? 'Слишком много попыток с этого адреса. Подождите пару минут.'
          : codeResult === 'ok' ? 'Код принят: карта создастся уже с приглашением друга.' 
            : null

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
            className="w-9 h-9 rounded-xl bg-white ring-1 ring-black/5 object-contain p-0.5 shrink-0"
          />
          <span className="font-display text-[16px] font-semibold leading-5 tracking-tight">6<span className="brand-dot" aria-hidden /><span className="sr-only">.</span>7 Coffee</span>
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

        {/* Аудит F-05: точки были aria-hidden — гость не знал, сколько шагов и где он. */}
        <div className="flex items-center gap-2 mt-5">
          <div className="flex gap-2" aria-hidden>
            {slides.map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 rounded-full transition-all ${idx === i ? 'w-6 bg-white' : 'w-1.5 bg-white/35'}`}
              />
            ))}
          </div>
          <span className="text-[12px] leading-4 text-white/70 num">Шаг {i + 1} из {slides.length}</span>
        </div>

        {/* Ручной ввод кода друга — до создания карты. */}
        <div className="mt-5">
          {!codeOpen ? (
            <button
              type="button"
              className="w-full min-h-10 text-[13px] font-semibold text-white/80 inline-flex items-center justify-center gap-1.5"
              onClick={() => setCodeOpen(true)}
            >
              <Gift size={14} strokeWidth={1.75} /> У меня есть код друга
            </button>
          ) : (
            <div className="rounded-2xl bg-white/10 border border-white/20 p-3">
              <label htmlFor="invite-code" className="block text-[12px] leading-4 text-white/75 mb-1.5">
                Код или ссылка друга
              </label>
              <div className="flex gap-2">
                <input
                  id="invite-code"
                  value={code}
                  onChange={(e) => { setCode(e.target.value); setCodeResult(null) }}
                  readOnly={codeResult === 'ok'}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="4–40 символов: буквы, цифры, - и _"
                  className="min-w-0 flex-1 rounded-xl bg-white text-ink px-3 min-h-11 text-[15px] num"
                />
                {codeResult === 'ok' ? (
                  <span className="min-h-11 px-4 shrink-0 inline-flex items-center text-[15px] font-semibold text-white" aria-hidden="true">✓</span>
                ) : (
                  <button
                    type="button"
                    disabled={codeBusy || !code.trim()}
                    className="btn min-h-11 px-4 shrink-0 disabled:opacity-60"
                    onClick={() => void applyCode()}
                  >
                    {codeBusy ? <RefreshCw size={16} className="animate-spin motion-reduce:animate-none" /> : 'Применить'}
                  </button>
                )}
              </div>
              {!code.trim() && !codeMessage && (
                <p className="mt-1.5 text-[12px] leading-4 text-white/70">
                  Введите код или вставьте ссылку друга
                </p>
              )}
              {codeMessage && (
                <p className={`mt-1.5 text-[12px] leading-4 ${codeResult === 'ok' ? 'text-white' : 'text-white/85'}`}>
                  {codeMessage}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 space-y-1">
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
