import { memo } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { effectiveType, type MenuBlock, type MenuPage, type MenuTheme, type Rect, type ResizeHandle } from '../../lib/menuLayout'
import { ptToWidthPct, safeAreaStyle } from '../../lib/sheetGeometry'
import { typograph } from '../../lib/typography'

type Props = {
  page: MenuPage
  theme: MenuTheme
  title: string
  /** Живой холст в редакторе: выбор, перетаскивание, ручка размера. */
  selectedId?: string | null
  onSelect?: (id: string, e?: ReactPointerEvent<HTMLDivElement>) => void
  onBlockPointerDown?: (e: ReactPointerEvent<HTMLDivElement>, id: string) => void
  onHandlePointerDown?: (e: ReactPointerEvent<HTMLDivElement>, id: string, handle: ResizeHandle) => void
  showGrid?: boolean
  showSafe?: boolean
  /** Все выделенные блоки (мультивыбор Shift+клик и рамкой). */
  selectedIds?: string[]
  /** Линии прилипания: X и Y в процентах листа. */
  guides?: { x: number[]; y: number[] }
  /** Рамка выделения, которую сейчас тянут мышью. */
  marquee?: Rect | null
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>, id: string) => void
  index?: number
  total?: number
}

/** 1 pt на листе A4 (595 pt) = 0.168 % ширины — так кегль из данных совпадает с PDF. */
const ptToCqw = (pt: number): number => ptToWidthPct(pt)

const wrapStyle = (b: MenuBlock): CSSProperties => ({
  position: 'absolute',
  left: `${b.xPct}%`,
  top: `${b.yPct}%`,
  width: `${b.wPct}%`,
  height: `${b.hPct}%`,
  zIndex: b.zIndex,
  transform: b.rotationDeg ? `rotate(${b.rotationDeg}deg)` : undefined,
})

/**
 * Холст листа: каждый блок в своей рамке (x/y/w/h в процентах).
 * Компонент ничего не сохраняет и не двигает сам — только рисует и сообщает о pointer-down.
 */
