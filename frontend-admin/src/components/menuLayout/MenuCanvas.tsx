import { memo } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { effectiveType, type MenuBlock, type MenuPage, type MenuTheme, type ResizeHandle } from '../../lib/menuLayout'
import { ptToWidthPct, safeAreaStyle } from '../../lib/sheetGeometry'

type Props = {
  page: MenuPage
  theme: MenuTheme
  title: string
  /** Живой холст в редакторе: выбор, перетаскивание, ручка размера. */
  selectedId?: string | null
  onSelect?: (id: string) => void
  onBlockPointerDown?: (e: ReactPointerEvent<HTMLDivElement>, id: string) => void
  onHandlePointerDown?: (e: ReactPointerEvent<HTMLDivElement>, id: string, handle: ResizeHandle) => void
  showGrid?: boolean
  showSafe?: boolean
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
  index = 1,
  total = 1,
}: Props) {
  const muted = theme.preset === 'dark' ? '#A5A39D' : theme.preset === 'season' ? '#76695B' : '#6E6A62'
  const line = theme.preset === 'dark' ? '#3B3F49' : theme.preset === 'season' ? '#D9C9B3' : '#D8D2C7'

  const style = {
    '--mc-bg': theme.bg,
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
        const selected = b.id === selectedId
        const warn = (b.warnings ?? []).length > 0
        return (
          <div
            key={b.id}
            className={`mc-block mc-${type}${selected ? ' is-selected' : ''}${warn ? ' has-warn' : ''}`}
            style={wrapStyle(b)}
            onPointerDown={(e) => {
              onSelect?.(b.id)
              onBlockPointerDown?.(e, b.id)
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
                  fontFamily: b.bold ? 'var(--font-display)' : undefined,
                }}
              >
                {b.text ?? b.titleOverride ?? ''}
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

            {type === 'product' && (
              <div className="mc-product">
                {b.showPhoto && b.displayImageUrl && <img className="mc-product-thumb" src={b.displayImageUrl} alt="" />}
                <div className="mc-product-body">
                  <div className="mc-product-row">
                    <span className="mc-product-name" style={{ fontSize: `${ptToCqw(b.fontSizePt)}cqw` }}>
                      {b.displayName ?? b.titleOverride ?? b.snapshotName ?? 'Позиция'}
                    </span>
                    <span className="mc-product-price" style={{ fontSize: `${ptToCqw(b.fontSizePt)}cqw` }}>
                      {b.displayPrice ?? '—'}
                    </span>
                  </div>
                  {b.product?.variantLabel && <span className="mc-product-sub">{b.product.variantLabel}</span>}
                  {b.badge && <span className="mc-badge">{b.badge}</span>}
                </div>
              </div>
            )}

            {selected && onHandlePointerDown && (
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
