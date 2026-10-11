import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/** Тёмный QR на светлом поле; size — пиксели канваса (читаемость у кассы). */
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
    QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: size,
      color: { dark: '#111111', light: '#FFFFFF' },
    }).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [value, size])
  if (!src) return <div className="mx-auto bg-line/40 rounded-lg animate-pulse" style={{ width: Math.min(size, 340), height: Math.min(size, 340) }} aria-hidden />
  return (
    <img
      src={src}
      alt={alt}
      className="mx-auto block bg-white"
      style={{ width: '100%', maxWidth: Math.min(size, 340), imageRendering: 'pixelated' }}
    />
  )
}
