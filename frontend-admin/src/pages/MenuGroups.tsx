import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import type { Category, Modifier, Product, Scheme } from '../api/types'
import { fmtNum } from '../lib/format'
import { Button, Check, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorBox, Field, Input, Select, Spinner, Toggle, useToast } from '../ui/kit'
import type { Column } from '../ui/kit'
import { ADDON_GROUPS_FALLBACK, GROUP_KEY_NOTE, defaultMaxCount, draftToOptions, requiredGroups, schemeToDraft, type AddonGroup, type SchemeOptionDraft } from '../lib/addonScheme'


function useSave(reload: () => void) {
  const toast = useToast()
  return async (fn: () => Promise<unknown>, okText: string) => {
    try { await fn(); toast.push(okText); reload(); return true }
    catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad'); return false }
  }
}

/* ───────── groups ───────── */
function Groups({ products }: { products: Product[] }) {
  const { data, error, loading, reload } = useApi<{ categories: Category[] }>('/categories')
  const save = useSave(reload)
  const [edit, setEdit] = useState<Partial<Category> | null>(null)
  const [preview, setPreview] = useState<{ scheme: { id: number; name: string }; items: any[]; products: any[] } | null>(null)
  const [del, setDel] = useState<Category | null>(null)
  const used = (id: number) => products.filter((p) => p.categoryId === id).length
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  const cols: Column<Category>[] = [
    { key: 'name', header: 'Группа', primary: true, render: (c) => c.name },
    { key: 'n', header: 'Товаров', align: 'right', render: (c) => fmtNum(used(c.id)) },
    { key: 'av', header: 'Показывать', render: (c) => <span onClick={(e) => e.stopPropagation()}><Toggle checked={!!c.available} label={`Показывать: ${c.name}`} onChange={(v) => save(() => api(`/categories/${c.id}`, { method: 'PATCH', body: { available: v } }), 'Сохранено')} /></span> },
    { key: 'ord', header: 'Порядок', align: 'right', render: (c) => c.sortOrder },
    {
      key: 'x', header: '', align: 'right',
      render: (c) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} disabled={used(c.id) > 0} title={used(c.id) ? 'Сначала перенесите товары в другую группу' : 'Удалить группу'} aria-label={`Удалить ${c.name}`} onClick={() => setDel(c)} />
        </span>
      ),
    },
  ]
  return (
    <>
      <div className="mb-3"><Button icon={<Plus size={16} />} onClick={() => setEdit({ name: '', sortOrder: (data?.categories.length ?? 0) + 1, available: 1 })}>Новая группа</Button></div>
      <DataTable rows={data?.categories ?? []} columns={cols} rowKey={(c) => c.id} onRowClick={(c) => setEdit(c)} empty={<EmptyState title="Групп пока нет" />} />
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Группа' : 'Новая группа'}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Отмена</Button><Button disabled={!edit?.name?.trim()} onClick={async () => {
          if (!edit) return
          const body = { name: edit.name!.trim(), sortOrder: Number(edit.sortOrder) || 0, available: !!edit.available }
          if (await save(() => (edit.id ? api(`/categories/${edit.id}`, { method: 'PATCH', body }) : api('/categories', { method: 'POST', body })), 'Группа сохранена')) setEdit(null)
        }}>Сохранить</Button></>}>
        <Field label="Название"><Input value={edit?.name ?? ''} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <Field label="Порядок в списке"><Input type="number" value={edit?.sortOrder ?? 0} onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) })} /></Field>
        <Check checked={!!edit?.available} onChange={(v) => setEdit({ ...edit, available: v ? 1 : 0 })} label="Показывать в приложении" />
      </Drawer>
      <ConfirmDialog open={!!del} title="Удалить группу?" danger confirmLabel="Удалить" onCancel={() => setDel(null)}
        onConfirm={async () => { if (del) await save(() => api(`/categories/${del.id}`, { method: 'DELETE' }), 'Группа удалена'); setDel(null) }}>«{del?.name}» будет удалена. В ней нет товаров.</ConfirmDialog>
    </>
  )
}

