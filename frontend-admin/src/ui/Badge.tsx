export function Badge({ level, children }: { level?: 'ok' | 'warn' | 'bad' | 'neutral'; children: React.ReactNode }) {
  const cls =
    level === 'ok'
      ? 'bg-emerald-100 text-emerald-800'
      : level === 'warn'
        ? 'bg-amber-100 text-amber-900'
        : level === 'bad'
          ? 'bg-red-100 text-red-800'
          : 'bg-slate-100 text-slate-700'
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
}
