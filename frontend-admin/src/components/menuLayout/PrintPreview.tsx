import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Download, X } from 'lucide-react'
import { Button, ErrorBox, Spinner, cx } from '../../ui/kit'
import { tokenStore } from '../../api/client'
import { LAYOUT_FORMATS, type LayoutFormat } from '../../lib/menuLayout'
import { expectedMm, isMatch, pageMm, previewBadge } from '../../lib/printPreview'

const API = (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ?? ''

type Props = {
  layoutId: number
  pageIdx: number
  pageCount: number
  format: LayoutFormat
  /** Живой холст: он лежит под PDF, чтобы видеть расхождения. */
  children: ReactNode
  close: () => void
  setPageIdx: (updater: (i: number) => number) => void
}

/**
 * P3-6: «как в печати». Тянем настоящий PDF, рендерим страницу pdf.js'ом и кладём
 * поверх холста с регулируемой прозрачностью — расхождения видно глазом, а размер
 * страницы сверяем в миллиметрах (критерий — не больше 1 мм).
 */
export default function PrintPreview({ layoutId, pageIdx, pageCount, format, children, close, setPageIdx }: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [pdf, setPdf] = useState<{ data: ArrayBuffer } | null>(null)
  const [opacity, setOpacity] = useState(55)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  const pdfUrl = `${API}/api/admin/menu-layouts/${layoutId}/export.pdf?preset=screen&bleed=0&force=1`

  // PDF тянем один раз: страницы рендерим из того же буфера.
  useEffect(() => {
    let alive = true
    setBusy(true)
    setError('')
    fetch(pdfUrl, { headers: { 'X-Admin-Token': tokenStore.get() } })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `PDF не собрался (${res.status})`)
        }
        return res.arrayBuffer()
      })
      .then((buf) => {
        if (alive) setPdf({ data: buf })
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Не удалось получить PDF')
      })
      .finally(() => {
        if (alive) setBusy(false)
      })
    return () => {
      alive = false
    }
  }, [pdfUrl])

  // Рендер страницы в canvas того же размера, что холст под ним.
  const render = useCallback(async () => {
    if (!pdf || !boxRef.current || !canvasRef.current) return
    const box = boxRef.current.getBoundingClientRect()
    if (box.width === 0) return
    try {
      const mod = await import('pdfjs-dist')
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      mod.GlobalWorkerOptions.workerSrc = worker.default
      const doc = await mod.getDocument({ data: new Uint8Array(pdf.data) }).promise
      const page = await doc.getPage(Math.min(pageIdx + 1, doc.numPages))
      const base = page.getViewport({ scale: 1 })
      setSize(pageMm(base.width, base.height))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const viewport = page.getViewport({ scale: (box.width * dpr) / base.width })
      const canvas = canvasRef.current
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      await page.render({ canvasContext: ctx, viewport }).promise
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отрисовать PDF')
    }
  }, [pdf, pageIdx])

  useEffect(() => {
    void render()
  }, [render])

  const ratio = LAYOUT_FORMATS.find((f) => f.id === format)?.ratio ?? 210 / 297
  const expected = expectedMm(format)
  const badge = size ? previewBadge(size, expected) : null
  const ok = size ? isMatch(size, expected) : null

  return (
    <div className="fixed inset-0 z-[72] overflow-y-auto bg-black/70 p-4">
      <div className="mx-auto max-w-[760px]">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-white">
          <span className="text-[13px] font-semibold">Как в печати</span>
          {badge && (
            <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', ok ? 'bg-white/15' : 'bg-bad text-white')}>
              {badge}
            </span>
          )}
          <span className="text-[11.5px] text-white/70">
            стр. {pageIdx + 1} / {pageCount}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1 rounded-lg bg-white/15 px-2 text-[12px] font-semibold"
            >
              <Download size={14} /> PDF
            </a>
            <button type="button" onClick={close} className="grid h-9 w-9 place-items-center rounded-full bg-white/15" aria-label="Закрыть">
              <X size={18} />
            </button>
          </div>
        </div>

        <div ref={boxRef} className="relative overflow-hidden bg-white shadow-2xl" style={{ aspectRatio: String(ratio) }}>
          <div className="absolute inset-0">{children}</div>
          <canvas
            ref={canvasRef}
            aria-label="Рендер PDF"
            className="pointer-events-none absolute inset-0"
            style={{ opacity: opacity / 100 }}
          />
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-white/60">
              <Spinner label="Собираем PDF…" />
            </div>
          )}
        </div>

        <div className="mt-3 rounded-xl bg-white p-3">
          {error && <ErrorBox message={error} />}
          <label className="block text-[12px] text-ink-secondary">
            Прозрачность PDF: {opacity}%
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="mt-1 w-full"
              aria-label="Прозрачность PDF"
            />
          </label>
          <p className="mt-1 text-[11px] leading-4 text-ink-tertiary">
            Наведите порядок: 100 % — только PDF, 0 % — только холст. Если текст или блоки «двоятся», значит превью и
            печать считают геометрию по-разному; сейчас расхождение размеров листа{' '}
            {size ? `${(Math.abs(size.width - expected.width) + Math.abs(size.height - expected.height)).toFixed(1)} мм` : 'считается'}.
          </p>
          <div className="mt-2 flex items-center justify-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPageIdx((i) => Math.max(0, i - 1))} disabled={pageIdx === 0}>
              ←
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPageIdx((i) => Math.min(pageCount - 1, i + 1))}
              disabled={pageIdx >= pageCount - 1}
            >
              →
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
