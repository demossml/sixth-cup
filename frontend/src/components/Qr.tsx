import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/**
 * Тёмный QR (#1B1A17) на чистом белом поле, quiet zone ≥ 2 модуля + белая рамка вокруг.
 * `size` — максимальный CSS-размер; картинка рендерится в физических пикселях экрана (devicePixelRatio),
 * поэтому модули чёткие и без размытия на ретина-экранах.
 */
export default function Qr({
  value,
  alt = 'QR-код',
  size = 360,
}: {
  value: string
  alt?: string
  size?: number
}) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let cancelled = false
    const dpr = typeof window === 'undefined' ? 1 : Math.min(3, Math.max(1, window.devicePixelRatio || 1))
    QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: Math.round(size * dpr),
      color: { dark: '#1B1A17', light: '#FFFFFF' },
    }).then((url) => {
      if (!cancelled) setSrc(url)
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [value, size])
  if (!src) {
    return <div className="mx-auto bg-line/40 rounded-lg" style={{ width: '100%', maxWidth: size, aspectRatio: '1 / 1' }} aria-hidden />
  }
  return (
    <img
      src={src}
      alt={alt}
      className="mx-auto block bg-white"
      style={{ width: '100%', maxWidth: size, aspectRatio: '1 / 1' }}
    />
  )
}
