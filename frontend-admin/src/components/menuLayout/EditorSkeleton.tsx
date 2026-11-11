/**
 * Скелетон редактора: держит ту же сетку (панель — лист — панель), чтобы при загрузке
 * ничего не «прыгало». Дешевле спиннера по восприятию и не даёт layout shift.
 */
export default function EditorSkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Загружаем редактор макета">
      <div className="mb-3 h-9 rounded-xl bg-surface-2" />
      <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)_290px]">
        <div className="hidden space-y-2 rounded-xl border border-line bg-white p-3 lg:block">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-7 rounded-lg bg-surface-2" style={{ opacity: 1 - i * 0.07 }} />
          ))}
        </div>
        <div className="rounded-xl border border-line bg-[#e9ebef] p-4">
          <div className="mx-auto aspect-[210/297] w-full max-w-[520px] rounded-lg bg-white/80" />
        </div>
        <div className="hidden space-y-2 rounded-xl border border-line bg-white p-3 lg:block">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-8 rounded-lg bg-surface-2" style={{ opacity: 1 - i * 0.08 }} />
          ))}
        </div>
      </div>
    </div>
  )
}
