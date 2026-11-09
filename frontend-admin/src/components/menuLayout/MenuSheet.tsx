import { memo } from 'react'
import type { CSSProperties } from 'react'
import { flowPage, type MenuBlock, type MenuPage, type MenuTheme } from '../../lib/menuLayout'

type Props = {
  page: MenuPage
  theme: MenuTheme
  title: string
  /** Живой лист в редакторе: подсветка выбранного блока и клики по позициям. */
  selectedId?: string | null
  onSelect?: (id: string) => void
  showGrid?: boolean
  showSafe?: boolean
  /** Печатный номер страницы и общее число — как в PDF. */
  index?: number
  total?: number
}

const densityGap: Record<MenuTheme['density'], string> = {
  air: '1.5cqw',
  normal: '1cqw',
  dense: '0.5cqw',
}

/**
 * Лист макета: то же, что уйдёт в PDF (раскладка считается общим flowPage).
 * Ничего не сохраняет — правки идут через редактор.
 */
function MenuSheet({ page, theme, title, selectedId, onSelect, showGrid, showSafe, index = 1, total = 1 }: Props) {
  const flow = flowPage(page.blocks, theme.columns)
  const header = flow.lead.find((b) => b.type === 'header')
  const hero = flow.lead.find((b) => b.type === 'hero')
  const muted = theme.preset === 'dark' ? '#A5A39D' : theme.preset === 'season' ? '#76695B' : '#6E6A62'
  const line = theme.preset === 'dark' ? '#3B3F49' : theme.preset === 'season' ? '#D9C9B3' : '#D8D2C7'

  const style = {
    '--ml-bg': theme.bg,
    '--ml-text': theme.text,
    '--ml-accent': theme.accent,
    '--ml-muted': muted,
    '--ml-line': line,
    '--ml-gap': densityGap[theme.density],
    '--ml-heading-size': theme.headingSize,
    '--ml-item-size': theme.itemSize,
    fontFamily: theme.fontBody === 'Unbounded' ? 'var(--font-display)' : 'var(--font)',
  } as CSSProperties

  const product = (b: MenuBlock, catId: string) => {
    const warn = (b.warnings ?? []).length > 0
    return (
      <button
        key={`${catId}-${b.id}`}
        type="button"
        className={`ml-product${selectedId === b.id ? ' is-selected' : ''}`}
        onClick={() => onSelect?.(b.id)}
        aria-label={`${b.displayName ?? b.titleOverride ?? 'Позиция'}: ${b.displayPrice ?? 'без цены'}`}
      >
        <span className="ml-product-info">
          <strong>{b.displayName ?? b.titleOverride ?? 'Позиция'}</strong>
          {b.product?.variantLabel && <span>{b.product.variantLabel}</span>}
          {b.badge && <span className="ml-badge">{b.badge}</span>}
        </span>
        <span className="ml-price">
          {b.displayPrice ?? '—'}
          {warn && <span className="ml-warn-dot" style={{ display: 'inline-block', marginLeft: 6 }} />}
        </span>
      </button>
    )
  }

  let categoryOrdinal = 0

  return (
    <div className={`ml-sheet${showGrid ? ' is-grid' : ''}${showSafe ? ' is-safe' : ''}`} style={style}>
      {theme.ornament !== 'none' && (
        <div className="ml-ornament" aria-hidden="true">
          <i style={{ width: theme.ornament === 'leaf' ? '4.7cqw' : '3.9cqw' }} />
          <b
            style={
              theme.ornament === 'beans'
                ? { width: '1cqw', height: '1.8cqw', borderRadius: '50%', transform: 'rotate(34deg)' }
                : theme.ornament === 'leaf'
                  ? {
                      width: '2.9cqw',
                      height: '1.5cqw',
                      borderRadius: '100% 0 100% 0',
                      background: 'transparent',
                      border: `1px solid ${theme.accent}`,
                    }
                  : { width: '0.7cqw', height: '0.7cqw', borderRadius: '1px' }
            }
          />
        </div>
      )}

      {theme.logoPosition !== 'footer' && (
        <header className={`ml-head${theme.logoPosition === 'top-right' ? ' is-right' : ''}`}>
          <div className="ml-brand">
            6<span className="ml-brand-dot" />7<small>coffee</small>
          </div>
          {header?.text && <div className="ml-edition">{header.text}</div>}
        </header>
      )}

      {hero && (
        <div className="ml-hero" style={{ marginTop: theme.logoPosition === 'footer' ? '2cqw' : undefined }}>
          <div>
            {hero.text && <span className="ml-kicker">{hero.text}</span>}
            <h1>{hero.titleOverride ?? 'Меню'}</h1>
          </div>
        </div>
      )}

      <div className="ml-rule" aria-hidden="true">
        <span />
        <i />
      </div>

      <div
        className="ml-columns"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, flow.columns.length)}, minmax(0, 1fr))` }}
      >
        {flow.columns.map((groups, ci) => (
          <div key={ci}>
            {groups.map((group, gi) => {
              const cat = group.category
              if (cat) categoryOrdinal += 1
              const name = cat ? cat.titleOverride ?? cat.displayCategory ?? 'Категория' : null
              return (
                <section key={`${ci}-${gi}-${cat?.id ?? 'x'}`} style={{ marginBottom: '2.4cqw' }}>
                  {cat && name && (
                    <div
                      className="ml-cat-head"
                      onClick={() => onSelect?.(cat.id)}
                      role={onSelect ? 'button' : undefined}
                      tabIndex={onSelect ? 0 : undefined}
                    >
                      <h2>{name}</h2>
                      <span>{String(categoryOrdinal).padStart(2, '0')}</span>
                    </div>
                  )}
                  <div className="ml-list">{group.products.map((b) => product(b, cat?.id ?? 'none'))}</div>
                </section>
              )
            })}
          </div>
        ))}
      </div>

      {flow.tail.length > 0 && (
        <div className="ml-tail">
          {flow.tail.map((b) => {
            if (b.type === 'divider') return <div key={b.id} className="ml-divider" />
            if (b.type === 'photo' || b.type === 'qr') {
              return (
                <div key={b.id} className="ml-photo-strip">
                  {b.snapshotImageUrl ? (
                    <img src={b.snapshotImageUrl} alt="" />
                  ) : (
                    <span className="ml-photo-empty">{b.type === 'qr' ? 'QR · 67coffee.ru' : 'фото'}</span>
                  )}
                  <div>
                    <span>{b.type === 'qr' ? 'Меню по QR' : '6.7 Coffee'}</span>
                    <strong>{b.titleOverride ?? (b.type === 'qr' ? 'Открыть меню' : 'Кофе с собой')}</strong>
                    {b.text && <p>{b.text}</p>}
                  </div>
                  <span className="ml-stamp">6▪7</span>
                </div>
              )
            }
            return (
              <div key={b.id} className="ml-note">
                <span>6.7 · заметка</span>
                <strong>{b.titleOverride ?? b.text ?? 'Заметка'}</strong>
              </div>
            )
          })}
        </div>
      )}

      <footer className="ml-foot">
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

export default memo(MenuSheet)
