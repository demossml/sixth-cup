import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Drawer, ErrorBox, Spinner, cx, useToast } from '../../ui/kit'
import { api } from '../../api/client'

type DiffRow = {
  blockId: string
  pageId: string
  pageIndex: number
  productId: number
  title: string
  missing: boolean
  price: { from: number | null; to: number | null } | null
  name: { from: string; to: string } | null
  photo: { from: string | null; to: string | null } | null
  sizes: { from: string; to: string } | null
  manualPrice: boolean
}

type Props = {
  open: boolean
  onClose: () => void
  layoutId: number
  frozen: boolean
  /** Перечитать макет после применения: локальный документ заменяется серверным. */
  onApplied: () => void
}

/**
 * P3-2: что изменилось в каталоге и что применить.
 * Показывает «было → стало» по ценам, названиям и объёмам; применяет только отмеченные строки.
 */
export default function CatalogDiffDrawer({ open, onClose, layoutId, frozen, onApplied }: Props) {
  const toast = useToast()
  const [rows, setRows] = useState<DiffRow[]>([])
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api<{ changes: DiffRow[] }>(`/menu-layouts/${layoutId}/catalog-diff`)
      const list = res.changes ?? []
      setRows(list)
      // По умолчанию отмечено всё, кроме позиций, которых больше нет в каталоге.
      setPicked(Object.fromEntries(list.filter((r) => !r.missing).map((r) => [r.blockId, true])))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сравнить с каталогом')
    } finally {
      setLoading(false)
    }
  }, [layoutId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const selected = useMemo(() => rows.filter((r) => picked[r.blockId] && !r.missing).map((r) => r.blockId), [rows, picked])

  const apply = async () => {
    if (selected.length === 0) return
    setBusy(true)
    try {
      await api(`/menu-layouts/${layoutId}/sync-prices`, { method: 'POST', body: { blocks: selected } })
      toast.push(`Обновлено позиций: ${selected.length}`)
      onApplied()
      await load()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось обновить цены', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const line = (label: string, from: string, to: string) => (
    <p className="text-[11.5px] text-ink-secondary">
      <span className="text-ink-tertiary">{label}:</span> {from} → <span className="font-semibold text-ink">{to}</span>
    </p>
  )

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Что изменилось в каталоге"
      layer={67}
      footer={
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[11.5px] text-ink-tertiary">
            {frozen ? 'Цены зафиксированы: применение только пересоберёт снапшоты.' : `Отмечено: ${selected.length}`}
          </span>
          <Button size="sm" loading={busy} onClick={() => void apply()} disabled={selected.length === 0}>
            Обновить отмеченное
          </Button>
        </div>
      }
    >
      {loading && rows.length === 0 && <Spinner />}
      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {!loading && !error && rows.length === 0 && (
        <p className="text-[12.5px] text-ink-secondary">
          Расхождений нет: цены, названия и объёмы на листе совпадают с каталогом.
        </p>
      )}
      <div className="mb-2 flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setPicked(Object.fromEntries(rows.filter((r) => !r.missing).map((r) => [r.blockId, true])))}
        >
          Отметить все
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setPicked({})}>
          Снять все
        </Button>
        <span className="ml-auto text-[11px] text-ink-tertiary">{rows.length} позиций</span>
      </div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li
            key={r.blockId}
            className={cx('rounded-lg border px-2 py-1.5', r.missing ? 'border-bad/40 bg-bad-soft/30' : 'border-line')}
          >
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={!!picked[r.blockId]}
                disabled={r.missing}
                onChange={(e) => setPicked((cur) => ({ ...cur, [r.blockId]: e.target.checked }))}
                aria-label={`Обновить «${r.title}»`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-ink">
                  {r.title}
                  <span className="ml-1 font-normal text-ink-tertiary">стр. {r.pageIndex + 1}</span>
                </span>
                {r.missing && <p className="text-[11.5px] text-bad">позиции больше нет в каталоге — нужна замена вручную</p>}
                {r.price && line('цена', r.price.from == null ? '—' : `${r.price.from} ₽`, `${r.price.to ?? '—'} ₽`)}
                {r.name && line('название', r.name.from, r.name.to)}
                {r.sizes && line('объёмы', r.sizes.from.replace(/\|/g, ', '), r.sizes.to.replace(/\|/g, ', '))}
                {r.photo && <p className="text-[11.5px] text-ink-secondary">фото в каталоге заменено</p>}
                {r.manualPrice && <p className="text-[11px] text-ink-tertiary">цена задана вручную — не меняем</p>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {rows.length > 0 && (
        <p className="mt-2 text-[11px] leading-4 text-ink-tertiary">
          Применяются только отмеченные строки: у остальных блоков снапшоты остаются прежними, поэтому лист не
          «прыгает» целиком.
        </p>
      )}
    </Drawer>
  )
}
