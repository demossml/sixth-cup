import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import type { Product, Scheme } from '../api/types'
import { Button, Check, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Spinner, Toggle, useToast } from '../ui/kit'
import type { Column } from '../ui/kit'
import { ADDON_GROUPS_FALLBACK, GROUP_KEY_NOTE, defaultMaxCount, draftToOptions, requiredGroups, schemeToDraft, type AddonGroup, type SchemeOptionDraft } from '../lib/addonScheme'

function useSave(reload: () => void) {
  const toast = useToast()
  return async (fn: () => Promise<unknown>, okText: string) => {
    try { await fn(); toast.push(okText); reload(); return true }
    catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad'); return false }
  }
}

function AddonSchemesInner({ products }: { products: Product[] }) {
  const toast = useToast()
  const { data, error, loading, reload } = useApi<{ schemes: Scheme[] }>('/modifier-schemes')
  const groupsApi = useApi<{ groups: AddonGroup[] }>('/addon-groups')
  const save = useSave(reload)
  const groups: AddonGroup[] = groupsApi.data?.groups?.length ? groupsApi.data.groups : ADDON_GROUPS_FALLBACK
  const labelOf = (key: string) => groups.find((g) => g.key === key)?.label ?? key
  const [edit, setEdit] = useState<{ id?: number; name: string; options: SchemeOptionDraft[] } | null>(null)
  const [preview, setPreview] = useState<{ scheme: { id: number; name: string }; items: any[]; products: any[] } | null>(null)
  const [del, setDel] = useState<Scheme | null>(null)
  const used = (id: number) => products.filter((p) => p.modifierSchemeId === id).length
  const addonProducts = products.filter((p) => !p.countsAsCup)
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  const cols: Column<Scheme>[] = [
    { key: 'name', header: 'Схема', primary: true, render: (s) => s.name },
    { key: 'm', header: 'Позиций', align: 'right', render: (s) => s.options?.length ?? s.items.length },
    {
      key: 'req', header: 'Обязательные', render: (s) => {
        const req = requiredGroups(s.options ?? s.items)
        return req.length
          ? <span className="inline-flex flex-wrap gap-1">{req.map((k) => <span key={k} className="rounded-full border border-line px-2 py-[1px] text-[11px]">{labelOf(k)}</span>)}</span>
          : <span className="text-ink/40">—</span>
      },
    },
    { key: 'p', header: 'Товаров', align: 'right', render: (s) => used(s.id) },
    { key: 'x', header: '', align: 'right', render: (s) => <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" variant="ghost" onClick={async () => {
        try { setPreview(await api(`/modifier-schemes/${s.id}/preview`)) } catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad') }
      }}>Просмотр</Button>
      <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`Удалить ${s.name}`} onClick={() => setDel(s)} />
    </span> },
  ]
  const openEdit = (s?: Scheme) => {
    if (!s) { setEdit({ name: '', options: [] }); return }
    setEdit({ id: s.id, name: s.name, options: schemeToDraft(s) })
  }
  const newZero = (): SchemeOptionDraft => ({ kind: 'zero', productId: null, modifierId: null, name: 'Без сиропа', groupKey: 'syrup', isDefault: true, required: false, maxCount: 1, priceOverride: null })
  const newProduct = (): SchemeOptionDraft => ({ kind: 'product', productId: null, modifierId: null, name: '', groupKey: 'extra', isDefault: false, required: false, maxCount: defaultMaxCount('extra'), priceOverride: null })
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2 items-center">
        <Button icon={<Plus size={16} />} onClick={() => openEdit()}>Новая схема</Button>
        <span className="text-[12px] text-ink/50">Платные позиции — товар из меню (категория «Добавки»); «Без сиропа» / «Обычное» — zero-option без UUID. {GROUP_KEY_NOTE}</span>
      </div>
      <DataTable rows={data?.schemes ?? []} columns={cols} rowKey={(s) => s.id} onRowClick={(s) => openEdit(s)} empty={<EmptyState title="Схем пока нет" />} />
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Схема добавок' : 'Новая схема'}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Отмена</Button><Button disabled={!edit?.name.trim()} onClick={async () => {
          if (!edit) return
          const options = draftToOptions(edit.options)
          if (await save(() => api('/modifier-schemes', { method: 'POST', body: { id: edit.id, name: edit.name.trim(), options } }), 'Схема сохранена')) setEdit(null)
        }}>Сохранить</Button></>}>
        <Field label="Название"><Input value={edit?.name ?? ''} maxLength={80} onChange={(e) => setEdit(edit ? { ...edit, name: e.target.value } : edit)} /></Field>
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-medium">Позиции схемы</div>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => setEdit(edit ? { ...edit, options: [...edit.options, newZero()] } : edit)}>+ Zero</Button>
              <Button size="sm" variant="secondary" onClick={() => setEdit(edit ? { ...edit, options: [...edit.options, newProduct()] } : edit)}>+ Товар</Button>
            </div>
          </div>
          <div className="text-[11px] text-ink/50">Лимит — число разных опций в группе (не количество одной добавки): молоко/сироп/сахар — 1, «Дополнительно» — 2.</div>
          {(edit?.options ?? []).map((it, idx) => {
            const patch = (p: Partial<SchemeOptionDraft>) => {
              const options = [...(edit?.options ?? [])]
              options[idx] = { ...options[idx], ...p }
              setEdit(edit ? { ...edit, options } : edit)
            }
            return (
              <div key={idx} className="rounded-lg border border-line p-2 space-y-1">
                <div className="flex gap-2 items-center">
                  <Select className="flex-1" value={it.groupKey} onChange={(e) => patch({ groupKey: e.target.value, maxCount: it.kind === 'zero' ? 1 : defaultMaxCount(e.target.value) })}>
                    {groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                  </Select>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => {
                    const options = (edit?.options ?? []).filter((_, i) => i !== idx); setEdit(edit ? { ...edit, options } : edit)
                  }} />
                </div>
                <Check checked={it.kind === 'zero'} label="Zero-option (без UUID, цена 0)" onChange={(v) => patch({
                  kind: v ? 'zero' : 'product',
                  productId: v ? null : it.productId,
                  modifierId: null,
                  name: v ? (it.name || 'Без добавки') : '',
                  maxCount: 1,
                })} />
                <Check checked={it.required} label="Обязательно: группа должна быть закрыта (любой выбранный вариант)" onChange={(v) => patch({ required: v })} />
                <Check checked={it.isDefault} label="По умолчанию в секции" onChange={(v) => patch({ isDefault: v })} />
                <Field label="Лимит разных опций в группе">
                  <Input type="number" min={1} value={it.maxCount} onChange={(e) => patch({ maxCount: Math.max(1, Number(e.target.value) || 1) })} />
                </Field>
                {it.kind === 'modifier' && (
                  <div className="text-[11px] text-ink/50">Legacy-добавка #{it.modifierId}: при выборе товара станет обычной позицией.</div>
                )}
                {it.kind === 'zero' ? (
                  <Field label="Подпись"><Input value={it.name} placeholder="Без сиропа / Обычное молоко" onChange={(e) => patch({ name: e.target.value })} /></Field>
                ) : (
                  <Field label="Товар (Добавки)"><Select value={it.productId ?? ''} onChange={(e) => patch({
                    kind: 'product',
                    productId: e.target.value ? Number(e.target.value) : null,
                    modifierId: null,
                  })}>
                    <option value="">— выберите —</option>
                    {addonProducts.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.price}₽</option>)}
                  </Select></Field>
                )}
              </div>
            )
          })}
        </div>
      </Drawer>
      <ConfirmDialog open={!!del} title="Удалить схему?" danger confirmLabel="Удалить" onCancel={() => setDel(null)}
        onConfirm={async () => { if (del) await save(() => api(`/modifier-schemes/${del.id}`, { method: 'DELETE' }), 'Схема удалена'); setDel(null) }}>
        Схема будет отвязана от товаров.
      </ConfirmDialog>
      {preview && (
        <Drawer open onClose={() => setPreview(null)} title={`Просмотр: ${preview.scheme.name}`}>
          <pre className="text-[11px] whitespace-pre-wrap">{JSON.stringify(preview, null, 2)}</pre>
        </Drawer>
      )}
    </>
  )
}

/** Отдельный раздел навигации: схемы добавок (сиропы, топпинги) — не молоко и не объёмы. */
export default function AddonSchemes() {
  const products = useApi<{ products: Product[] }>('/products')
  const list = products.data?.products ?? []
  return (
    <>
      <PageHeader
        title="Схемы добавок"
        subtitle="Сиропы, топпинги, посыпки. Выбор на кассе необязателен: гость может взять ноль добавок."
      />
      {products.loading && !products.data ? <Spinner /> : <AddonSchemesInner products={list} />}
    </>
  )
}
