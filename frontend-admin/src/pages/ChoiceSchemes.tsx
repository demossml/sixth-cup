import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import type { ChoiceScheme, Product } from '../api/types'
import { fmtNum } from '../lib/format'
import { choiceDraftError, choiceDraftFrom, CHOICE_LABEL_MAX, type ChoiceDraft } from '../lib/choiceScheme'
import { Button, Check, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorBox, Field, Input, PageHeader, Spinner, Toggle, useToast } from '../ui/kit'
import type { Column } from '../ui/kit'

function useSave(reload: () => void) {
  const toast = useToast()
  return async (fn: () => Promise<unknown>, okText: string) => {
    try { await fn(); toast.push(okText); reload(); return true }
    catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad'); return false }
  }
}

type ApplyPreview = { changed: number; items: { productId: number; name: string; current: number | null }[] }

function ChoiceSchemesInner({ products }: { products: Product[] }) {
  const { data, error, loading, reload } = useApi<{ schemes: ChoiceScheme[] }>('/choice-schemes')
  const save = useSave(reload)
  const toast = useToast()
  const [edit, setEdit] = useState<ChoiceDraft | null>(null)
  const [del, setDel] = useState<ChoiceScheme | null>(null)
  const [assign, setAssign] = useState<ChoiceScheme | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [preview, setPreview] = useState<ApplyPreview | null>(null)
  const draftMsg = edit ? choiceDraftError(edit) : null
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />

  const isGroup = (p: Product) => Boolean((p as Product & { isGroup?: number }).isGroup)
  const bodyFor = (schemeId: number | null, dryRun: boolean) => {
    const ids = [...picked]
    return {
      schemeId,
      groupIds: products.filter((p) => ids.includes(p.id) && isGroup(p)).map((p) => p.id),
      productIds: products.filter((p) => ids.includes(p.id) && !isGroup(p)).map((p) => p.id),
      dryRun,
    }
  }
  const runApply = async (schemeId: number | null, dryRun: boolean) => {
    try {
      const r = await api<ApplyPreview>('/choice-schemes/apply', { method: 'POST', body: bodyFor(schemeId, dryRun) })
      if (dryRun) setPreview(r)
      else {
        toast.push(schemeId == null ? `Снято у ${r.changed} товар(ов)` : `Назначено ${r.changed} товар(ам)`)
        setPreview(null); setAssign(null); setPicked(new Set()); reload()
      }
    } catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad') }
  }

  const cols: Column<ChoiceScheme>[] = [
    { key: 'name', header: 'Схема', primary: true, render: (s) => s.name },
    { key: 't', header: 'Заголовок на кассе', render: (s) => s.title },
    { key: 'o', header: 'Варианты', render: (s) => s.options.filter((o) => o.active).map((o) => o.label).join(' / ') },
    { key: 'n', header: 'Товаров', align: 'right', render: (s) => fmtNum(s.usedByProducts) },
    { key: 'a', header: 'Активна', render: (s) => <span onClick={(e) => e.stopPropagation()}><Toggle checked={s.active} label={`Схема выбора: ${s.name}`} onChange={(v) => save(() => api('/choice-schemes', { method: 'POST', body: { id: s.id, name: s.name, title: s.title, active: v, options: s.options } }), 'Сохранено')} /></span> },
    {
      key: 'x', header: '', align: 'right',
      render: (s) => (
        <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="secondary" onClick={() => { setAssign(s); setPicked(new Set()); setPreview(null) }}>Назначить напиткам…</Button>
          <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} disabled={s.usedByProducts > 0}
            title={s.usedByProducts ? 'Схема назначена товарам — сначала снимите назначение' : 'Удалить схему'}
            aria-label={`Удалить ${s.name}`} onClick={() => setDel(s)} />
        </span>
      ),
    },
  ]

  const patchOption = (i: number, patch: Partial<ChoiceDraft['options'][number]>) => {
    if (!edit) return
    const options = edit.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o))
      .map((o, idx) => (patch.isDefault && idx !== i ? { ...o, isDefault: false } : o))
    setEdit({ ...edit, options })
  }
  const moveOption = (i: number, dir: -1 | 1) => {
    if (!edit) return
    const j = i + dir
    if (j < 0 || j >= edit.options.length) return
    const options = [...edit.options]
    ;[options[i], options[j]] = [options[j], options[i]]
    setEdit({ ...edit, options: options.map((o, idx) => ({ ...o, sortOrder: idx })) })
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-secondary">
          Обязательный выбор без цены (например, «с корицей / без корицы»). Гость обязан выбрать, сумма не меняется,
          выбор печатается на чеке отдельной строкой для бариста. Напиткам без схемы блок не показывается.
        </p>
        <Button icon={<Plus size={16} />} onClick={() => setEdit(choiceDraftFrom())}>Новая схема выбора</Button>
      </div>
      <DataTable rows={data?.schemes ?? []} columns={cols} rowKey={(s) => s.id} onRowClick={(s) => setEdit(choiceDraftFrom(s))} empty={<EmptyState title="Схем выбора пока нет" />} />

      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Схема выбора' : 'Новая схема выбора'} wide
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Отмена</Button><Button disabled={Boolean(draftMsg)} onClick={async () => {
          if (!edit) return
          const body = {
            id: edit.id, name: edit.name.trim(), title: edit.title.trim(), active: edit.active,
            options: edit.options.map((o, i) => ({ ...o, label: o.label.trim(), sortOrder: i })),
          }
          if (await save(() => api('/choice-schemes', { method: 'POST', body }), 'Схема выбора сохранена')) setEdit(null)
        }}>Сохранить</Button></>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Название схемы"><Input value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Корица" /></Field>
            <Field label="Заголовок на кассе" hint={`Как называется блок в карточке напитка и на чеке, до ${CHOICE_LABEL_MAX} символов`}>
              <Input value={edit.title} maxLength={CHOICE_LABEL_MAX} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Корица" />
            </Field>
            <Check checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Активна (отдаётся кассе)" />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-medium">Варианты</div>
                <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setEdit({
                  ...edit, options: [...edit.options, { label: '', isDefault: false, sortOrder: edit.options.length, active: true }],
                })}>Добавить вариант</Button>
              </div>
              {edit.options.map((o, i) => (
                <div key={o.id ?? i} className="rounded-xl border border-line p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[12px] text-ink-secondary">#{i + 1}</span>
                    <Input value={o.label} maxLength={CHOICE_LABEL_MAX} placeholder="С корицей" onChange={(e) => patchOption(i, { label: e.target.value })} className="flex-1" />
                    <Button size="sm" variant="ghost" icon={<ArrowUp size={14} />} aria-label={`Выше: ${o.label || i + 1}`} disabled={i === 0} onClick={() => moveOption(i, -1)} />
                    <Button size="sm" variant="ghost" icon={<ArrowDown size={14} />} aria-label={`Ниже: ${o.label || i + 1}`} disabled={i === edit.options.length - 1} onClick={() => moveOption(i, 1)} />
                    <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`Удалить вариант ${o.label || i + 1}`}
                      onClick={() => setEdit({ ...edit, options: edit.options.filter((_, idx) => idx !== i) })} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <Check checked={o.isDefault} onChange={(b) => patchOption(i, { isDefault: b })} label="Предвыбран" />
                    <Check checked={o.active} onChange={(b) => patchOption(i, { active: b })} label="Активен" />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[13px] leading-[18px] text-ink-secondary">
              Если предвыбранного варианта нет, кассир обязан выбрать сам. Цена всегда 0 ₽ — в фискальный чек вариант не пробивается.
            </p>
            {draftMsg && <p className="text-sm text-bad">{draftMsg}</p>}
          </div>
        )}
      </Drawer>

      <Drawer open={!!assign} onClose={() => setAssign(null)} title={assign ? `Назначить «${assign.name}»` : ''} wide
        footer={<>
          <Button variant="secondary" disabled={!picked.size} onClick={() => runApply(null, false)}>Снять схему у выбранных</Button>
          <Button variant="secondary" disabled={!picked.size} onClick={() => runApply(assign!.id, true)}>Проверить</Button>
          <Button disabled={!picked.size} onClick={() => runApply(assign!.id, false)}>Назначить</Button>
        </>}>
        <div className="space-y-1">
          <p className="mb-2 text-[13px] text-ink-secondary">Группа назначает схему всем своим размерам. Отметьте напитки:</p>
          {products.map((p) => (
            <Check key={p.id} checked={picked.has(p.id)} label={`${p.name}${isGroup(p) ? ' (все размеры)' : ''}`}
              onChange={(b) => { const n = new Set(picked); if (b) n.add(p.id); else n.delete(p.id); setPicked(n); setPreview(null) }} />
          ))}
          {preview && (
            <div className="mt-3 rounded-xl border border-line p-3 text-[13px]">
              Будет изменено товаров: <b>{preview.changed}</b>
              <ul className="mt-1 list-disc pl-5">{preview.items.slice(0, 30).map((i) => <li key={i.productId}>{i.name}</li>)}</ul>
            </div>
          )}
        </div>
      </Drawer>

      <ConfirmDialog open={!!del} title="Удалить схему выбора?" danger confirmLabel="Удалить" onCancel={() => setDel(null)}
        onConfirm={async () => { if (del) await save(() => api(`/choice-schemes/${del.id}`, { method: 'DELETE' }), 'Схема выбора удалена'); setDel(null) }}>
        «{del?.name}» не назначена ни одному товару — удаление безопасно.
      </ConfirmDialog>
    </>
  )
}

/** Раздел «Обязательный выбор»: варианты без цены, видимые бариста на чеке. */
export default function ChoiceSchemes() {
  const products = useApi<{ products: Product[] }>('/products')
  return (
    <>
      <PageHeader title="Обязательный выбор" subtitle="Например, «с корицей / без корицы»: без цены, печатается на чеке для бариста." />
      {products.loading && !products.data ? <Spinner /> : <ChoiceSchemesInner products={products.data?.products ?? []} />}
    </>
  )
}
