import { Download, X } from 'lucide-react'
import { cx } from '../../ui/kit'
import { progressText, type ExportJob, type ExportRequest } from '../../lib/exportQueue'

/**
 * Очередь экспорта в углу: видно, что собирается, сколько процентов и где скачать.
 * Живёт поверх редактора, поэтому работа не блокируется (P2-9).
 */
export default function ExportJobsPanel({
  jobs,
  onCancel,
  onClose,
  onForce,
}: {
  jobs: ExportJob[]
  onCancel: (id: string) => void
  onClose: (id: string) => void
  onForce: (req: ExportRequest) => void
}) {
  return (
    <div className="fixed bottom-4 right-4 z-[70] w-[330px] max-w-[calc(100vw-2rem)] space-y-2" aria-live="polite">
      {jobs.map((job) => (
        <div key={job.id} className="rounded-xl border border-line bg-white p-3 shadow-soft">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold text-ink">{job.label}</p>
              <p className={cx('text-[11px]', job.status === 'error' || job.status === 'blocked' ? 'text-bad' : 'text-ink-tertiary')}>
                {progressText(job)}
                {job.error ? ` · ${job.error}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onClose(job.id)}
              className="grid h-6 w-6 flex-none place-items-center rounded text-ink-tertiary hover:text-ink"
              aria-label="Закрыть задачу экспорта"
            >
              <X size={13} />
            </button>
          </div>

          {job.status === 'running' && (
            <div
              className="mt-2 h-1 overflow-hidden rounded bg-surface-2"
              role="progressbar"
              aria-label="Сборка PDF"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={job.progress == null ? undefined : Math.round(job.progress * 100)}
            >
              <div
                className={cx('h-full bg-brand transition-all', job.progress == null && 'animate-pulse')}
                style={{ width: `${Math.round((job.progress ?? 0.2) * 100)}%` }}
              />
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {job.status === 'done' && job.url && (
              <a
                href={job.url}
                download={job.filename}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-brand px-2 text-[11.5px] font-semibold text-white hover:opacity-90"
              >
                <Download size={13} aria-hidden /> Скачать
              </a>
            )}
            {job.status === 'running' && (
              <button
                type="button"
                onClick={() => onCancel(job.id)}
                className="h-7 rounded-md px-2 text-[11.5px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-bad"
              >
                Отменить
              </button>
            )}
            {job.status === 'blocked' && (
              <button
                type="button"
                onClick={() => onForce(job.request)}
                className="h-7 rounded-md px-2 text-[11.5px] font-semibold text-brand hover:bg-surface-2"
              >
                Скачать как есть
              </button>
            )}
            {job.status === 'done' && job.durationMs != null && (
              <span className="text-[11px] text-ink-tertiary">{(job.durationMs / 1000).toFixed(1)} с</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
