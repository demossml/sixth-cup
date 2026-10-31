import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import type { MilkScheme, Product } from '../api/types'
import { fmtNum } from '../lib/format'
import { milkDraftError, milkDraftFrom, type MilkDraft } from '../lib/milkScheme'
import { Button, Check, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Spinner, Toggle, useToast } from '../ui/kit'
import type { Column } from '../ui/kit'

function useSave(reload: () => void) {
  const toast = useToast()
  return async (fn: () => Promise<unknown>, okText: string) => {
    try { await fn(); toast.push(okText); reload(); return true }
    catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad'); return false }
  }
}

function MilkSchemesInner({ products }: { products: Product[] }) {
  const { data, error, loading, reload } = useApi<{ schemes: MilkScheme[] }>('/milk-schemes')
  const save = useSave(reload)
  const [edit, setEdit] = useState<MilkDraft | null>(null)
  const [del, setDel] = useState<MilkScheme | null>(null)
  const nameOf = (id: number | null) => (id == null ? undefined : products.find((p) => p.id === id)?.name)
  const draftMsg = edit ? milkDraftError(edit, nameOf) : null
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />

  const cols: Column<MilkScheme>[] = [
    { key: 'name', header: 'Схема', primary: true, render: (s) => s.name },
    { key: 'v', header: 'Вариантов', align: 'right', render: (s) => s.variants.length },
    { key: 'd', header: 'По умолчанию', render: (s) => s.variants.find((v) => v.isDefault)?.label ?? '—' },
    { key: 'n', header: 'Товаров', align: 'right', render: (s) => fmtNum(s.usedByProducts) },
    { key: 'a', header: 'Активна', render: (s) => <span onClick={(e) => e.stopPropagation()}><Toggle checked={s.active} label={`Схема молока: ${s.name}`} onChange={(v) => save(() => api('/milk-schemes', { method: 'POST', body: { id: s.id, name: s.name, active: v, variants: s.variants } }), 'Сохранено')} /></span> },
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

  const moveVariant = (i: number, dir: -1 | 1) => {
    if (!edit) return
    const j = i + dir
    if (j < 0 || j >= edit.variants.length) return
    const variants = [...edit.variants]
    ;[variants[i], variants[j]] = [variants[j], variants[i]]
    setEdit({ ...edit, variants: variants.map((v, idx) => ({ ...v, sortOrder: idx })) })
  }

  const patchVariant = (i: number, patch: Partial<MilkDraft['variants'][number]>) => {
    if (!edit) return
    const variants = edit.variants.map((v, idx) => (idx === i ? { ...v, ...patch } : v))
      // один вариант по умолчанию: снимаем флаг у остальных
      .map((v, idx) => (patch.isDefault && idx !== i ? { ...v, isDefault: false } : v))
    setEdit({ ...edit, variants })
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-secondary">
          Схема молока — отдельное назначение товара. «Обычное молоко» — бесплатный вариант по умолчанию, в чек не идёт;
          платное молоко привязывается к товару Эвотор и пробивается на кассе.
        </p>
        <Button icon={<Plus size={16} />} onClick={() => setEdit(milkDraftFrom())}>Новая схема молока</Button>
      </div>
      <DataTable rows={data?.schemes ?? []} columns={cols} rowKey={(s) => s.id} onRowClick={(s) => setEdit(milkDraftFrom(s))} empty={<EmptyState title="Схем молока пока нет" />} />
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Схема молока' : 'Новая схема молока'} wide
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Отмена</Button><Button disabled={Boolean(draftMsg)} onClick={async () => {
          if (!edit) return
          const body = {
            id: edit.id,
            name: edit.name.trim(),
            active: edit.active,
            variants: edit.variants.map((v, i) => ({ ...v, sortOrder: i })),
          }
          if (await save(() => api('/milk-schemes', { method: 'POST', body }), 'Схема молока сохранена')) setEdit(null)
        }}>Сохранить</Button></>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Название схемы"><Input value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Молоко для капучино" /></Field>
            <Check checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Активна (отдаётся кассе)" />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-medium">Варианты молока</div>
                <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setEdit({
                  ...edit,
                  variants: [...edit.variants, { productId: null, label: '', isDefault: false, isFree: false, sendToReceipt: true, sortOrder: edit.variants.length, active: true }],
                })}>Добавить вариант</Button>
              </div>
              {edit.variants.map((v, i) => (
                <div key={v.id ?? i} className="rounded-xl border border-line p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[12px] text-ink-secondary">#{i + 1}</span>
                    <Input value={v.label} maxLength={60} placeholder="Обычное молоко" onChange={(e) => patchVariant(i, { label: e.target.value })} className="flex-1" />
                    <Button size="sm" variant="ghost" icon={<ArrowUp size={14} />} aria-label={`Выше: ${v.label || i + 1}`} disabled={i === 0} onClick={() => moveVariant(i, -1)} />
                    <Button size="sm" variant="ghost" icon={<ArrowDown size={14} />} aria-label={`Ниже: ${v.label || i + 1}`} disabled={i === edit.variants.length - 1} onClick={() => moveVariant(i, 1)} />
                    <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`Удалить вариант ${v.label || i + 1}`}
                      onClick={() => setEdit({ ...edit, variants: edit.variants.filter((_, idx) => idx !== i) })} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <Check checked={v.isDefault} onChange={(b) => patchVariant(i, { isDefault: b })} label="По умолчанию" />
                    <Check checked={v.isFree} onChange={(b) => patchVariant(i, { isFree: b, sendToReceipt: b ? false : v.sendToReceipt })} label="Бесплатный (не в чек)" />
                    <Check checked={v.sendToReceipt && !v.isFree} onChange={(b) => patchVariant(i, { sendToReceipt: v.isFree ? false : b })} label="Передавать в чек" />
                    <Check checked={v.active} onChange={(b) => patchVariant(i, { active: b })} label="Активен" />
                  </div>
                  {v.sendToReceipt && !v.isFree && (
                    <Field label="Товар Эвотор" hint="UUID берётся по точке при выгрузке каталога">
                      <Select value={v.productId ?? ''} onChange={(e) => patchVariant(i, { productId: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">Выберите товар…</option>
                        {products.filter((p) => !(p as Product & { isGroup?: number }).isGroup).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                    </Field>
                  )}
                </div>
              ))}
            </div>
            {draftMsg && <p className="text-sm text-bad">{draftMsg}</p>}
          </div>
        )}
      </Drawer>
      <ConfirmDialog open={!!del} title="Удалить схему молока?" danger confirmLabel="Удалить" onCancel={() => setDel(null)}
        onConfirm={async () => { if (del) await save(() => api(`/milk-schemes/${del.id}`, { method: 'DELETE' }), 'Схема молока удалена'); setDel(null) }}>
        «{del?.name}» не назначена ни одному товару — удаление безопасно.
      </ConfirmDialog>
    </>
  )
}

/** Отдельный раздел навигации: схемы молока. Назначение схемы молока на кассе обязательно. */
export default function MilkSchemes() {
  const products = useApi<{ products: Product[] }>('/products')
  const list = products.data?.products ?? []
  return (
    <>
      <PageHeader
        title="Схемы молока"
        subtitle="Обычное молоко — бесплатно и без чека. Платное молоко пробивается отдельным товаром Эвотор."
      />
      {products.loading && !products.data ? <Spinner /> : <MilkSchemesInner products={list} />}
    </>
  )
}