function MenuCanvas({
  page,
  theme,
  title,
  selectedId,
  onSelect,
  onBlockPointerDown,
  onHandlePointerDown,
  showGrid,
  showSafe,
  selectedIds,
  guides,
  marquee,
  onContextMenu,
  index = 1,
  total = 1,
}: Props) {
  const multi = selectedIds && selectedIds.length > 1 ? new Set(selectedIds) : null
  const muted = theme.preset === 'dark' ? '#A5A39D' : theme.preset === 'season' ? '#76695B' : '#6E6A62'
  const line = theme.preset === 'dark' ? '#3B3F49' : theme.preset === 'season' ? '#D9C9B3' : '#D8D2C7'

  const gradient = theme.gradient
  const style = {
    '--mc-bg': gradient ? `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})` : theme.bg,
    '--mc-text': theme.text,
    '--mc-accent': theme.accent,
    '--mc-muted': muted,
    '--mc-line': line,
    fontFamily: theme.fontBody === 'Unbounded' ? 'var(--font-display)' : 'var(--font)',
  } as CSSProperties

  const blocks = [...page.blocks].sort((a, b) => a.zIndex - b.zIndex || a.sortOrder - b.sortOrder)

  return (
    <div className={`mc-sheet${showGrid ? ' is-grid' : ''}${showSafe ? ' is-safe' : ''}`} style={style}>
      {theme.backgroundImageUrl && (
        <div className="mc-bg-image" aria-hidden="true">
          <img src={theme.backgroundImageUrl} alt="" />
          {theme.backgroundDim > 0 && <span style={{ opacity: theme.backgroundDim / 100 }} />}
        </div>
      )}

      <div className="mc-safe" style={safeAreaStyle}>
      {blocks.map((b) => {
        const type = effectiveType(b)
        const selected = b.id === selectedId || !!multi?.has(b.id)
        const warn = (b.warnings ?? []).length > 0
        return (
          <div
            key={b.id}
            className={`mc-block mc-${type}${selected ? ' is-selected' : ''}${warn ? ' has-warn' : ''}${b.locked ? ' is-locked' : ''}`}
            style={wrapStyle(b)}
            onPointerDown={(e) => {
              onSelect?.(b.id, e)
              onBlockPointerDown?.(e, b.id)
            }}
            onContextMenu={(e) => {
              if (!onContextMenu) return
              e.preventDefault()
              onSelect?.(b.id)
              onContextMenu(e, b.id)
            }}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={`${type}: ${b.displayName ?? b.titleOverride ?? b.text ?? ''}`}
            data-block-id={b.id}
          >
            {type === 'logo' && (
              <div className="mc-logo">
                <span className="mc-logo-mark">
                  6<span className="mc-logo-dot" />7
                </span>
                <small>coffee</small>
                {b.text && <span className="mc-logo-note">{b.text}</span>}
              </div>
            )}

            {type === 'text' && (
              <div
                className="mc-text-body"
                style={{
                  fontSize: `${ptToCqw(b.fontSizePt)}cqw`,
                  fontWeight: b.bold ? 650 : 400,
                  textAlign: b.align,
                  textTransform: b.uppercase ? 'uppercase' : undefined,
                  lineHeight: b.lineHeight ?? 1.15,
                  letterSpacing: `${(b.tracking ?? 0) / 1000}em`,
                  fontFamily: b.bold ? 'var(--font-display)' : undefined,
                }}
              >
                {typograph(b.text ?? b.titleOverride ?? '')}
              </div>
            )}

            {type === 'category' && (
              <div className="mc-category">
                <span className="mc-category-name">{b.titleOverride ?? b.displayCategory ?? 'Категория'}</span>
                <i />
              </div>
            )}

            {type === 'divider' && <div className="mc-divider" />}

            {type === 'image' && (
              <div className="mc-image">
                {(b.displayImageUrl ?? b.url) ? (
                  <img src={(b.displayImageUrl ?? b.url)!} alt={b.titleOverride ?? ''} style={{ objectFit: b.fit }} />
                ) : (
                  <span className="mc-image-empty">фото</span>
                )}
              </div>
            )}

            {type === 'product' && (() => {
              const sizes = b.displaySizes ?? []
              // Объёмы печатаем всегда, когда их больше одного: иначе гость видит одну цену.
              // Порог по высоте касается только второй строки, а не самого факта объёмов.
              const twoLines = sizes.length > 1
              return (
                <div className="mc-product">
                  {b.showPhoto && b.displayImageUrl && <img className="mc-product-thumb" src={b.displayImageUrl} alt="" />}
                  <div className="mc-product-body">
                    <div className="mc-product-row">
                      <span
                        className="mc-product-name"
                        style={{
                          fontSize: `${ptToCqw(b.fontSizePt)}cqw`,
                          textTransform: b.uppercase ? 'uppercase' : undefined,
                          letterSpacing: `${(b.tracking ?? 0) / 1000}em`,
                        }}
                      >
                        {typograph(b.displayName ?? b.titleOverride ?? b.snapshotName ?? 'Позиция')}
                      </span>
                      {!twoLines && (
                        <span className="mc-product-price" style={{ fontSize: `${ptToCqw(b.fontSizePt)}cqw` }}>
                          {b.displayPrice ?? '—'}
                        </span>
                      )}
                    </div>
                    {twoLines ? (
                      <div className="mc-product-sizes" style={{ fontSize: `${ptToCqw(b.fontSizePt * 0.78)}cqw` }}>
                        <span>{typograph(sizes.map((sz) => sz.label).join(' · '))}</span>
                        <span>{typograph(sizes.map((sz) => sz.price).join(' · '))}</span>
                      </div>
                    ) : (
                      b.product?.variantLabel && <span className="mc-product-sub">{b.product.variantLabel}</span>
                    )}
                    {b.badge && <span className="mc-badge">{b.badge}</span>}
                  </div>
                </div>
              )
            })()}

            {selected && onHandlePointerDown && !b.locked && (
              <div
                className="mc-handle"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onHandlePointerDown(e, b.id, 'se')
                }}
                aria-label="Изменить размер"
                role="presentation"
              />
            )}
          </div>
        )
      })}
        {guides && (guides.x.length > 0 || guides.y.length > 0) && (
          <div className="mc-guides" aria-hidden="true">
            {guides.x.map((x, i) => (
              <span key={`x${i}`} className="mc-guide is-v" style={{ left: `${x}%` }} />
            ))}
            {guides.y.map((y, i) => (
              <span key={`y${i}`} className="mc-guide is-h" style={{ top: `${y}%` }} />
            ))}
          </div>
        )}

        {marquee && (
          <span
            className="mc-marquee"
            aria-hidden="true"
            style={{ left: `${marquee.xPct}%`, top: `${marquee.yPct}%`, width: `${marquee.wPct}%`, height: `${marquee.hPct}%` }}
          />
        )}
      </div>

      <footer className="mc-foot">
        <span>
          {theme.logoPosition === 'footer' ? <b>6▪7 coffee · </b> : null}
          {title}
        </span>
        <span>
          {index}/{total}
          {theme.logoPosition === 'footer' ? '' : ' · 6.7 coffee'}
        </span>
      </footer>
    </div>
  )
}

export default memo(MenuCanvas)
