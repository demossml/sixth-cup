import { describe, expect, it } from 'vitest'
import {
  applyProgress,
  blockJob,
  cancelJob,
  createJob,
  exportFilename,
  exportLabel,
  exportProgress,
  exportQuery,
  failJob,
  finishJob,
  liveJobs,
  nextQueued,
  progressText,
  startJob,
  type ExportRequest,
} from './exportQueue'

const req = (extra: Partial<ExportRequest> = {}): ExportRequest => ({
  layoutId: 4,
  preset: 'print',
  bleed: 3,
  cmyk: false,
  ...extra,
})

describe('очередь экспорта PDF', () => {
  it('имя файла: дата без времени и без двоеточий', () => {
    expect(exportFilename(4, new Date('2026-11-10T18:30:00Z'))).toBe('menu-4-2026-11-10.pdf')
  })

  it('запрос: для экрана поля всегда 0, CMYK и force добавляются только по флагу', () => {
    expect(exportQuery(req())).toBe('preset=print&bleed=3')
    expect(exportQuery(req({ preset: 'screen', bleed: 5 }))).toBe('preset=screen&bleed=0')
    expect(exportQuery(req({ cmyk: true, force: true }))).toBe('preset=print&bleed=3&cmyk=1&force=1')
  })

  it('подпись задачи объясняет, что собирается', () => {
    expect(exportLabel(req())).toBe('PDF · печать · поля 3 мм')
    expect(exportLabel(req({ preset: 'screen' }))).toBe('PDF · экран')
    expect(exportLabel(req({ cmyk: true }))).toBe('PDF · печать · поля 3 мм · CMYK')
    expect(exportLabel(req({ impose: 'a3-4' }))).toBe('PDF · печать · поля 3 мм · 4 на A3 (2×2)')
    // Для экрана спуск не имеет смысла — не упоминаем.
    expect(exportLabel(req({ preset: 'screen', impose: 'a3-4' }))).toBe('PDF · экран')
  })

  it('спуск полос уходит в запрос только когда выбран', () => {
    expect(exportQuery(req({ impose: 'off' }))).toBe('preset=print&bleed=3')
    expect(exportQuery(req({ impose: 'a3-2' }))).toBe('preset=print&bleed=3&impose=a3-2')
    expect(exportQuery(req({ impose: 'a2-4', cmyk: true }))).toBe('preset=print&bleed=3&cmyk=1&impose=a2-4')
  })

  it('прогресс не ломается, если сервер не прислал размер', () => {
    expect(exportProgress(0, 0)).toBeNull()
    expect(exportProgress(10, Number.NaN)).toBeNull()
    expect(exportProgress(512, 1024)).toBe(0.5)
    // Больше, чем заявлено, не бывает — иначе полоска уезжает за край.
    expect(exportProgress(2048, 1024)).toBe(1)
  })

  it('переходы статусов: queued → running → done', () => {
    const job = createJob(req(), 1000, 'j1')
    expect(job.status).toBe('queued')
    expect(job.filename).toBe(exportFilename(4))

    const running = applyProgress(startJob(job, 1100), 256, 1024)
    expect(running.status).toBe('running')
    expect(running.progress).toBe(0.25)

    const done = finishJob(running, 'blob:1', 131_072, 1600)
    expect(done.status).toBe('done')
    expect(done.sizeKb).toBe(128)
    expect(done.progress).toBe(1)
    // Время считаем от старта, а не от постановки в очередь.
    expect(done.durationMs).toBe(500)
  })

  it('ошибка и 409 — разные состояния: 409 значит «нужны правки в макете»', () => {
    const job = startJob(createJob(req(), 1000, 'j2'), 1000)
    expect(failJob(job, 'Сервер ответил 500', 1200).status).toBe('error')
    const blocked = blockJob(job, 'Есть пустые позиции', 1200)
    expect(blocked.status).toBe('blocked')
    expect(blocked.error).toContain('пустые')
    expect(cancelJob(job, 1300).status).toBe('canceled')
  })

  it('очередь идёт по одной задаче, отменённые не показываются', () => {
    const a = createJob(req(), 1, 'a')
    const b = createJob(req(), 2, 'b')
    expect(nextQueued([a, b])?.id).toBe('a')
    const running = startJob(a, 10)
    expect(nextQueued([running, b])?.id).toBe('b')
    expect(liveJobs([running, cancelJob(b, 20)])).toHaveLength(1)
    expect(nextQueued([running])).toBeUndefined()
  })

  it('текст прогресса для панели', () => {
    const job = createJob(req(), 1000, 'j3')
    expect(progressText(job)).toBe('в очереди')
    expect(progressText(startJob(job))).toBe('собираем…')
    expect(progressText(applyProgress(startJob(job), 512, 1024))).toBe('50 %')
    expect(progressText(finishJob(job, 'blob:x', 2048))).toBe('готов · 2 КБ')
    expect(progressText(blockJob(job, 'пусто'))).toBe('нужны правки')
    expect(progressText(failJob(job, 'сеть'))).toBe('ошибка')
  })
})
