/** Скелет сетки 2×N: те же размеры, что у карточек → нет скачка при подгрузке каталога. */
export default function MenuSkeleton({ rows = 3 }: { rows?: number }) {
  const pulse = 'animate-pulse motion-reduce:animate-none'
  return (
    <div role="status" aria-busy="true" aria-label="Загружаем меню">
      <div className={`flex gap-2 px-4 pb-3 overflow-hidden ${pulse}`}>
        {[52, 84, 96, 72, 88].map((w, i) => (
          <div key={i} className="h-10 rounded-full bg-[#E9E3D8] shrink-0" style={{ width: w }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 px-4">
        {Array.from({ length: rows * 2 }, (_, i) => (
          <div key={i} className={`rounded-2xl overflow-hidden bg-white border border-line/80 ${pulse}`}>
            <div className="aspect-square bg-[#EDE7DC]" />
            <div className="px-2.5 py-2.5">
              <div className="h-[13px] w-4/5 rounded bg-[#E9E3D8]" />
              <div className="h-[13px] w-3/5 rounded bg-[#E9E3D8] mt-1.5" />
              <div className="h-4 w-1/3 rounded bg-[#E9E3D8] mt-2.5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
