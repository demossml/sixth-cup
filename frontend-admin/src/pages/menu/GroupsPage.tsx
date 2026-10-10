import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminFetch } from '../../api/client'
import { PageHeader } from '../../ui/PageHeader'
import { EmptyState } from '../../ui/EmptyState'

type Cat = { id: number; name: string; sortOrder?: number; productCount?: number }

export function GroupsPage() {
  const [items, setItems] = useState<Cat[]>([])
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')

  async function load() {
    try {
      const r = await adminFetch<{ categories?: Cat[] } | Cat[]>('/categories')
      setItems(Array.isArray(r) ? r : (r as any).categories ?? [])
    } catch (e: any) {
      setErr(e.message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function create() {
    if (!name.trim()) return
    try {
      await adminFetch('/categories', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })
      setName('')
      await load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  async function saveEdit() {
    if (editId == null || !editName.trim()) return
    try {
      await adminFetch(`/categories/${editId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editName.trim() }),
      })
      setEditId(null)
      await load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  async function remove(id: number) {
    if (!confirm('Удалить группу? Если есть товары — сервер откажет.')) return
    try {
      await adminFetch(`/categories/${id}`, { method: 'DELETE' })
      await load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Группы"
        subtitle="Категории меню"
        actions={
          <Link to="/menu/products" className="text-sm text-brand">
            ← Товары
          </Link>
        }
      />
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-xl border border-line px-3 py-2 text-sm"
          placeholder="Новая группа"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="button" onClick={create} className="rounded-xl bg-brand text-white px-4 py-2 text-sm">
          Добавить
        </button>
      </div>
      {err ? <p className="text-red-600 text-sm">{err}</p> : null}
      {!items.length ? (
        <EmptyState title="Нет групп" />
      ) : (
        <ul className="rounded-2xl border border-line bg-white divide-y divide-line">
          {items.map((c) => (
            <li key={c.id} className="p-3 flex flex-wrap items-center gap-2 text-sm">
              {editId === c.id ? (
                <>
                  <input className="flex-1 border rounded-lg px-2 py-1" value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <button type="button" className="text-brand" onClick={saveEdit}>
                    OK
                  </button>
                  <button type="button" onClick={() => setEditId(null)}>
                    ×
                  </button>
                </>
              ) : (
                <>
                  <span className="font-medium flex-1">{c.name}</span>
                  {c.productCount != null ? <span className="text-ink-tertiary">{c.productCount} тов.</span> : null}
                  <button
                    type="button"
                    className="text-brand"
                    onClick={() => {
                      setEditId(c.id)
                      setEditName(c.name)
                    }}
                  >
                    Изм.
                  </button>
                  <button type="button" className="text-red-600" onClick={() => remove(c.id)}>
                    Удал.
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
