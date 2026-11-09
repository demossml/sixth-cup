import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Calculator, Copy, FileText, Info, LayoutTemplate, Plus, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { ago } from '../lib/format'
import {
  DEFAULT_THEME,
  LAYOUT_FORMATS,
  formatLabel,
  type LayoutFormat,
  type MenuBlock,
  type MenuTheme,
} from '../lib/menuLayout'
import { Badge, Button, Card, ConfirmDialog, cx, EmptyState, ErrorBox, Field, Input, PageHeader, Spinner, useToast } from '../ui/kit'
import MenuSheet from '../components/menuLayout/MenuSheet'

type LayoutRow = {
  id: number
  title: string
  format: LayoutFormat
  formatLabel: string
  status: 'draft' | 'ready'
  priceMode: 'live' | 'frozen'
  frozenAt: number | null
  updatedAt: number
  stats: { pages: number; products: number; warnings: number }
  drift: number
  blockers: number
  preview: { theme: MenuTheme; firstPage: MenuBlock[] }
}

type ListBody = { layouts: LayoutRow[] }

/**
 * Список макетов меню. Это не каталог: здесь лист для печати, а товары берутся из «Меню».
 */
export default function MenuLayouts() {
  const nav = useNavigate()
  const toast = useToast()
  const { data, error, loading, reload } = useApi<ListBody>('/menu-layouts')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('Новое меню')
  const [format, setFormat] = useState<LayoutFormat>('a4_portrait')
  const [busy, setBusy] = useState(false)
  const [toDelete, setToDelete] = useState<LayoutRow | null>(null)

  const rows = data?.layouts ?? []

  const create = async () => {
    if (!title.trim()) {
      toast.push('Название макета не может быть пустым', 'bad')
      return
    }
    setBusy(true)
    try {
      const res = await api<{ layout: { id: number } }>('/menu-layouts', {
        method: 'POST',
        body: { title: title.trim(), format },
      })
      setCreating(false)
      nav(`/menu-layouts/${res.layout.id}`)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось создать макет', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const duplicate = async (row: LayoutRow) => {
    try {
      const res = await api<{ layout: { id: number } }>(`/menu-layouts/${row.id}/duplicate`, { method: 'POST', body: {} })
      toast.push('Копия макета создана')
      reload()
      nav(`/menu-layouts/${res.layout.id}`)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось скопировать', 'bad')
    }
  }

  const remove = async (row: LayoutRow) => {
    try {
      await api(`/menu-layouts/${row.id}`, { method: 'DELETE' })
      toast.push('Макет удалён')
      reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось удалить', 'bad')
    }
  }

  return (
    <>
      <PageHeader
        title="Макет меню"
        subtitle="Соберите лист для гостя или типографии из товаров каталога — без вёрстки в Illustrator."
        actions={
          <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
            Новый макет
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-start gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[13px] leading-5 text-ink-secondary">
        <Info size={15} className="mt-0.5 flex-none text-brand" aria-hidden />
        <span>
          Цены и фото подтягиваются из каталога. Правки в макете не меняют кассу и карточки товаров.{' '}
          <Link to="/menu" className="font-semibold text-brand hover:underline">
            Товары каталога — в разделе «Меню»
          </Link>
          , здесь только лист.
        </span>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner />}

      {data && rows.length === 0 && (
        <Card>
          <EmptyState
            title="Макетов пока нет"
            text="Создайте лист A4 и нажмите «Собрать из каталога» — категории и позиции добавятся сами."
            action={
              <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
                Создать макет
              </Button>
            }
          />
        </Card>
      )}

      {rows.length > 0 && (
        <div className="ml-cards">
          {rows.map((row) => {
            const theme = row.preview?.theme ?? DEFAULT_THEME
            const ready = row.status === 'ready'
            const problems = row.blockers
            return (
              <article key={row.id} className="ml-card">
                <Link to={`/menu-layouts/${row.id}`} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                  <div className="ml-card-thumb">
                    <div className="ml-thumb-inner">
                      <MenuSheet
                        page={{ id: 'preview', blocks: row.preview?.firstPage ?? [] }}
                        theme={theme}
                        title={row.title}
                      />
                    </div>
                  </div>
                  <div className="px-3 pt-2.5">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      {ready ? <Badge tone="ok">Готов к печати</Badge> : <Badge tone="neutral">Черновик</Badge>}
                      <span className="text-[11px] font-semibold text-ink-tertiary">
                        {row.formatLabel} · {row.stats.pages} стр.
                      </span>
                    </div>
                    <h3 className="truncate text-[15px] font-semibold text-ink">{row.title}</h3>
                    <p className="mt-0.5 text-[12px] leading-4 text-ink-secondary">
                      {row.stats.products} позиц. · {row.priceMode === 'frozen' ? 'цены зафиксированы' : 'цены живые'}
                    </p>
                    <div className="mt-1 mb-2.5 flex items-center justify-between gap-2 text-[11px] text-ink-tertiary">
                      <span>Изменён {ago(row.updatedAt)}</span>
                      {problems > 0 ? (
                        <span className="font-semibold text-bad">{problems} замечан.</span>
                      ) : row.drift > 0 ? (
                        <span className="font-semibold text-warn">цены изменились</span>
                      ) : null}
                    </div>
                  </div>
                </Link>
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-2 py-1.5">
                  <Link to={`/menu-layouts/${row.id}`} className="px-1 text-[13px] font-semibold text-brand hover:underline">
                    Открыть редактор
                  </Link>
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => void duplicate(row)}
                      className="grid h-8 w-8 place-items-center rounded-lg text-ink-tertiary hover:bg-surface-2 hover:text-brand"
                      title="Дублировать"
                      aria-label={`Дублировать «${row.title}»`}
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setToDelete(row)}
                      className="grid h-8 w-8 place-items-center rounded-lg text-ink-tertiary hover:bg-bad-soft hover:text-bad"
                      title="Удалить"
                      aria-label={`Удалить «${row.title}»`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </article>
            )
          })}

          <button
            type="button"
            onClick={() => setCreating(true)}
            className="ml-card grid place-items-center gap-2 border-dashed px-4 py-10 text-ink-secondary hover:border-brand hover:text-brand"
          >
            <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-2">
              <Plus size={18} />
            </span>
            <strong className="text-[14px]">Создать макет</strong>
            <span className="text-[11px] text-ink-tertiary">A4, A3, 1:1 или экран</span>
          </button>
        </div>
      )}

      {creating && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/45 p-4"
          onMouseDown={(e) => e.target === e.currentTarget && setCreating(false)}
        >
          <div role="dialog" aria-modal="true" aria-label="Новый макет" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-soft">
            <h2 className="text-lg font-bold">Новый макет</h2>
            <p className="mt-1 text-sm text-ink-secondary">Содержимое добавим в редакторе — или одной кнопкой из каталога.</p>
            <div className="mt-4">
              <Field label="Название">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Летнее меню" />
              </Field>
            </div>
            <div className="mt-4">
              <span className="mb-2 block text-[13px] font-semibold text-ink-secondary">Формат</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {LAYOUT_FORMATS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFormat(f.id)}
                    aria-pressed={format === f.id}
                    className={cx(
                      'rounded-xl border px-3 py-2.5 text-left transition-colors',
                      format === f.id ? 'border-brand bg-surface-2' : 'border-line hover:border-brand/40',
                    )}
                  >
                    <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                      {f.id === 'screen_16_9' ? <FileText size={14} /> : <LayoutTemplate size={14} />}
                      {f.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-ink-tertiary">{f.mm}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCreating(false)} disabled={busy}>
                Отмена
              </Button>
              <Button onClick={() => void create()} loading={busy} icon={<Plus size={16} />}>
                Создать макет
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Удалить макет?"
        confirmLabel="Удалить"
        danger
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          const row = toDelete
          setToDelete(null)
          if (row) void remove(row)
        }}
      >
        Лист «{toDelete?.title}» будет удалён. Товары каталога, касса и меню гостя останутся как есть.
      </ConfirmDialog>

      <p className="mt-5 flex items-start gap-2 text-[12px] leading-4 text-ink-tertiary">
        <Calculator size={14} className="mt-0.5 flex-none" aria-hidden />
        Себестоимость и наценка считаются отдельно — раздел «Себестоимость». Здесь только вёрстка листа.
      </p>
    </>
  )
}
