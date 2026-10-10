import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminFetch } from '../../api/client'
import { formatMoneyRub } from '../../lib/format'
import { PageHeader } from '../../ui/PageHeader'
import { EmptyState } from '../../ui/EmptyState'

type Mod = { id: number; name: string; price: number; groupKey?: string }
type Scheme = { id: number; name: string }

export function ModifiersPage() {
  const [mods, setMods] = useState<Mod[]>([])
  const [schemes, setSchemes] = useState<Scheme[]>([])
  const [name, setName] = useState('')
  const [price, setPrice] = useState(0)
  const [schemeName, setSchemeName] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    try {
      const [m, s] = await Promise.all([
        adminFetch<{ modifiers?: Mod[] } | Mod[]>('/modifiers'),
        adminFetch<{ schemes?: Scheme[] } | Scheme[]>('/modifier-schemes'),
      ])
      setMods(Array.isArray(m) ? m : (m as any).modifiers ?? [])
      setSchemes(Array.isArray(s) ? s : (s as any).schemes ?? (s as any).items ?? [])
    } catch (e: any) {
      setErr(e.message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function addMod() {
    if (!name.trim()) return
    try {
      await adminFetch('/modifiers', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), price: Number(price) || 0 }),
      })
      setName('')
      setPrice(0)
      await load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  async function addScheme() {
    if (!schemeName.trim()) return
    try {
      await adminFetch('/modifier-schemes', {
        method: 'POST',
        body: JSON.stringify({ name: schemeName.trim() }),
      })
      setSchemeName('')
      await load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  async function delMod(id: number) {
    if (!confirm('Удалить добавку?')) return
    try {
      await adminFetch(`/modifiers/${id}`, { method: 'DELETE' })
      await load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  async function delScheme(id: number) {
    if (!confirm('Удалить схему?')) return
    try {
      await adminFetch(`/modifier-schemes/${id}`, { method: 'DELETE' })
      await load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Добавки и схемы"
        actions={
          <Link to="/menu/products" className="text-sm text-brand">
            ← Товары
          </Link>
        }
      />
      {err ? <p className="text-red-600 text-sm">{err}</p> : null}

      <section className="space-y-2">
        <h2 className="font-semibold">Добавки (топпинги)</h2>
        <div className="flex flex-wrap gap-2">
          <input className="rounded-xl border px-3 py-2 text-sm flex-1" placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="number" className="rounded-xl border px-3 py-2 text-sm w-28" placeholder="₽" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
          <button type="button" onClick={addMod} className="rounded-xl bg-brand text-white px-4 py-2 text-sm">
            +
          </button>
        </div>
        {!mods.length ? (
          <EmptyState title="Нет добавок" />
        ) : (
          <ul className="rounded-2xl border bg-white divide-y text-sm">
            {mods.map((m) => (
              <li key={m.id} className="p-3 flex justify-between gap-2">
                <span>
                  {m.name} · {formatMoneyRub(m.price)}
                </span>
                <button type="button" className="text-red-600" onClick={() => delMod(m.id)}>
                  Удал.
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Схемы (наборы для товара)</h2>
        <div className="flex gap-2">
          <input className="rounded-xl border px-3 py-2 text-sm flex-1" placeholder="Имя схемы" value={schemeName} onChange={(e) => setSchemeName(e.target.value)} />
          <button type="button" onClick={addScheme} className="rounded-xl bg-brand text-white px-4 py-2 text-sm">
            +
          </button>
        </div>
        {!schemes.length ? (
          <EmptyState title="Нет схем" description="Состав схемы — в Legacy при необходимости" />
        ) : (
          <ul className="rounded-2xl border bg-white divide-y text-sm">
            {schemes.map((s) => (
              <li key={s.id} className="p-3 flex justify-between gap-2">
                <span>{s.name}</span>
                <button type="button" className="text-red-600" onClick={() => delScheme(s.id)}>
                  Удал.
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
