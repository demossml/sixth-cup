export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-white p-8 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {description ? <p className="text-sm text-ink-secondary mt-1">{description}</p> : null}
    </div>
  )
}
