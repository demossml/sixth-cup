import { useState } from 'react'

import { Download, Smartphone } from '../lib/icons'
import { useInstall } from '../lib/installStore'

/**
 * Аудит F-07: на главной было два отдельных баннера — установка PWA и «сохраните код
 * восстановления». Схлопнули в одну компактную строку «Настроить приложение»: она не
 * спорит с картой за внимание и появляется только когда есть что настраивать.
 */
export default function AppSetup({
  restore,
  onSaveCode,
}: {
  /** Показывать «Сохранить код» — когда кода ещё нет. */
  restore: boolean
  onSaveCode: () => void
}) {
  const { visible, canPrompt, ios, install } = useInstall()
  const [hint, setHint] = useState<string | null>(null)

  if (!visible && !restore) return null

  return (
    <div className="bg-white border border-line rounded-2xl shadow-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] leading-4 font-semibold text-ink-secondary">Настроить приложение</span>

        <div className="ml-auto flex items-center gap-1">
          {visible && canPrompt ? (
            <button
              type="button"
              onClick={() => { setHint(null); void install() }}
              className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-[12.5px] font-semibold text-brand active:bg-brand-tint/60"
            >
              <Download size={14} strokeWidth={2} />
              На экран
            </button>
          ) : null}

          {restore ? (
            <button
              type="button"
              onClick={onSaveCode}
              className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-[12.5px] font-semibold text-brand active:bg-brand-tint/60"
            >
              Сохранить код
            </button>
          ) : null}
        </div>
      </div>

      {/* Аудит F-05: на iOS нет beforeinstallprompt — показываем инструкцию сразу,
          а не кнопку, которая ничего не делает. */}
      {visible && !canPrompt && ios ? (
        <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-4 text-ink-secondary">
          <Smartphone size={12} strokeWidth={2} className="mt-0.5 flex-none text-brand" />
          В Safari листните: «Поделиться» → «На экран „Домой“».
        </p>
      ) : hint ? (
        <p className="mt-1 text-[11px] leading-4 text-ink-secondary">{hint}</p>
      ) : null}
    </div>
  )
}
