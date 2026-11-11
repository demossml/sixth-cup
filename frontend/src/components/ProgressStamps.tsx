import { useEffect, useRef } from 'react'

/**
 * Прогресс «N+1-й стакан — в подарок» по PROGRESS-STICKERS-SPEC.
 *
 * Марки — только из серверного прогресса. Несобранные позиции — пустой пунктирный
 * слот (не арт, а разметка): шкала читается как «лестница N шагов», как в Luckin,
 * и полоса больше не выглядит дырой до первой покупки. Высота всегда 40 px.
 * Арт марки — единственный ассет `sticker-scratch*` (не рисуем свои кружки/чашки).
 */
type Props = {
  /** Покупок до подарка (cupsForFree). */
  n: number
  /** Сколько марок показывать: серверный прогресс, максимум n. */
  marks: number
  /** Подарок доступен — только для доступного имени полосы (визуально это чип в шапке). */
  gift?: boolean
}

/** Пустой шаг шкалы: только разметка, без изображения. */
function Slot() {
  return <span className="stamp-slot" aria-hidden="true" />
}

function Stamp({ fresh }: { fresh: boolean }) {
  return (
    <span className={`stamp ${fresh ? 'stamp-fresh' : ''}`} aria-hidden="true">
      <img src="/stickers/sticker-scratch-128.png" srcSet="/stickers/sticker-scratch-128.png 1x, /stickers/sticker-scratch.png 2x" alt="" width={38} height={38} decoding="async" />
    </span>
  )
}

export default function ProgressStamps({ n, marks, gift = false }: Props) {
  const shown = Math.max(0, Math.min(n, marks))
  // Анимируем только марку, которая появилась при открытом экране.
  // При холодном старте prev === shown → всё статично, каскада нет.
  const prev = useRef(shown)
  const freshFrom = prev.current < shown ? prev.current : -1
  useEffect(() => { prev.current = shown }, [shown])

  return (
    <div
      className="stamps"
      role="img"
      aria-label={`Собрано ${shown} из ${n}${gift ? ', подарок доступен' : ''}`}
    >
      {Array.from({ length: n }, (_, i) =>
        i < shown
          ? <Stamp key={i} fresh={i >= freshFrom && freshFrom >= 0} />
          : <Slot key={i} />,
      )}
    </div>
  )
}
