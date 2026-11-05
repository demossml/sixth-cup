import { useEffect, useRef } from 'react'
import { Gift } from '../lib/icons'

/**
 * Прогресс «N+1-й стакан — в подарок» по PROGRESS-STICKERS-SPEC.
 *
 * Марки — только из серверного прогресса, пустые позиции не рисуются вообще:
 * полоса сохраняет высоту 36 px, чтобы карта-пропуск не прыгала после первой покупки.
 * Подарок — отдельная строка и только когда он реально доступен (5 марок).
 */
type Props = {
  /** Покупок до подарка (cupsForFree). */
  n: number
  /** Сколько марок показывать: серверный прогресс, максимум n. */
  marks: number
  /** Подарок доступен (freeAvailable > 0). */
  gift: boolean
}

/** Одна марка: бумажная наклейка с кобальтовым силуэтом стакана. */
function Stamp({ fresh }: { fresh: boolean }) {
  return (
    <span
      className={`stamp ${fresh ? 'stamp-fresh' : ''}`}
      aria-hidden="true"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V8Z" />
        <path d="M16 9h2a3 3 0 0 1 0 6h-2" />
        <path d="M7 4h7" />
      </svg>
    </span>
  )
}

export default function ProgressStamps({ n, marks, gift }: Props) {
  const shown = Math.max(0, Math.min(n, marks))
  // Анимируем только марку, которая появилась при открытом экране.
  // При холодном старте prev === shown → всё статично, каскада нет.
  const prev = useRef(shown)
  const freshFrom = prev.current < shown ? prev.current : -1
  useEffect(() => { prev.current = shown }, [shown])

  return (
    <>
      <div
        className="stamps"
        role="img"
        aria-label={`Куплено ${shown} из ${n}, подарок ${gift ? 'доступен' : 'недоступен'}`}
      >
        {Array.from({ length: shown }, (_, i) => (
          <Stamp key={i} fresh={i >= freshFrom && freshFrom >= 0} />
        ))}
      </div>
      {gift && (
        <div className="gift-row">
          <span className="gift-icon" aria-hidden="true">
            <Gift size={16} strokeWidth={1.8} />
          </span>
          <span className="min-w-0">
            <span className="gift-title">Подарок доступен</span>
            <span className="gift-sub">Скажите бариста — заберёте на кассе</span>
          </span>
        </div>
      )}
    </>
  )
}
