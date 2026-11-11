import { useEffect, useState } from 'react'
import { effectiveDpi, sheetWidthMm } from '../../lib/menuTools'

/**
 * Подсказка о разрешении фото: 300×300 px в рамке 12 см дадут ~64 dpi и «мыло» на печати.
 * Ничего не блокирует — просто честно предупреждает до отправки в типографию.
 */
export default function PhotoDpiHint({ url, widthPct, ratio }: { url: string | null; widthPct: number; ratio: number }) {
  const [dpi, setDpi] = useState<number | null>(null)
  useEffect(() => {
    if (!url) {
      setDpi(null)
      return
    }
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (alive) setDpi(effectiveDpi(img.naturalWidth, widthPct, sheetWidthMm(ratio)))
    }
    img.onerror = () => {
      if (alive) setDpi(null)
    }
    img.src = url
    return () => {
      alive = false
    }
  }, [url, widthPct, ratio])

  if (dpi == null || dpi >= 200) return null
  return (
    <p className="mt-1 text-[11px] text-warn">
      фото ≈ {dpi} dpi при этой ширине — на печати будет мыло (нужно ≥ 200)
    </p>
  )
}
