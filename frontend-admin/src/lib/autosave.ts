/**
 * P2-15b: очередь автосохранения макета — без React, чтобы её можно было проверить тестами.
 *
 * Правила, которые здесь закреплены:
 *  - один запрос за раз: новый пакет сбрасывает таймер и уходит вместо старого;
 *  - ответ устаревшего запроса не перебивает более новый (номер последовательности);
 *  - одинаковый payload не сохраняется повторно (сравнение с последним сохранённым);
 *  - flush() отправляет немедленно и нужен перед серверными операциями, которые
 *    перезаписывают документ (seed, спуск полос, фиксация цен).
 */

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export type AutosaveJob<Body> = { payload: string; body: Body }

export type AutosaveOptions<Body, Res> = {
  /** PUT макета: сюда приходит тело и rev, который клиент видел. */
  save: (body: Body, baseRev: number) => Promise<Res>
  getRev: () => number
  /** 409 от сервера: макет изменили в другом окне. */
  isConflict: (error: unknown) => boolean
  onState: (state: SaveState) => void
  onSaved: (payload: string, res: Res) => void
  onConflict: () => void
  onError: (error: unknown) => void
  /** Задержка склейки правок. */
  delayMs?: number
}

export type Autosave<Body, Res> = {
  /** Поставить пакет в очередь: он уйдёт через delayMs, если не появится новый. */
  schedule: (body: Body) => void
  /** Отправить немедленно (перед seed/sync/freeze и при уходе со страницы). */
  flush: () => Promise<void>
  /** Повторить отправку после того, как владелец решил «перезаписать своей». */
  retry: () => Promise<void>
  /** Отметить payload как уже сохранённый (гидратация, черновик, серверные операции). */
  markSaved: (payload: string) => void
  savedPayload: () => string
  pendingJob: () => AutosaveJob<Body> | null
  latestJob: () => AutosaveJob<Body> | null
  payloadOf: (body: Body) => string
  dispose: () => void
}

const DEFAULT_DELAY = 800

export function createAutosave<Body, Res>(opts: AutosaveOptions<Body, Res>): Autosave<Body, Res> {
  const delay = opts.delayMs ?? DEFAULT_DELAY
  let timer: ReturnType<typeof setTimeout> | null = null
  let seq = 0
  let saved = ''
  let pending: AutosaveJob<Body> | null = null
  let latest: AutosaveJob<Body> | null = null
  let disposed = false

  const payloadOf = (body: Body): string => JSON.stringify(body)

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const send = async (job: AutosaveJob<Body>): Promise<void> => {
    if (job.payload === saved) {
      pending = null
      return
    }
    const mine = ++seq
    opts.onState('saving')
    try {
      const res = await opts.save(job.body, opts.getRev())
      // Пока запрос летел, ушёл более новый — этот ответ уже неактуален.
      if (mine !== seq || disposed) return
      saved = job.payload
      pending = null
      opts.onSaved(job.payload, res)
      opts.onState('saved')
    } catch (error) {
      if (mine !== seq || disposed) return
      opts.onState('error')
      if (opts.isConflict(error)) opts.onConflict()
      else opts.onError(error)
    }
  }

  return {
    payloadOf,
    savedPayload: () => saved,
    markSaved: (payload: string) => {
      saved = payload
    },
    pendingJob: () => pending,
    latestJob: () => latest,
    schedule: (body: Body) => {
      // StrictMode в dev размонтирует компонент сразу после монтирования и тем самым
      // вызывает dispose(); экземпляр из useMemo остаётся тем же, поэтому новая
      // постановка в очередь означает, что владелец снова жив, — будим очередь.
      disposed = false
      const payload = payloadOf(body)
      latest = { payload, body }
      if (payload === saved) {
        pending = null
        clearTimer()
        return
      }
      pending = { payload, body }
      opts.onState('dirty')
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        const job = pending
        if (job && job.payload !== saved) void send(job)
      }, delay)
    },
    flush: async () => {
      clearTimer()
      const job = pending
      if (!job || job.payload === saved) return
      await send(job)
    },
    retry: async () => {
      clearTimer()
      const job = pending ?? latest
      if (job) await send(job)
      else opts.onState('saved')
    },
    dispose: () => {
      disposed = true
      clearTimer()
    },
  }
}
