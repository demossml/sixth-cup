import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export default function Qr({ value, alt = 'QR-код' }: { value: string; alt?: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    QRCode.toDataURL(value, { errorCorrectionLevel: 'L', margin: 2, width: 360 }).then(setSrc)
  }, [value])
  return src ? <img src={src} alt={alt} className="w-full max-w-[340px] mx-auto my-2 block" style={{ imageRendering: 'pixelated' }} /> : null
}
