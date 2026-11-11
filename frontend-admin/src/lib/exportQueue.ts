/**
 * Очередь экспорта PDF (P2-9).
 *
 * Раньше модалка ждала ответ сервера: на большом макете интерфейс «висел» без
 * признаков жизни. Теперь экспорт — задача в очереди: она стартует после закрытия
 * модалки, показывает прогресс загрузки и по готовности даёт ссылку на файл.
 *
 * Здесь только чистая логика — сам XHR и состояние живут в редакторе, поэтому
 * переходы статусов покрыты тестами без браузера.
 */

export type ExportPreset = 'print' | 'screen'

export type ExportRequest = {
  layoutId: number
  preset: ExportPreset
  /** Поля под обрез, мм. Для экрана всегда 0. */
  bleed: number
  cmyk: boolean
  /** Положить замечания к блокам в PDF аннотациями-стикерами. */
  notes?: boolean
  /** Спуск полос: сетка страниц на A3/A2. `off` — обычный экспорт. */
  impose?: ImposePreset
  /** Скачать, даже если в макете есть пустые позиции (409 на сервере). */
  force?: boolean
}

export type ImposePreset = 'off' | 'a3-2' | 'a3-4' | 'a2-4'

/** Подписи пресетов: те же, что у сервера в `/imposition.ts`. */
export const IMPOSE_LABELS: Record<ImposePreset, string> = {
  off: 'Не спускать',
  'a3-2': '2 на A3 (2×1)',
  'a3-4': '4 на A3 (2×2)',
  'a2-4': '4 на A2 (2×2)',
}

/**
 * P3-5: пресеты типографий — одна кнопка вместо ручной настройки полей и спуска.
 * Формат листа в пресет не входит: он принадлежит макету, а не экспорту.
 */
export type TypoPreset = 'none' | 'print-a4' | 'fold-a3-2' | 'brochure-a3-4' | 'a5-booklet'

export type TypoPresetSpec = {
  label: string
  /** Подсказка: что именно подставит пресет. */
  hint: string
  preset: ExportPreset
  bleed: number
  cmyk: boolean
  impose: ImposePreset
}

export const TYPO_PRESETS: Record<TypoPreset, TypoPresetSpec> = {
  none: { label: 'Без пресета', hint: 'Настроить вручную', preset: 'print', bleed: 3, cmyk: false, impose: 'off' },
  'print-a4': { label: 'Лист A4', hint: '3 мм под обрез, метки реза, CMYK', preset: 'print', bleed: 3, cmyk: true, impose: 'off' },
  'fold-a3-2': { label: 'A3, 2 фальца', hint: 'две A4 на A3 с полями 3 мм', preset: 'print', bleed: 3, cmyk: true, impose: 'a3-2' },
  'brochure-a3-4': { label: 'A3, буклет 4×', hint: 'четыре A4 на A3, CMYK', preset: 'print', bleed: 3, cmyk: true, impose: 'a3-4' },
  'a5-booklet': { label: 'A2, 4×A5', hint: 'четыре страницы A5 на A2, CMYK', preset: 'print', bleed: 3, cmyk: true, impose: 'a2-4' },
}

export type ExportStatus = 'queued' | 'running' | 'done' | 'error' | 'blocked' | 'canceled'

export type ExportJob = {
  id: string
  layoutId: number
  /** Исходный запрос: раннеру нужны preset/bleed/cmyk/force. */
  request: ExportRequest
  label: string
  status: ExportStatus
  /** 0…1; null — сервер не прислал общий размер, показываем «идёт». */
  progress: number | null
  received: number
  total: number
  sizeKb: number | null
  filename: string
  /** Ссылка на готовый файл (object URL). Живёт, пока задачу не закрыли. */
  url: string | null
  error: string | null
  /** Сколько миллисекунд заняла сборка — доходит из редактора в момент финиша. */
  durationMs: number | null
  startedAt: number
  finishedAt: number | null
}

let seq = 0

/** Имя файла: одинаковое в панели и в подсказке, без двоеточий из ISO-даты. */
export function exportFilename(layoutId: number, date: Date = new Date()): string {
  const iso = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
  return `menu-${layoutId}-${iso.slice(0, 10)}.pdf`
}

