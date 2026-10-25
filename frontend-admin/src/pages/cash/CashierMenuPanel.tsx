import { useState } from 'react'
import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { Badge, Button, Card, Check, ErrorBox, Skeleton, useToast } from '../../ui/kit'
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'

/** Адрес настроек: с точкой — её собственная, без точки — общая. */
export function cashierMenuUrl(storeUuid: string | null): string {
  return storeUuid ? `/cashier/menu?storeUuid=${encodeURIComponent(storeUuid)}` : '/cashier/menu'
}

/** Тело PATCH: для точки добавляем storeUuid, для общей настройки — нет. */
export function cashierMenuPatch(
  storeUuid: string | null,
  body: { showAllTab?: boolean; hiddenGroups?: string[]; order?: string[] },
): Record<string, unknown> {
  return storeUuid ? { storeUuid, ...body } : body
}

/** Меняет местами соседей; за границами списка возвращает null (двигать некуда). */
export function movedTab(order: string[], index: number, delta: number): string[] | null {
  const to = index + delta
  if (index < 0 || index >= order.length || to < 0 || to >= order.length) return null
  const next = [...order]
  const a = next[index]
  next[index] = next[to]
  next[to] = a
  return next
}

type MenuResp = {
  storeUuid: string | null
  own: boolean
  showAllTab: boolean
  hiddenGroups: string[]
  order: string[]
  allGroups: string[]
}

/**
 * Меню кассы: порядок вкладок и что скрыть.
 * storeUuid задан — настройка точки (живёт в её карточке); null — общая настройка-наследство
 * для точек, у которых своей нет.
 */
export default function CashierMenuPanel({ storeUuid, storeName }: { storeUuid: string | null; storeName?: string }) {
  const shared = storeUuid == null
  const toast = useToast()
  const { data, error, loading, reload } = useApi<MenuResp>(cashierMenuUrl(storeUuid))
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const patch = async (body: { showAllTab?: boolean; hiddenGroups?: string[]; order?: string[] }, okText: string) => {
    setBusy(true)
    try {
      await api('/cashier/menu', { method: 'PATCH', body: cashierMenuPatch(storeUuid, body) })
      toast.push(okText)
      reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    if (shared) return
    setBusy(true)
    try {
      await api(cashierMenuUrl(storeUuid), { method: 'DELETE' })
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
    const next = movedTab(data.order, index, delta)
    if (!next) return
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
          <span className="text-[14px] font-semibold">{shared ? 'Общее меню кассы' : 'Меню на кассе'}</span>
          {data &&
            (shared ? (
              <Badge tone="brand">{data.own ? 'общая настройка' : 'заводская'}</Badge>
            ) : (
              <Badge tone={data.own ? 'brand' : 'neutral'}>{data.own ? 'своя настройка' : 'как у всех'}</Badge>
            ))}
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
                {shared
                  ? 'Порядок вкладок и видимость по умолчанию: так касса выглядит, пока у точки нет своей настройки.'
                  : `Порядок вкладок и видимость — только для точки «${storeName ?? storeUuid}». Другие кассы не затрагиваются.`}
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

              {data.own && !shared && (
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
