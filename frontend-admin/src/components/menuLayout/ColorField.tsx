import { useEffect, useId, useState } from 'react'
import { cx } from '../../ui/kit'
import { CONTRAST_LABEL, contrastRatio, contrastVerdict, formatColor, normalizeHex, parseColor, withAlpha } from '../../lib/color'

type Props = {
  label: string
  value: string
  onChange: (next: string) => void
  /** Пара для проверки контраста: обычно фон листа. */
  contrastWith?: string
  /** Готовые цвета: палитра бренда и недавние. */
  swatches?: readonly string[]
  disabled?: boolean
}

/**
 * Поле цвета: HEX текстом, системный пикер, прозрачность и предупреждение о контрасте.
 * Значение хранится как `#RRGGBB` или `#RRGGBBAA` — одинаково понимают CSS и PDF.
 */
export default function ColorField({ label, value, onChange, contrastWith, swatches = [], disabled }: Props) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [bad, setBad] = useState(false)
  const [pipetteHint, setPipetteHint] = useState<string | null>(null)

  // Внешнее изменение (палитра, шаблон) не должно затирать то, что человек печатает.
  useEffect(() => {
    setDraft(value)
    setBad(false)
  }, [value])

  const rgba = parseColor(value)
  const alpha = rgba ? Math.round(rgba.a * 100) : 100
  const verdict = contrastWith ? contrastVerdict(contrastRatio(value, contrastWith)) : null

  const commit = (raw: string) => {
    const next = normalizeHex(raw)
    if (!next) {
      setBad(true)
      return
    }
    setBad(false)
    setDraft(next)
    onChange(next)
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-[12px] text-ink-secondary">{label}</span>
        <input
          id={id}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            const next = normalizeHex(e.target.value)
            if (next) {
              setBad(false)
              onChange(next)
            } else {
              setBad(e.target.value.trim().length >= 4)
            }
          }}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit(draft)
            }
            if (e.key === 'Escape') {
              setDraft(value)
              setBad(false)
            }
            e.stopPropagation()
          }}
          spellCheck={false}
          aria-label={`${label}: HEX`}
          aria-invalid={bad}
          disabled={disabled}
          placeholder="#RRGGBB"
          className={cx(
            'h-7 w-[92px] rounded-md border px-1.5 text-[11.5px] font-semibold tabular-nums outline-none',
            bad ? 'border-bad text-bad' : 'border-line text-ink focus:border-brand',
          )}
        />
        <button
          type="button"
          onClick={async () => {
            // Пипетка — только Chromium; в остальных браузерах честно говорим об этом.
            const Ctor = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
            if (!Ctor) {
              setBad(false)
              setPipetteHint('Пипетка есть только в Chrome/Edge — введите HEX вручную')
              return
            }
            try {
              const shot = await new Ctor().open()
              const next = normalizeHex(shot.sRGBHex)
              if (next) {
                setDraft(next)
                onChange(next)
                setPipetteHint(null)
              }
            } catch {
              /* человек передумал — ничего страшного */
            }
          }}
          disabled={disabled}
          aria-label={`${label}: пипетка`}
          title="Взять цвет с экрана"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line text-ink-tertiary hover:text-brand disabled:opacity-40"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="m19 3 2 2-9.5 9.5-2-2L19 3Z" />
            <path d="M13 13 5 21H3v-2l8-8" />
          </svg>
        </button>
        <label className="relative h-7 w-7 shrink-0 cursor-pointer rounded-md border border-line" title="Открыть палитру">
          <span className="absolute inset-0 rounded-md" style={{ background: value }} />
          <input
            type="color"
            value={rgba ? formatColor({ ...rgba, a: 1 }) : '#000000'}
            onChange={(e) => {
              const next = rgba ? withAlpha(e.target.value.toUpperCase(), rgba.a) : e.target.value.toUpperCase()
              setDraft(next)
              setBad(false)
              onChange(next)
            }}
            disabled={disabled}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label={`${label}: палитра`}
          />
        </label>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wide text-ink-tertiary">прозрачность</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={alpha}
          onChange={(e) => {
            const next = withAlpha(value, Number(e.target.value) / 100)
            setDraft(next)
            setBad(false)
            onChange(next)
          }}
          disabled={disabled}
          aria-label={`${label}: прозрачность`}
          className="h-1.5 min-w-0 flex-1 accent-[var(--color-brand,#0B4A8D)]"
        />
        <span className="w-8 text-right text-[10.5px] tabular-nums text-ink-tertiary">{alpha}%</span>
      </div>

      {pipetteHint && <p className="mt-1 text-[10.5px] text-ink-tertiary">{pipetteHint}</p>}

      {verdict && (
        <p className={cx('mt-1 text-[10.5px]', verdict.level === 'fail' ? 'text-bad' : 'text-ink-tertiary')}>
          контраст {verdict.ratio} — {CONTRAST_LABEL[verdict.level]}
        </p>
      )}

      {swatches.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {swatches.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setDraft(c)
                setBad(false)
                onChange(c)
              }}
              aria-label={`Цвет ${c}`}
              title={c}
              style={{ background: c }}
              className={cx(
                'h-5 w-5 rounded-full border',
                value.toUpperCase() === c.toUpperCase() ? 'border-brand ring-1 ring-brand' : 'border-line',
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}
