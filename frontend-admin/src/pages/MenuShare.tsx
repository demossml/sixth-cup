import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { Button, ErrorBox, Spinner, cx } from '../ui/kit'
import MenuCanvas from '../components/menuLayout/MenuCanvas'
import { DEFAULT_THEME, LAYOUT_FORMATS, type LayoutFormat, type MenuDoc, type MenuTheme } from '../lib/menuLayout'

const API = (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ?? ''

type SharedLayout = {
  title: string
  format: LayoutFormat
  formatHint: { label: string; mm: string }
  theme: MenuTheme
  status: 'draft' | 'ready'
  updatedAt: number
  pages: number
  doc: { pages: MenuDoc['pages'] }
  warnings: { blockId: string; text: string; code: string }[]
}

/**
 * P2-5: макет по ссылке — только чтение, без токена админки.
 * Отдельная страница, а не редактор: чужие правки и служебные панели не нужны.
 */
export default function MenuShare() {
  const { token = '' } = useParams()
  const [layout, setLayout] = useState<SharedLayout | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [pageIdx, setPageIdx] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/public/menu-share/${encodeURIComponent(token)}`)
      const body = (await res.json().catch(() => ({}))) as { layout?: SharedLayout; error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Ссылка недействительна или отозвана')
      setLayout(body.layout ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось открыть макет')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const page = layout?.doc.pages[Math.min(pageIdx, (layout.doc.pages.length || 1) - 1)] ?? null
  const ratio = LAYOUT_FORMATS.find((f) => f.id === layout?.format)?.ratio ?? 210 / 297
  const pdfHref = `${API}/api/public/menu-share/${encodeURIComponent(token)}/export.pdf?preset=print&bleed=3`

  return (
    <div className="min-h-screen bg-[#eef1f6] px-3 py-4">
      <div className="mx-auto max-w-[760px]">
        <header className="mb-3 flex flex-wrap items-center gap-2">
          <img src="/67coffee-mark.png" alt="" className="h-9 w-9 rounded-[9px]" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-bold text-ink">{layout?.title ?? 'Макет меню'}</h1>
            <p className="text-[11.5px] text-ink-secondary">
              {layout
                ? `${layout.formatHint.label} · ${layout.formatHint.mm} · обновлён ${new Date(layout.updatedAt).toLocaleString('ru-RU')}`
                : 'Просмотр по ссылке'}
            </p>
          </div>
          {layout && (
            <a
              href={pdfHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line bg-white px-2.5 text-[12.5px] font-semibold text-brand hover:border-brand"
            >
              <Download size={14} /> PDF
            </a>
          )}
        </header>

        {loading && <Spinner />}
        {error && <ErrorBox message={error} onRetry={() => void load()} />}

        {layout && page && (
          <>
            <div
              className="mx-auto rounded-sm bg-white shadow-[0_10px_30px_rgba(16,24,40,.15)]"
              style={{ width: '100%', maxWidth: `${Math.round(560 * (ratio > 1 ? 1 : 1))}px`, aspectRatio: String(ratio) }}
            >
              <MenuCanvas page={page} theme={{ ...DEFAULT_THEME, ...layout.theme }} title={layout.title} index={pageIdx + 1} total={layout.doc.pages.length} />
            </div>

            {layout.doc.pages.length > 1 && (
              <div className="mt-3 flex items-center justify-center gap-2 text-[12.5px] text-ink-secondary">
                <button
                  type="button"
                  onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
                  disabled={pageIdx === 0}
                  className="rounded-md border border-line bg-white px-2 py-1 disabled:opacity-40"
                >
                  ← стр.
                </button>
                <span className="tabular-nums">
                  {pageIdx + 1} / {layout.doc.pages.length}
                </span>
                <button
                  type="button"
                  onClick={() => setPageIdx((i) => Math.min(layout.doc.pages.length - 1, i + 1))}
                  disabled={pageIdx >= layout.doc.pages.length - 1}
                  className="rounded-md border border-line bg-white px-2 py-1 disabled:opacity-40"
                >
                  стр. →
                </button>
              </div>
            )}

            {layout.warnings.length > 0 && (
              <div className={cx('mt-3 rounded-xl border px-3 py-2 text-[12px]', 'border-warn/40 bg-warn-soft text-warn')}>
                <p className="font-semibold">Перед печатью: {layout.warnings.length}</p>
                <ul className="mt-1 space-y-0.5">
                  {layout.warnings.slice(0, 6).map((w) => (
                    <li key={`${w.blockId}-${w.text}`}>{w.text}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-3 text-center text-[11px] text-ink-tertiary">
              Ссылка только для просмотра: правки вносятся в админке. 6.7 Coffee
            </p>
            <div className="mt-2 text-center">
              <Button size="sm" variant="secondary" onClick={() => window.print()}>
                Печать листа
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