/* ───────── modifiers ───────── */
function Modifiers({ schemes, products }: { schemes: Scheme[]; products: Product[] }) {
  const { data, error, loading, reload } = useApi<{ modifiers: Modifier[] }>('/modifiers')
  const save = useSave(reload)
  const [edit, setEdit] = useState<Partial<Modifier> | null>(null)
  const [preview, setPreview] = useState<{ scheme: { id: number; name: string }; items: any[]; products: any[] } | null>(null)
  const [del, setDel] = useState<Modifier | null>(null)
  const groupsApi = useApi<{ groups: AddonGroup[] }>('/addon-groups')
  const groups: AddonGroup[] = groupsApi.data?.groups?.length ? groupsApi.data.groups : ADDON_GROUPS_FALLBACK
  const labelOf = (key: string) => groups.find((g) => g.key === key)?.label ?? `${key} → extra`
  const inSchemes = (id: number) => schemes.filter((s) => (s.options ?? s.items).some((i) => i.modifierId === id)).length
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  const cols: Column<Modifier>[] = [
    { key: 'name', header: 'Добавка', primary: true, render: (m) => m.name },
    { key: 'g', header: 'Тип', render: (m) => labelOf(m.groupKey) },
    { key: 'p', header: 'Цена, ₽', align: 'right', render: (m) => fmtNum(m.price) },
    { key: 's', header: 'В схемах', align: 'right', render: (m) => inSchemes(m.id) },
    { key: 'av', header: 'Доступна', render: (m) => <span onClick={(e) => e.stopPropagation()}><Toggle checked={!!m.available} label={`Доступна: ${m.name}`} onChange={(v) => save(() => api('/modifiers', { method: 'POST', body: { id: m.id, name: m.name, price: m.price, groupKey: m.groupKey, available: v, sortOrder: m.sortOrder } }), 'Сохранено')} /></span> },
    { key: 'x', header: '', align: 'right', render: (m) => <span onClick={(e) => e.stopPropagation()}><Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`Удалить ${m.name}`} onClick={() => setDel(m)} /></span> },
  ]
  return (
    <>
      <div className="mb-3"><Button icon={<Plus size={16} />} onClick={() => setEdit({ name: '', price: 0, groupKey: 'extra', available: 1, sortOrder: 0 })}>Новая добавка</Button></div>
      <DataTable rows={data?.modifiers ?? []} columns={cols} rowKey={(m) => m.id} onRowClick={(m) => setEdit(m)} empty={<EmptyState title="Добавок пока нет" />} />
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Добавка' : 'Новая добавка'}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Отмена</Button><Button disabled={!edit?.name?.trim()} onClick={async () => {
          if (!edit) return
          if (await save(() => api('/modifiers', { method: 'POST', body: { id: edit.id, name: edit.name!.trim(), price: Math.max(0, Math.round(Number(edit.price) || 0)), groupKey: edit.groupKey ?? 'extra', available: !!edit.available, sortOrder: Number(edit.sortOrder) || 0, linkedProductId: edit.linkedProductId ?? null } }), 'Добавка сохранена')) setEdit(null)
        }}>Сохранить</Button></>}>
        <Field label="Название"><Input value={edit?.name ?? ''} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <Field label="Цена, ₽"><Input type="number" min={0} value={edit?.price ?? 0} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })} /></Field>
        <Field label="Тип"><Select value={edit?.groupKey ?? 'extra'} onChange={(e) => setEdit({ ...edit, groupKey: e.target.value })}>
          {!groups.some((g) => g.key === (edit?.groupKey ?? 'extra')) && <option value={edit?.groupKey ?? ''}>{labelOf(edit?.groupKey ?? '')}</option>}
          {groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </Select></Field>
        <Field label="Товар Эвотор (для uuid на кассе)">
          <Select value={edit?.linkedProductId ?? ''} onChange={(e) => setEdit({ ...edit, linkedProductId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— не привязан —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} (#{p.id})</option>)}
          </Select>
        </Field>
        <Field label="Порядок"><Input type="number" value={edit?.sortOrder ?? 0} onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) })} /></Field>
        <Check checked={!!edit?.available} onChange={(v) => setEdit({ ...edit, available: v ? 1 : 0 })} label="Доступна" />
      </Drawer>
      <ConfirmDialog open={!!del} title="Удалить добавку?" danger confirmLabel="Удалить" onCancel={() => setDel(null)}
        onConfirm={async () => { if (del) await save(() => api(`/modifiers/${del.id}`, { method: 'DELETE' }), 'Добавка удалена'); setDel(null) }}>
        «{del?.name}» {del && inSchemes(del.id) ? `входит в схем: ${inSchemes(del.id)} и пропадёт из них, ` : ''}товары, где она использовалась, обновятся на кассе.
      </ConfirmDialog>
    </>
  )
}

/* ───────── schemes ───────── */


type Section = 'groups' | 'modifiers'

/** Вкладки «Меню»: группы товаров и добавки. Схемы объёмов/молока/добавок — отдельные разделы. */
export default function MenuGroups({ section }: { section: Section | string }) {
  const products = useApi<{ products: Product[] }>('/products')
  const schemes = useApi<{ schemes: Scheme[] }>('/modifier-schemes')
  const list = products.data?.products ?? []

  if (section === 'modifiers') return <Modifiers schemes={schemes.data?.schemes ?? []} products={list} />
  return <Groups products={list} />
}
