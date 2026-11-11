/**
 * P2-5: просмотр макета по ссылке — без токена админки.
 *
 * Доступ даёт только активный (не отозванный) токен. Отдаём минимум: лист, тему,
 * формат и предупреждения. Ревизия, служебные списки и правки каталога наружу не уходят.
 */
import { Hono } from 'hono'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { layoutView, rowById } from '../admin/menuLayouts'
import { renderLayoutPdf } from '../admin/menuLayoutPdf'
import { formatMetrics } from '../admin/menuLayoutDoc'
import { imposePlan as imposePlanFor, parseImpose } from '../admin/imposition'

const shareByToken = (token: string) =>
  db
    .prepare('SELECT layout_id FROM menu_layout_shares WHERE token=? AND revoked_at IS NULL')
    .get(token) as { layout_id: number } | undefined

/** Макет по токену или 404: ссылка могла быть отозвана. */
function sharedView(token: string) {
  const share = shareByToken(token)
  if (!share) throw bad('Ссылка недействительна или отозвана', 404)
  const row = rowById(share.layout_id)
  if (!row) throw bad('Макет не найден', 404)
  return layoutView(row)
}

export const publicMenuShare = new Hono()
  .get('/:token', (c) => {
    const token = c.req.param('token')
    const view = sharedView(token)
    return c.json({
      ok: true,
      layout: {
        title: view.title,
        format: view.format,
        formatHint: view.formatHint,
        theme: view.theme,
        status: view.status,
        updatedAt: view.updatedAt,
        pages: view.doc.pages.length,
        doc: { pages: view.doc.pages },
        warnings: view.blockers.map((b) => ({ blockId: b.blockId, text: b.text, code: b.code })),
      },
    })
  })
  /** PDF из ссылки: то же, что кнопка экспорта в админке, но без токена. */
  .get('/:token/export.pdf', async (c) => {
    const token = c.req.param('token')
    const view = sharedView(token)
    const preset = c.req.query('preset') === 'screen' ? 'screen' : 'print'
    const bleedRaw = Number(c.req.query('bleed') ?? (preset === 'print' ? 3 : 0))
    const bleed = Number.isFinite(bleedRaw) ? Math.max(0, Math.min(10, bleedRaw)) : 0
    const cmyk = c.req.query('cmyk') === '1'
    const withNotes = c.req.query('notes') === '1'
    const impose = parseImpose(c.req.query('impose'))
    const metricsForImpose = formatMetrics(view.format)
    const imposePlan = impose ? imposePlanFor(metricsForImpose.width, metricsForImpose.height, impose) : null
    const pdf = await renderLayoutPdf(view, { preset, bleedMm: bleed, cmyk, withNotes: withNotes && !impose, impose })
    const name = `menu-${view.id}-${new Date().toISOString().slice(0, 10)}.pdf`
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${name}"`,
        'Content-Length': String(pdf.length),
        'Cache-Control': 'no-store',
        ...(imposePlan
          ? {
              'X-Impose-Sheet': imposePlan.sheet,
              'X-Impose-Grid': `${imposePlan.rows}x${imposePlan.cols}`,
              'X-Impose-Scale': imposePlan.scale.toFixed(3),
            }
          : {}),
      },
    })
  })
