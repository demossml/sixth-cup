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

  const installLabel = canPrompt ? 'На экран' : ios ? 'Как установить' : null
  if (!visible && !restore) return null

  return (
    <div className="bg-white border border-line rounded-2xl shadow-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] leading-4 font-semibold text-ink-secondary">Настроить приложение</span>

        <div className="ml-auto flex items-center gap-1">
          {visible && installLabel ? (
            <button
              type="button"
              onClick={() => {
                if (canPrompt) {
                  setHint(null)
                  void install()
                  return
                }
                setHint('В Safari нажмите «Поделиться», затем «На экран „Домой“».')
              }}
              className="inline-flex items-center gap-1.5 min-h-9 px-2.5 rounded-lg text-[12.5px] font-semibold text-brand active:bg-brand-tint/60"
            >
              {canPrompt ? <Download size={14} strokeWidth={2} /> : <Smartphone size={14} strokeWidth={2} />}
              {installLabel}
            </button>
          ) : null}

          {restore ? (
            <button
              type="button"
              onClick={onSaveCode}
              className="inline-flex items-center gap-1.5 min-h-9 px-2.5 rounded-lg text-[12.5px] font-semibold text-brand active:bg-brand-tint/60"
            >
              Сохранить код
            </button>
          ) : null}
        </div>
      </div>

      {hint ? <p className="mt-1 text-[11px] leading-4 text-ink-secondary">{hint}</p> : null}
    </div>
  )
}
