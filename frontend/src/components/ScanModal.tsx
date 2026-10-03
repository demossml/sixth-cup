import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Camera, X } from '../lib/icons'

export default function ScanModal({ title, onResult, onClose }: {
  title: string; onResult: (text: string) => void; onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | undefined
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s
        const v = video.current!
        v.srcObject = s
        v.setAttribute('playsinline', 'true')
        void v.play()
        const tick = () => {
          if (stopped) return
          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            canvas.width = v.videoWidth
            canvas.height = v.videoHeight
            ctx.drawImage(v, 0, 0)
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
            if (code?.data) { onResult(code.data); return }
          }
          requestAnimationFrame(tick)
        }
        tick()
      })
      .catch(() => setError('Нет доступа к камере. Разрешите камеру или вставьте код вручную.'))

    return () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()) }
  }, [])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-30" onClick={onClose}>
      <div className="bg-white w-full max-w-[480px] rounded-t-3xl p-4 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold text-ink flex items-center gap-2">
            <Camera size={20} className="text-brand" /> {title}
          </h1>
          <button type="button" onClick={onClose} className="p-1 text-ink-tertiary" aria-label="Закрыть">
            <X size={22} />
          </button>
        </div>
        <video ref={video} className="w-full rounded-2xl bg-black aspect-square object-cover" muted />
        {error && <p className="text-bad text-sm mt-2">{error}</p>}
        <p className="text-ink-secondary text-xs mt-2 leading-relaxed">
          Наведите камеру на QR лояльности с чека. Стаканы и кэшбэк начисляет только сервер.
        </p>
        <details className="mt-3">
          <summary className="text-ink-tertiary text-sm cursor-pointer">Ввести код вручную</summary>
          <textarea className="input mt-2" value={manual} onChange={(e) => setManual(e.target.value)} rows={3} />
          <button type="button" className="btn btn-sm mt-2" onClick={() => manual.trim() && onResult(manual.trim())}>Отправить на сервер</button>
        </details>
        <button className="btn-ghost mt-3" onClick={onClose}>Закрыть</button>
      </div>
    </div>
  )
}
