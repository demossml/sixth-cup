import { useState } from 'react'
import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { Badge, Button, Card, Check, ErrorBox, Skeleton, useToast } from '../../ui/kit'
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'

type MenuResp = {
  storeUuid: string | null
  own: boolean
  showAllTab: boolean
  hiddenGroups: string[]
  order: string[]
  allGroups: string[]
}

/**
 * Меню конкретной кассы: порядок вкладок и что скрыть.
 * Живёт в карточке точки, потому что у каждой кассы набор может быть своим.
 */
export default function CashierMenuPanel({ storeUuid, storeName }: { storeUuid: string; storeName: string }) {
  const toast = useToast()
  const { data, error, loading, reload } = useApi<MenuResp>(`/cashier/menu?storeUuid=${encodeURIComponent(storeUuid)}`)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const patch = async (body: { showAllTab?: boolean; hiddenGroups?: string[]; order?: string[] }, okText: string) => {
    setBusy(true)
    try {
      await api('/cashier/menu', { method: 'PATCH', body: { storeUuid, ...body } })
      toast.push(okText)
      reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      await api(`/cashier/menu?storeUuid=${encodeURIComponent(storeUuid)}`, { method: 'DELETE' })
      toast.push('Касса снова на общей настройке')
      reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const move = (index: number, delta: number) => {
    if (!data) return
    const next = [...data.order]
    const to = index + delta
    if (to < 0 || to >= next.length) return
    ;[next[index], next[to]] = [next[to], next[index]]
    void patch({ order: next }, 'Порядок вкладок сохранён')
  }

  const toggleGroup = (name: string, show: boolean) => {
    if (!data) return
    const hidden = show ? data.hiddenGroups.filter((n) => n !== name) : [...data.hiddenGroups, name]
    void patch({ hiddenGroups: hidden }, show ? `«${name}» снова на кассе` : `«${name}» скрыта на этой кассе`)
  }

  return (
    <Card className="mt-3">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className="text-[14px] font-semibold">Меню на кассе</span>
          {data && (
            <Badge tone={data.own ? 'brand' : 'neutral'}>{data.own ? 'своя настройка' : 'как у всех'}</Badge>
          )}
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && (
        <div className="mt-3">
          {loading && !data && <Skeleton className="h-16" />}
          {error && <ErrorBox message={error} onRetry={reload} />}
          {data && (
            <>
              <p className="mb-3 text-[12px] text-ink-secondary">
                Порядок вкладок и видимость — только для точки «{storeName}». Другие кассы не затрагиваются.
              </p>

              <Check
                checked={data.showAllTab}
                onChange={(v) => patch({ showAllTab: v }, v ? 'Вкладка «Всё» включена' : 'Вкладка «Всё» скрыта')}
                label="Показывать вкладку «Всё»"
              />

              <div className="mt-3 text-[12px] font-medium text-ink-secondary">Порядок вкладок</div>
              {!data.order.length && <p className="text-[12px] text-ink-tertiary">Вкладок нет — все группы скрыты.</p>}
              <ul className="mt-1 space-y-1">
                {data.order.map((name, i) => (
                  <li key={name} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1.5">
                    <span className="text-[13px]">{i + 1}. {name}</span>
                    <span className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Поднять «${name}»`}
                        disabled={busy || i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ChevronUp size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Опустить «${name}»`}
                        disabled={busy || i === data.order.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ChevronDown size={14} />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-3 text-[12px] font-medium text-ink-secondary">Какие группы показывать</div>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {data.allGroups.map((name) => (
                  <Check
                    key={name}
                    checked={!data.hiddenGroups.includes(name)}
                    onChange={(v) => toggleGroup(name, v)}
                    label={name}
                  />
                ))}
              </div>

              {data.own && (
                <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} className="mt-3" loading={busy} onClick={reset}>
                  Сбросить к общей настройке
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  )
}
