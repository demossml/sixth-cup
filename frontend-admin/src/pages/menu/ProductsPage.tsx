import { useEffect, useMemo, useState } from 'react'
import { adminFetch } from '../../api/client'
import { formatMoneyRub } from '../../lib/format'
import { PageHeader } from '../../ui/PageHeader'
import { EmptyState } from '../../ui/EmptyState'

type Product = {
  id: number
  name: string
  price: number
  available: number
  countsAsCup: number
  categoryId?: number
  updatedAt?: number
  updated_at?: number
}

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  function load() {
    adminFetch<{ products: Product[] }>('/products')
      .then((r) => setProducts(r.products as any))
      .catch((e) => setErr(e.message))
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return products
    return products.filter((p) => p.name.toLowerCase().includes(s) || String(p.id) === s)
  }, [products, q])

  async function patchOne(id: number, patch: Record<string, unknown>) {
    setMsg('')
    try {
      await adminFetch(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      setMsg('Сохранено')
      load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  async function bulk(patch: Record<string, unknown>) {
    const ids = [...selected]
    if (!ids.length) return
    try {
      await adminFetch('/products/bulk', { method: 'POST', body: JSON.stringify({ ids, patch }) })
      setSelected(new Set())
      setMsg(`Обновлено: ${ids.length}`)
      load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Товары" subtitle="PATCH и массовые действия; sync только на точки с sync_enabled" />
      <div className="flex flex-wrap gap-2">
        <input
          className="rounded-xl border border-line px-3 py-2 text-sm flex-1 min-w-[140px]"
          placeholder="Поиск"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="rounded-xl border border-line px-3 py-2 text-sm bg-white" onClick={() => bulk({ available: false })}>
          Скрыть выбранные
        </button>
        <button type="button" className="rounded-xl border border-line px-3 py-2 text-sm bg-white" onClick={() => bulk({ countsAsCup: true })}>
          Стакан = да
        </button>
      </div>
      {err ? <p className="text-red-600 text-sm">{err}</p> : null}
      {msg ? <p className="text-emerald-700 text-sm">{msg}</p> : null}
      {!filtered.length ? (
        <EmptyState title="Нет товаров" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line">
                <th className="p-3 w-8" />
                <th>Название</th>
                <th className="text-right">Цена</th>
                <th className="text-center">В продаже</th>
                <th className="text-center pr-3">Стакан</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-line/50">
                  <td className="p-3">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  </td>
                  <td className="font-medium">{p.name}</td>
                  <td className="text-right">
                    <input
                      type="number"
                      step="0.01"
                      className="w-24 rounded-lg border border-line px-2 py-1 text-right tabular-nums"
                      defaultValue={p.price}
                      onBlur={(e) => {
                        const v = Number(e.target.value)
                        if (!Number.isNaN(v) && v !== p.price) patchOne(p.id, { price: v })
                      }}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={!!p.available}
                      onChange={(e) => patchOne(p.id, { available: e.target.checked })}
                    />
                  </td>
                  <td className="text-center pr-3">
                    <input
                      type="checkbox"
                      checked={!!p.countsAsCup}
                      onChange={(e) => patchOne(p.id, { countsAsCup: e.target.checked })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-tertiary">Группы и добавки — во вкладке Legacy или следующие итерации меню.</p>
    </div>
  )
}
