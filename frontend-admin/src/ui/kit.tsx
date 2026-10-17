import { Children, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle, CircleDashed } from 'lucide-react'

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')

/* ───────── Button ───────── */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  loading?: boolean
  icon?: ReactNode
}
export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }: BtnProps) {
  const v = {
    primary: 'bg-brand text-white hover:bg-brand-dark',
    secondary: 'bg-white text-brand border border-line hover:bg-brand-light',
    ghost: 'bg-transparent text-brand hover:bg-brand-soft',
    danger: 'bg-bad text-white hover:opacity-90',
  }[variant]
  const s = size === 'sm' ? 'min-h-[36px] px-3 text-sm' : 'min-h-[44px] px-4 text-[15px]'
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-mid', v, s, className)}
    >
      {loading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}

/* ───────── Badge / status (color + icon + word, never color alone) ───────── */
export type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'brand'
const TONE: Record<Tone, string> = {
  ok: 'bg-green-50 text-ok',
  warn: 'bg-amber-50 text-warn',
  bad: 'bg-red-50 text-bad',
  neutral: 'bg-gray-100 text-ink-secondary',
  brand: 'bg-brand-soft text-brand',
}
const TONE_ICON: Record<Tone, ReactNode> = {
  ok: <CheckCircle2 size={13} aria-hidden />,
  warn: <AlertTriangle size={13} aria-hidden />,
  bad: <XCircle size={13} aria-hidden />,
  neutral: <CircleDashed size={13} aria-hidden />,
  brand: <Info size={13} aria-hidden />,
}
export function Badge({ tone = 'neutral', children, icon = true }: { tone?: Tone; children: ReactNode; icon?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', TONE[tone])}>
      {icon && TONE_ICON[tone]}
      {children}
    </span>
  )
}

const DOT: Record<string, string> = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', off: 'bg-ink-tertiary' }
export function StatusDot({ level, label }: { level: 'ok' | 'warn' | 'bad' | 'off'; label?: string }) {
  return <span className={cx('inline-block h-2.5 w-2.5 rounded-full', DOT[level])} role="img" aria-label={label ?? level} />
}

/* ───────── Card / header / tabs ───────── */
export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={cx('rounded-2xl border border-line bg-card shadow-card', pad && 'p-4', className)}>{children}</section>
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold leading-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export type TabItem<K extends string> = { key: K; label: string; count?: number | null }
export function Tabs<K extends string>({ items, value, onChange }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void }) {
  return (
    <div role="tablist" className="-mx-4 mb-3 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {items.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={t.key === value}
          tabIndex={t.key === value ? 0 : -1}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
            const i = items.findIndex((x) => x.key === value)
            const n = items[(i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length]
            onChange(n.key)
            ;(e.currentTarget.parentElement?.querySelectorAll('[role=tab]')[items.indexOf(n)] as HTMLElement | undefined)?.focus()
          }}
          type="button"
          onClick={() => onChange(t.key)}
          className={cx(
            'min-h-[40px] shrink-0 rounded-full px-3.5 text-sm font-semibold transition',
            t.key === value ? 'bg-brand text-white' : 'bg-white text-ink-secondary border border-line hover:bg-brand-light',
          )}
        >
          {t.label}
          {t.count != null && <span className={cx('ml-1.5 text-xs', t.key === value ? 'text-white/80' : 'text-ink-tertiary')}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

/* ───────── Form fields ───────── */
export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  const id = useId()
  // Bind the label to the control itself when there is exactly one (input/select/textarea);
  // for composite content (several controls) fall back to a labelled group.
  const only = Children.count(children) === 1 && isValidElement(children) ? (children as ReactElement<{ id?: string }>) : null
  const single = only && typeof only.type !== 'string' ? true : only && ['input', 'select', 'textarea'].includes(only.type as string)
  const control = single && only ? cloneElement(only, { id: only.props.id ?? id }) : null
  return (
    <div className="mb-3">
      <label id={`${id}-l`} htmlFor={control ? (only!.props.id ?? id) : undefined} className="mb-1 block text-sm font-medium text-ink">{label}</label>
      {control ?? <div role="group" aria-labelledby={`${id}-l`}>{children}</div>}
      {hint && !error && <p className="mt-1 text-xs text-ink-secondary">{hint}</p>}
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  )
}
const FIELD_CLS = 'min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-[15px] text-ink placeholder:text-ink-tertiary focus:border-brand-mid focus:outline-none focus:ring-2 focus:ring-brand-soft'
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(FIELD_CLS, props.className)} />
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(FIELD_CLS, props.className)} />
}
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50', checked ? 'bg-ok' : 'bg-gray-300')}
    >
      <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  )
}
export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[15px]">
      <input type="checkbox" className="h-5 w-5 accent-[#002FA7]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

