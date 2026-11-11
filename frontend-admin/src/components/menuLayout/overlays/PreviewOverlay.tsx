import type { ReactNode } from "react"
import { Download, X } from "lucide-react"
import { Button } from "../../../ui/kit"
import { LAYOUT_FORMATS, type LayoutFormat } from "../../../lib/menuLayout"

type Props = {
  title: string
  pageIdx: number
  setPageIdx: (updater: (i: number) => number) => void
  pageCount: number
  format: LayoutFormat
  close: () => void
  onExport: () => void
  children: ReactNode
}

/** Полноэкранный предпросмотр листа без наведения мышью и подсказок. */
export default function PreviewOverlay({ title, pageIdx, setPageIdx, pageCount, format, close, onExport, children }: Props) {
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/70 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="mx-auto max-w-[720px]">
        <div className="mb-2 flex items-center justify-between text-white">
          <span className="text-[13px] font-semibold">
            {title} · {pageIdx + 1} / {pageCount}
          </span>
          <button type="button" onClick={() => close()} className="grid h-9 w-9 place-items-center rounded-full bg-white/15" aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>
        <div className="shadow-2xl" style={{ aspectRatio: String(LAYOUT_FORMATS.find((f) => f.id === format)?.ratio ?? 210 / 297) }}>
          {children}
        </div>
        <div className="mt-3 flex justify-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setPageIdx((i) => Math.max(0, i - 1))} disabled={pageIdx === 0}>
            ←
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setPageIdx((i) => Math.min(pageCount - 1, i + 1))} disabled={pageIdx >= pageCount - 1}>
            →
          </Button>
          <Button size="sm" icon={<Download size={14} />} onClick={() => { close(); onExport() }}>
            Экспорт PDF
          </Button>
        </div>
      </div>
    </div>
  )
}
