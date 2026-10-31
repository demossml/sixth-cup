import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import type { VolumeScheme } from '../api/types'
import { fmtNum } from '../lib/format'
import { volumeDraftError, volumeDraftFrom, type VolumeDraft } from '../lib/volumeScheme'
import { Button, Check, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Spinner, Toggle, useToast } from '../ui/kit'
import type { Column } from '../ui/kit'

/**
 * Схема объёмов — шаблон набора объёмов (200 / 300 / 400 мл).
 * Цены живут в карточке товара: один шаблон годится для разных напитков.
 */
export default function VolumeSchemes() {
  const { data, error, loading, reload } = useApi<{ schemes: VolumeScheme[] }>('/volume-schemes')
  const toast = useToast()
  const [edit, setEdit] = useState<VolumeDraft | null>(null)
  const [del, setDel] = useState<VolumeScheme | null>(null)
  const [busy, setBusy] = useState(false)
  const draftMsg = edit ? volumeDraftError(edit) : null

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await fn(); toast.push(ok); reload() }
    catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad') }
    finally { setBusy(false) }
  }

  const move = (i: number, dir: -1 | 1) => {
    if (!edit) return
    const j = i + dir
    if (j < 0 || j >= edit.items.length) return
    const items = [...edit.items]
    ;[items[i], items[j]] = [items[j], items[i]]
    setEdit({ ...edit, items: items.map((it, idx) => ({ ...it, sortOrder: idx })) })
  }

  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  const schemes = data?.schemes ?? []

  const cols: Column<VolumeScheme>[] = [
    { key: 'name', header: 'Схема', primary: true, render: (s) => s.name },
    { key: 'items', header: 'Объёмы', render: (s) => s.items.map((i) => i.label).join(' · ') || '—' },
    { key: 'n', header: 'Товаров', align: 'right', render: (s) => fmtNum(s.usedByProducts) },
    {
      key: 'a', header: 'Активна',
      render: (s) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Toggle checked={s.active} label={`Схема объёмов: ${s.name}`}
            onChange={(v) => run(() => api('/volume-schemes', {
              method: 'POST',
              body: { id: s.id, name: s.name, active: v, items: s.items },
            }), 'Сохранено')} />
        </span>
      ),
    },
    {
      key: 'x', header: '', align: 'right',
      render: (s) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} disabled={s.usedByProducts > 0}
            title={s.usedByProducts ? 'Схема назначена товарам — сначала снимите назначение' : 'Удалить схему'}
            aria-label={`Удалить ${s.name}`} onClick={() => setDel(s)} />
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Схемы объёмов"
        subtitle="Шаблон набора объёмов. Назначается товару в карточке, цены каждого объёма задаются там же."
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-secondary">
          Например «Стандарт 200/300/400 мл». Первый объём в списке — предвыбранный на кассе.
        </p>
        <Button icon={<Plus size={16} />} onClick={() => setEdit(volumeDraftFrom())}>Новая схема объёмов</Button>
      </div>
      <DataTable rows={schemes} columns={cols} rowKey={(s) => s.id} onRowClick={(s) => setEdit(volumeDraftFrom(s))}
        empty={<EmptyState title="Схем объёмов пока нет" />} />

      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Схема объёмов' : 'Новая схема объёмов'} wide
        footer={<>
          <Button variant="secondary" onClick={() => setEdit(null)}>Отмена</Button>
          <Button disabled={Boolean(draftMsg)} loading={busy} onClick={async () => {
            if (!edit) return
            const body = {
              id: edit.id,
              name: edit.name.trim(),
              active: edit.active,
              items: edit.items.map((it, i) => ({ ...it, label: it.label.trim(), sortOrder: i })),
            }
            await run(() => api('/volume-schemes', { method: 'POST', body }), 'Схема объёмов сохранена')
            setEdit(null)
          }}>Сохранить</Button>
        </>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Название схемы"><Input value={edit.name} maxLength={80} placeholder="Стандарт 200/300/400 мл"
              onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Check checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Активна (отдаётся кассе)" />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-medium">Объёмы</div>
                <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setEdit({
                  ...edit,
                  items: [...edit.items, { label: '', sizeValue: null, sizeUnit: null, sortOrder: edit.items.length, active: true }],
                })}>Добавить объём</Button>
              </div>
              {edit.items.map((it, i) => (
                <div key={it.id ?? i} className="rounded-xl border border-line p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-ink-secondary">#{i + 1}</span>
                    <Input value={it.label} maxLength={24} placeholder="200 мл" className="flex-1"
                      onChange={(e) => setEdit({ ...edit, items: edit.items.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)) })} />
                    <Input type="number" inputMode="numeric" min={1} className="w-24" placeholder="200"
                      value={it.sizeValue ?? ''}
                      onChange={(e) => setEdit({ ...edit, items: edit.items.map((x, idx) => (idx === i ? { ...x, sizeValue: e.target.value === '' ? null : Number(e.target.value) } : x)) })} />
                    <Select className="w-24" value={it.sizeUnit ?? ''}
                      onChange={(e) => setEdit({ ...edit, items: edit.items.map((x, idx) => (idx === i ? { ...x, sizeUnit: e.target.value ? (e.target.value as 'ml' | 'g') : null } : x)) })}>
                      <option value="">—</option>
                      <option value="ml">мл</option>
                      <option value="g">г</option>
                    </Select>
                    <Button size="sm" variant="ghost" icon={<ArrowUp size={14} />} aria-label={`Выше: ${it.label || i + 1}`} disabled={i === 0} onClick={() => move(i, -1)} />
                    <Button size="sm" variant="ghost" icon={<ArrowDown size={14} />} aria-label={`Ниже: ${it.label || i + 1}`} disabled={i === edit.items.length - 1} onClick={() => move(i, 1)} />
                    <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`Удалить объём ${it.label || i + 1}`}
                      onClick={() => setEdit({ ...edit, items: edit.items.filter((_, idx) => idx !== i) })} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4">
                    <Check checked={it.active} onChange={(b) => setEdit({ ...edit, items: edit.items.map((x, idx) => (idx === i ? { ...x, active: b } : x)) })} label="Активен" />
                  </div>
                </div>
              ))}
            </div>
            {draftMsg && <p className="text-sm text-bad">{draftMsg}</p>}
            <p className="text-xs text-ink-secondary">
              Цены объёмов задаются в карточке товара: Меню → Товары → карточка → «Схема объёмов».
            </p>
          </div>
        )}
      </Drawer>

      <ConfirmDialog open={!!del} title="Удалить схему объёмов?" danger confirmLabel="Удалить" onCancel={() => setDel(null)}
        onConfirm={async () => { if (del) await run(() => api(`/volume-schemes/${del.id}`, { method: 'DELETE' }), 'Схема объёмов удалена'); setDel(null) }}>
        «{del?.name}» не назначена ни одному товару — удаление безопасно.
      </ConfirmDialog>
    </>
  )
}