/* ───────── States ───────── */
export function Spinner({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-secondary" role="status">
      <Loader2 size={18} className="animate-spin" aria-hidden /> {label}
    </div>
  )
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-xl bg-gray-200/70', className)} />
}
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-bad">
      <XCircle size={18} aria-hidden />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Повторить</Button>}
    </div>
  )
}
export function EmptyState({ title, text, action }: { title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <div className="text-[15px] font-semibold">{title}</div>
      {text && <div className="max-w-md text-sm text-ink-secondary">{text}</div>}
      {action}
    </div>
  )
}
export function Banner({ tone = 'warn', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className={cx('mb-3 flex items-start gap-2 rounded-xl p-3 text-sm', TONE[tone])} role={tone === 'bad' ? 'alert' : 'status'}>
      <span className="mt-0.5">{TONE_ICON[tone]}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function KpiTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-card p-3 shadow-card sm:p-3.5">
      <div className="truncate text-[11px] font-medium text-ink-secondary sm:text-xs">{label}</div>
      <div className={cx('mt-1 break-words text-xl font-bold tabular-nums sm:text-2xl', tone === 'bad' && 'text-bad', tone === 'warn' && 'text-warn')}>{value}</div>
      {sub && <div className="mt-0.5 line-clamp-2 text-[11px] text-ink-secondary sm:text-xs">{sub}</div>}
    </div>
  )
}

