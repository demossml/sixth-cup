import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { OperationRow } from '../api/types'
import { DOC_STATUS, DOC_TYPE } from '../lib/format'
import { Badge } from '../ui/kit'

export function DocStatusBadge({ status }: { status: string }) {
  const s = DOC_STATUS[status] ?? { label: status, tone: 'neutral' as const }
  return <Badge tone={s.tone}>{s.label}</Badge>
}

/** Card is the identity (guest model): code or id, never the phone. */
export function CardRef({ row }: { row: Pick<OperationRow, 'userId' | 'cardCode' | 'nickname'> }): ReactNode {
  if (!row.userId) return <span className="text-ink-tertiary">нет карты</span>
  return (
    <Link to={`/customers/${row.userId}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-brand hover:underline">
      {row.cardCode ? `№${row.cardCode}` : `#${row.userId}`}
      {row.nickname ? <span className="ml-1 font-normal text-ink-secondary">{row.nickname}</span> : null}
    </Link>
  )
}

export const typeLabel = (t: string) => DOC_TYPE[t] ?? t

/**
 * Часть закупок и склада живёт только в прежнем интерфейсе админки (`/`).
 * Пока фича не перенесена, показываем честную ссылку вместо пустого места.
 */
export function LegacyHint({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-ink-secondary">
      {children}{' '}
      <a href="/legacy-static.html" className="font-semibold text-brand hover:underline">
        Открыть прежний интерфейс
      </a>
    </div>
  )
}

/** What actually happened with the doc, in one phrase. */
export function opResult(o: OperationRow): string {
  if (o.status === 'FAILED') return o.lastError ? `Ошибка: ${o.lastError}` : 'Ошибка обработки'
  if (o.status === 'RECEIVED' || o.status === 'PROCESSING') return 'Ещё обрабатывается'
  if (o.status === 'IGNORED') return 'Пропущен'
  if (!o.opKind) return 'Чек получен, начисления нет'
  if (!o.cardId) return 'Чек без карты — чашки не начислены'
  const parts: string[] = []
  if (o.cups) parts.push(`${o.opKind === 'PAYBACK' ? '−' : '+'}${o.cups} чаш.`)
  else parts.push('чашек 0')
  if (o.free) parts.push(`бесплатных ${o.free}`)
  return parts.join(', ')
}
