import { useEffect, useRef } from 'react'
import Qr from './Qr'
import { formatCardCode } from '../lib/card'

/**
 * Развёрнутый QR внутри текущего экрана (без отдельного роута и без крестика).
 * Закрывается тапом в любом месте, Escape и системным «назад».
 * Первый тап (тот, что открыл слой) не должен его сразу закрыть — поэтому
 * клики игнорируются первые 250 мс.
 */
type Props = {
  proof: string
  cardCode: string
  onClose: () => void
}

const GUARD_MS = 250

export default function QrLayer({ proof, cardCode, onClose }: Props) {
  const openedAt = useRef(Date.now())
  const layerRef = useRef<HTMLDivElement | null>(null)
  const restoreFocus = useRef<Element | null>(null)
  const done = useRef(false)

  useEffect(() => {
    restoreFocus.current = document.activeElement
    layerRef.current?.focus({ preventScroll: true })

    // Своя запись в истории: системный «назад» закрывает слой, а не уводит со страницы.
    window.history.pushState({ qrLayer: true }, '')
    const onPop = () => {
      if (done.current) return
      done.current = true
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose() }
    document.addEventListener('keydown', onKey)
    window.addEventListener('popstate', onPop)

    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
      const el = restoreFocus.current
      if (el instanceof HTMLElement) el.focus({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  // Закрытие инициировано из UI: снимаем свою запись истории, чтобы «назад» не залипал.
  function requestClose() {
    if (done.current) return
    done.current = true
    onClose()
    if (window.history.state?.qrLayer) window.history.back()
  }

  const onClick = () => {
    if (Date.now() - openedAt.current < GUARD_MS) return
    requestClose()
  }

  return (
    <div
      ref={layerRef}
      className="qr-layer"
      role="dialog"
      aria-modal="true"
      aria-label="QR карты"
      tabIndex={-1}
      onClick={onClick}
    >
      <div className="qr-layer-card">
        <Qr value={proof} size={440} alt="QR карты для кассы" />
      </div>
      <p className="qr-layer-number">{formatCardCode(cardCode)}</p>
      <p className="qr-layer-caption">Покажите QR бариста. Не читается — назовите номер</p>
      <p className="qr-layer-hint">Тап в любом месте — свернуть</p>
    </div>
  )
}