/* ───────── Drawer (right panel on desktop, bottom sheet on phone) ───────── */
export function Drawer({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  // Keep the latest onClose without re-running the effect: a parent re-render must not steal focus from a field.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeRef.current(); return }
      if (e.key !== 'Tab' || !ref.current) return
      const items = [...ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')]
      if (!items.length) { e.preventDefault(); return }
      const first = items[0], last = items[items.length - 1]
      const cur = document.activeElement
      if (e.shiftKey && (cur === first || cur === ref.current)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      prev?.focus?.()
    }
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/40 sm:items-stretch" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white shadow-soft outline-none sm:max-h-none sm:rounded-none sm:rounded-l-3xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="min-w-0 truncate text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-gray-100">
            <X size={20} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

/* ───────── Confirm dialog (optional typed confirmation) ───────── */
export function ConfirmDialog({
  open, title, children, confirmLabel = 'Подтвердить', danger, typed, busy, onConfirm, onCancel,
}: {
  open: boolean; title: string; children?: ReactNode; confirmLabel?: string; danger?: boolean
  typed?: string; busy?: boolean; onConfirm: () => void; onCancel: () => void
}) {
  const [text, setText] = useState('')
  useEffect(() => { if (open) setText('') }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])
  if (!open) return null
  const ok = !typed || text.trim().toLowerCase() === typed.toLowerCase()
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="alertdialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-soft">
        <h2 className="text-lg font-bold">{title}</h2>
        {children && <div className="mt-2 text-sm text-ink-secondary">{children}</div>}
        {typed && (
          <div className="mt-3">
            <label className="mb-1 block text-sm">Для подтверждения введите <b>{typed}</b></label>
            <Input value={text} onChange={(e) => setText(e.target.value)} autoFocus autoComplete="off" />
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Отмена</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={!ok} loading={busy}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}

/* ───────── Toast ───────── */
type ToastItem = { id: number; tone: 'ok' | 'bad' | 'neutral'; text: string }
const ToastCtx = createContext<{ push: (text: string, tone?: ToastItem['tone']) => void }>({ push: () => {} })
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((text: string, tone: ToastItem['tone'] = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, tone, text }])
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'bad' ? 7000 : 3500)
  }, [])
  const value = useMemo(() => ({ push }), [push])
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex flex-col items-center gap-2 px-4 sm:bottom-6" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto max-w-md rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-soft', t.tone === 'bad' ? 'bg-bad' : t.tone === 'ok' ? 'bg-ink' : 'bg-ink-secondary')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ───────── Responsive table: table on desktop, card list on phone ───────── */
export type Column<T> = {
  key: string
  header: string
  render: (row: T) => ReactNode
  className?: string
  /** shown as the card title on phone */
  primary?: boolean
  /** hidden in phone cards */
  hideOnPhone?: boolean
  align?: 'right'
  sortKey?: string
}
export function DataTable<T>({
  rows, columns, rowKey, onRowClick, selection, onSelectionChange, sort, onSort, empty,
}: {
  rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string | number
  onRowClick?: (r: T) => void
  selection?: Set<string | number>; onSelectionChange?: (s: Set<string | number>) => void
  sort?: { key: string; dir: 'asc' | 'desc' }; onSort?: (key: string) => void
  empty?: ReactNode
}) {
  const selectable = !!selection && !!onSelectionChange
  const allSel = selectable && rows.length > 0 && rows.every((r) => selection!.has(rowKey(r)))
  const toggle = (k: string | number) => {
    const n = new Set(selection)
    n.has(k) ? n.delete(k) : n.add(k)
    onSelectionChange!(n)
  }
  const toggleAll = () => {
    const n = new Set(selection)
    if (allSel) rows.forEach((r) => n.delete(rowKey(r)))
    else rows.forEach((r) => n.add(rowKey(r)))
    onSelectionChange!(n)
  }
  if (!rows.length) return <Card>{empty ?? <EmptyState title="Ничего не найдено" />}</Card>
  const primary = columns.find((c) => c.primary) ?? columns[0]
  const rest = columns.filter((c) => c !== primary && !c.hideOnPhone)
  return (
    <>
      {/* desktop / tablet */}
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-card shadow-card md:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-ink-secondary">
            <tr>
              {selectable && (
                <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Выбрать все" className="h-4 w-4 accent-[#002FA7]" checked={allSel} onChange={toggleAll} /></th>
              )}
              {columns.map((c) => (
                <th key={c.key} scope="col" aria-sort={c.sortKey && sort?.key === c.sortKey ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cx('whitespace-nowrap px-3 py-2.5 font-semibold', c.align === 'right' && 'text-right', c.className)}>
                  {c.sortKey && onSort ? (
                    <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-brand" onClick={() => onSort(c.sortKey!)}>
                      {c.header}{sort?.key === c.sortKey && (sort.dir === 'asc' ? ' ↑' : ' ↓')}
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const k = rowKey(r)
              return (
                <tr
                  key={k}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRowClick(r) } } : undefined}
                  className={cx('border-t border-line', onRowClick && 'cursor-pointer hover:bg-brand-light focus-visible:bg-brand-light focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-mid', selection?.has(k) && 'bg-brand-soft')}
                >
                  {selectable && (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label="Выбрать строку" className="h-4 w-4 accent-[#002FA7]" checked={selection!.has(k)} onChange={() => toggle(k)} />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} className={cx('px-3 py-2 align-middle', c.align === 'right' && 'text-right tabular-nums', c.className)}>{c.render(r)}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* phone */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => {
          const k = rowKey(r)
          return (
            <li
              key={k}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRowClick(r) } } : undefined}
              className={cx('rounded-2xl border border-line bg-card p-3.5 shadow-card', onRowClick && 'cursor-pointer active:bg-brand-light', selection?.has(k) && 'border-brand bg-brand-soft')}
            >
              <div className="flex items-start gap-2.5">
                {selectable && (
                  <input type="checkbox" aria-label="Выбрать" className="mt-1 h-5 w-5 accent-[#002FA7]" checked={selection!.has(k)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(k)} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{primary.render(r)}</div>
                  <dl className="mt-1.5 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-sm">
                    {rest.map((c) => (
                      <div key={c.key} className="contents">
                        <dt className="text-ink-secondary">{c.header}</dt>
                        <dd className="min-w-0 text-right">{c.render(r)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