/** Строка запроса для серверного экспорта. */
export function exportQuery(req: ExportRequest): string {
  const qs = new URLSearchParams({
    preset: req.preset,
    bleed: String(req.preset === 'print' ? req.bleed : 0),
  })
  if (req.cmyk) qs.set('cmyk', '1')
  if (req.notes) qs.set('notes', '1')
  if (req.impose && req.impose !== 'off') qs.set('impose', req.impose)
  if (req.force) qs.set('force', '1')
  return qs.toString()
}

/** Человеческая подпись задачи — видно, что именно собирается. */
export function exportLabel(req: ExportRequest): string {
  const mode = req.preset === 'print' ? `печать · поля ${req.bleed} мм` : 'экран'
  const notes = req.notes ? ' · с замечаниями' : ''
  const impose = req.preset === 'print' && req.impose && req.impose !== 'off' ? ` · ${IMPOSE_LABELS[req.impose]}` : ''
  return `PDF · ${mode}${req.cmyk ? ' · CMYK' : ''}${notes}${impose}`
}

/** Новый элемент очереди. */
export function createJob(req: ExportRequest, now: number = Date.now(), id?: string): ExportJob {
  return {
    id: id ?? `export-${++seq}-${now.toString(36)}`,
    layoutId: req.layoutId,
    request: req,
    label: exportLabel(req),
    status: 'queued',
    progress: null,
    received: 0,
    total: 0,
    sizeKb: null,
    filename: exportFilename(req.layoutId),
    url: null,
    error: null,
    durationMs: null,
    startedAt: now,
    finishedAt: null,
  }
}

/** Прогресс загрузки: сервер отдаёт PDF одним куском, но с Content-Length. */
export function exportProgress(received: number, total: number): number | null {
  if (!Number.isFinite(received) || !Number.isFinite(total) || total <= 0) return null
  return Math.max(0, Math.min(1, received / total))
}

export function startJob(job: ExportJob, now: number = Date.now()): ExportJob {
  return { ...job, status: 'running', startedAt: now, error: null }
}

export function applyProgress(job: ExportJob, received: number, total: number): ExportJob {
  return { ...job, received, total, progress: exportProgress(received, total) }
}

export function finishJob(job: ExportJob, url: string, sizeBytes: number, now: number = Date.now()): ExportJob {
  return {
    ...job,
    status: 'done',
    progress: 1,
    url,
    sizeKb: Math.max(1, Math.round(sizeBytes / 1024)),
    finishedAt: now,
    durationMs: now - job.startedAt,
  }
}

export function failJob(job: ExportJob, message: string, now: number = Date.now()): ExportJob {
  return { ...job, status: 'error', error: message, finishedAt: now, durationMs: now - job.startedAt }
}

/** 409: в макете есть пустые позиции — сервер отказался собирать. */
export function blockJob(job: ExportJob, message: string, now: number = Date.now()): ExportJob {
  return { ...job, status: 'blocked', error: message, finishedAt: now, durationMs: now - job.startedAt }
}

export function cancelJob(job: ExportJob, now: number = Date.now()): ExportJob {
  return { ...job, status: 'canceled', finishedAt: now, durationMs: now - job.startedAt }
}

/** Первая задача, ждущая запуска: очередь идёт строго по одной. */
export function nextQueued(jobs: ExportJob[]): ExportJob | undefined {
  return jobs.find((job) => job.status === 'queued')
}

/** Активные задачи: их показывает панель. Завершённые живут, пока не закроют. */
export function liveJobs(jobs: ExportJob[]): ExportJob[] {
  return jobs.filter((job) => job.status !== 'canceled')
}

/** Текст прогресса для панели: «42 %» или «собираем…», если размер неизвестен. */
export function progressText(job: ExportJob): string {
  if (job.status === 'queued') return 'в очереди'
  if (job.status === 'running') return job.progress == null ? 'собираем…' : `${Math.round(job.progress * 100)} %`
  if (job.status === 'done') return job.sizeKb ? `готов · ${job.sizeKb} КБ` : 'готов'
  if (job.status === 'blocked') return 'нужны правки'
  if (job.status === 'canceled') return 'отменён'
  return 'ошибка'
}
