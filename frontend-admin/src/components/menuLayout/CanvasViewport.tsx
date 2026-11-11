import type { MutableRefObject } from 'react'
import { cx } from '../../ui/kit'
import { LAYOUT_FORMATS, type LayoutFormat, type MenuBlock } from '../../lib/menuLayout'
import { clampZoom } from '../../lib/menuTools'
import { safeBoxOffset, safeBoxSize } from '../../lib/sheetGeometry'

type Rect = { xPct: number; yPct: number; wPct: number; hPct: number }

type Props = {
  canvasBox: MutableRefObject<HTMLDivElement | null>
  sheetRef: MutableRefObject<HTMLDivElement | null>
  spaceDown: boolean
  zoom: number
  setZoom: (updater: number | ((z: number) => number)) => void
  format: LayoutFormat
  blocks: MenuBlock[]
  setSelectedId: (id: string | null) => void
  setSelectedIds: (ids: string[]) => void
  setMarquee: (rect: Rect | null) => void
  children: React.ReactNode
}

/** Полотно листа: панорамирование (пробел/средняя кнопка), зум колесом и рамка выделения. */
export default function CanvasViewport({
  canvasBox,
  sheetRef,
  spaceDown,
  zoom,
  setZoom,
  format,
  blocks,
  setSelectedId,
  setSelectedIds,
  setMarquee,
  children,
}: Props) {
  const intersects = (rect: Rect, b: MenuBlock) =>
    rect.xPct < b.xPct + b.wPct && rect.xPct + rect.wPct > b.xPct && rect.yPct < b.yPct + b.hPct && rect.yPct + rect.hPct > b.yPct

  return (
    <div
      ref={canvasBox}
      className={cx('flex-1 overflow-auto rounded-xl border border-line bg-[#e9ebef] p-4', spaceDown && 'cursor-grab')}
      onPointerDown={(e) => {
        // Пан: пробел + левая кнопка или средняя кнопка мыши.
        if (!(spaceDown || e.button === 1)) return
        const box = canvasBox.current
        if (!box) return
        e.preventDefault()
        const start = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop }
        const move = (ev: PointerEvent) => {
          box.scrollLeft = start.left - (ev.clientX - start.x)
          box.scrollTop = start.top - (ev.clientY - start.y)
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
      onWheel={(e) => {
        // Ctrl/⌘ + колесо — зум как в редакторах; обычное колесо листает.
        if (!e.ctrlKey && !e.metaKey) return
        e.preventDefault()
        setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 0.9)))
      }}
    >
      <div
        ref={sheetRef}
        className="mx-auto rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        tabIndex={-1}
        aria-label="Лист макета"
        style={{
          width: `${Math.round(560 * zoom)}px`,
          // На планшете колонка уже 560 px: лист ужимается по ней, а не уезжает под панель.
          maxWidth: '100%',
          aspectRatio: String(LAYOUT_FORMATS.find((f) => f.id === format)?.ratio ?? 210 / 297),
        }}
        onPointerDown={(e) => {
          const target = e.target as HTMLElement
          const empty = target === e.currentTarget || !!target.closest('.mc-safe')
          if (target === e.currentTarget) {
            setSelectedId(null)
            setSelectedIds([])
          }
          // Рамка выделения: тянем по пустому месту безопасной области.
          if (!empty || (target !== e.currentTarget && target.closest('.mc-block'))) return
          const sheet = sheetRef.current
          if (!sheet) return
          const box = sheet.getBoundingClientRect()
          const off = safeBoxOffset(box)
          const size = safeBoxSize(box)
          const toPct = (clientX: number, clientY: number) => ({
            x: ((clientX - box.left - off.left) / size.w) * 100,
            y: ((clientY - box.top - off.top) / size.h) * 100,
          })
          const start = toPct(e.clientX, e.clientY)
          setMarquee(null)
          const move = (ev: PointerEvent) => {
            const cur = toPct(ev.clientX, ev.clientY)
            const rect = {
              xPct: Math.max(0, Math.min(start.x, cur.x)),
              yPct: Math.max(0, Math.min(start.y, cur.y)),
              wPct: Math.abs(cur.x - start.x),
              hPct: Math.abs(cur.y - start.y),
            }
            setMarquee(rect)
            const hit = blocks.filter((b) => !b.hidden && intersects(rect, b)).map((b) => b.id)
            setSelectedIds(hit)
            setSelectedId(hit[0] ?? null)
          }
          const up = () => {
            setMarquee(null)
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }}
      >
        <div className="h-full w-full shadow-[0_10px_30px_rgba(16,24,40,.15)]">{children}</div>
      </div>
    </div>
  )
}
