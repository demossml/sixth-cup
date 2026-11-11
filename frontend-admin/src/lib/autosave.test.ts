import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosave, type SaveState } from './autosave'

type Body = { title: string }
type Res = { rev: number; savedAt: number }

type Harness = ReturnType<typeof harness>

function harness(over: Partial<Parameters<typeof createAutosave<Body, Res>>[0]> = {}) {
  const states: SaveState[] = []
  const saved: { payload: string; res: Res }[] = []
  const errors: unknown[] = []
  let conflicts = 0
  let rev = 1
  const save = vi.fn(async (_body: Body, _baseRev: number) => ({ rev: ++rev, savedAt: 1000 + rev }))
  const api = createAutosave<Body, Res>({
    save,
    getRev: () => rev,
    isConflict: (e) => (e as { status?: number })?.status === 409,
    onState: (s) => states.push(s),
    onSaved: (payload, res) => saved.push({ payload, res }),
    onConflict: () => conflicts++,
    onError: (e) => errors.push(e),
    delayMs: 800,
    ...over,
  })
  return { api, states, saved, errors, get conflicts() { return conflicts }, save, getRev: () => rev }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('P2-15b: очередь автосохранения', () => {
  it('сохраняет через задержку и отмечает состояние', async () => {
    const h = harness()
    h.api.schedule({ title: 'A' })
    expect(h.states).toEqual(['dirty'])
    await vi.advanceTimersByTimeAsync(799)
    expect(h.save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save.mock.calls[0]![1]).toBe(1) // baseRev — версия, которую видел клиент
    expect(h.states).toEqual(['dirty', 'saving', 'saved'])
    expect(h.saved).toHaveLength(1)
  })

  it('склеивает правки: уходит только последний пакет', async () => {
    const h = harness()
    h.api.schedule({ title: 'A' })
    await vi.advanceTimersByTimeAsync(400)
    h.api.schedule({ title: 'B' })
    await vi.advanceTimersByTimeAsync(400)
    h.api.schedule({ title: 'C' })
    await vi.advanceTimersByTimeAsync(800)
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save.mock.calls[0]![0]).toEqual({ title: 'C' })
  })

  it('одинаковый payload не сохраняется повторно', async () => {
    const h = harness()
    h.api.schedule({ title: 'A' })
    await vi.advanceTimersByTimeAsync(800)
    h.api.schedule({ title: 'A' })
    await vi.advanceTimersByTimeAsync(800)
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.api.pendingJob()).toBeNull()
  })

  it('flush отправляет сразу и отменяет таймер', async () => {
    const h = harness()
    h.api.schedule({ title: 'A' })
    await h.api.flush()
    expect(h.save).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1200)
    expect(h.save).toHaveBeenCalledTimes(1)
  })

  it('flush без изменений ничего не отправляет', async () => {
    const h = harness()
    h.api.markSaved(h.api.payloadOf({ title: 'A' }))
    h.api.schedule({ title: 'A' })
    await h.api.flush()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('второй пакет ждёт первый и уходит уже с новым rev, ответ применяется по порядку', async () => {
    // Параллельных PUT больше нет: два запроса с одним baseRev давали 409 в браузере.
    const resolvers: ((v: Res) => void)[] = []
    const save = vi.fn(
      () =>
        new Promise<Res>((resolve) => {
          resolvers.push(resolve)
        }),
    )
    const h = harness({ save })
    h.api.schedule({ title: 'A' })
    await vi.advanceTimersByTimeAsync(800)
    h.api.schedule({ title: 'B' })
    await vi.advanceTimersByTimeAsync(800)
    // Пока A не ответил, второй запрос не стартует.
    expect(resolvers).toHaveLength(1)

    resolvers[0]!({ rev: 2, savedAt: 1000 })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.saved.map((s) => s.payload)).toEqual([JSON.stringify({ title: 'A' })])
    expect(resolvers).toHaveLength(2) // B дождался и ушёл

    resolvers[1]!({ rev: 3, savedAt: 2000 })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.saved.at(-1)!.res.rev).toBe(3)
    expect(h.api.savedPayload()).toBe(JSON.stringify({ title: 'B' }))
  })

  it('409 уходит в onConflict, а не в общую ошибку', async () => {
    const save = vi.fn(async () => {
      throw { status: 409 }
    })
    const h = harness({ save })
    h.api.schedule({ title: 'A' })
    await vi.advanceTimersByTimeAsync(800)
    expect(h.conflicts).toBe(1)
    expect(h.errors).toHaveLength(0)
    expect(h.states).toEqual(['dirty', 'saving', 'error'])
  })

  it('прочие ошибки идут в onError', async () => {
    const save = vi.fn(async () => {
      throw new Error('сеть')
    })
    const h = harness({ save })
    h.api.schedule({ title: 'A' })
    await vi.advanceTimersByTimeAsync(800)
    expect(h.errors).toHaveLength(1)
    expect(h.conflicts).toBe(0)
  })

  it('retry повторяет последний пакет после решения о конфликте', async () => {
    const save = vi.fn(async () => ({ rev: 9, savedAt: 3000 }))
    const h = harness({ save })
    h.api.schedule({ title: 'A' })
    await vi.advanceTimersByTimeAsync(800)
    save.mockClear()
    await h.api.retry()
    // payload уже сохранён — повтор не нужен.
    expect(save).not.toHaveBeenCalled()

    h.api.schedule({ title: 'B' })
    await h.api.flush()
    expect(h.api.savedPayload()).toBe(JSON.stringify({ title: 'B' }))
  })

  it('markSaved после гидратации: сохранённое состояние не пересохраняется', async () => {
    const h = harness()
    h.api.markSaved(h.api.payloadOf({ title: 'сервер' }))
    h.api.schedule({ title: 'сервер' })
    await vi.advanceTimersByTimeAsync(900)
    expect(h.save).not.toHaveBeenCalled()
    h.api.schedule({ title: 'правка' })
    await vi.advanceTimersByTimeAsync(900)
    expect(h.save).toHaveBeenCalledTimes(1)
  })

  it('dispose гасит таймер и не отправляет после размонтирования', async () => {
    const h = harness()
    h.api.schedule({ title: 'A' })
    h.api.dispose()
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.save).not.toHaveBeenCalled()
  })

  it('после dispose очередь снова работает: StrictMode монтирует тот же экземпляр', async () => {
    const h = harness()
    // В dev React размонтирует и монтирует компонент заново, не пересоздавая useMemo.
    h.api.dispose()
    h.api.schedule({ title: 'правка после ремаунта' })
    await vi.advanceTimersByTimeAsync(900)
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.api.savedPayload()).toBe(JSON.stringify({ title: 'правка после ремаунта' }))
    expect(h.states.at(-1)).toBe('saved')
  })

  it('flush во время летящего запроса не шлёт второй с тем же rev', async () => {
    // Ровно этот сценарий давал 409 в браузере: таймер уже отправил сохранение,
    // а flush() перед серверной операцией стартовал параллельный PUT с тем же baseRev.
    let release: (() => void) | null = null
    const saveSpy = vi.fn(async (_body: Body, baseRev: number) => {
      await new Promise<void>((r) => (release = r))
      return { rev: baseRev + 1, savedAt: 2000 }
    })
    const h = harness({ save: saveSpy })
    h.api.schedule({ title: 'A' })
    await vi.advanceTimersByTimeAsync(800) // таймер отправил
    const flushing = h.api.flush() // «дослать немедленно» — запрос уже летит
    expect(saveSpy).toHaveBeenCalledTimes(1)
    release!()
    await vi.advanceTimersByTimeAsync(0)
    await flushing
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(h.api.savedPayload()).toBe(JSON.stringify({ title: 'A' }))
  })
})
