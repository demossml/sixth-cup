type Props = { title: string; body?: string; actionLabel?: string; onAction?: () => void }
export default function StateBlock({ title, body, actionLabel, onAction }: Props) {
  return (
    <div className="card text-center py-8 px-4">
      <p className="text-[17px] font-semibold text-ink">{title}</p>
      {body ? <p className="mt-2 text-[14px] text-ink-secondary leading-5">{body}</p> : null}
      {actionLabel && onAction ? (
        <button type="button" className="btn-ghost mt-4 max-w-[240px] mx-auto" onClick={onAction}>{actionLabel}</button>
      ) : null}
    </div>
  )
}
