import { useEffect, useState } from 'react'
import { adminFetch } from '../../api/client'
import { PageHeader } from '../../ui/PageHeader'
import { EmptyState } from '../../ui/EmptyState'

type Promo = { id: number; title: string; body?: string; icon?: string; sponsor?: string; starts_at?: number; ends_at?: number }

export function MarketingPage() {
  const [promos, setPromos] = useState<Promo[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [err, setErr] = useState('')
  const [voucherCode, setVoucherCode] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [msg, setMsg] = useState('')

  async function load() {
    try {
      const r = await adminFetch<{ promos?: Promo[] } | Promo[]>('/promos')
      setPromos(Array.isArray(r) ? r : (r as any).promos ?? [])
    } catch (e: any) {
      setErr(e.message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function createPromo() {
    if (!title.trim()) return
    try {
      await adminFetch('/promos', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), body: body.trim() || null }),
      })
      setTitle('')
      setBody('')
      await load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  async function delPromo(id: number) {
    if (!confirm('Удалить акцию?')) return
    try {
      await adminFetch(`/promos/${id}`, { method: 'DELETE' })
      await load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  async function grantOne() {
    setMsg('')
    try {
      await adminFetch(`/customers/${Number(customerId)}/vouchers`, {
        method: 'POST',
        body: JSON.stringify({ code: voucherCode.trim() }),
      })
      setMsg('Ваучер выдан')
    } catch (e: any) {
      setErr(e.message)
    }
  }

  async function grantAll() {
    if (!confirm('Выдать шаблон всем клиентам?')) return
    try {
      await adminFetch('/vouchers/grant-all', {
        method: 'POST',
        body: JSON.stringify({ code: voucherCode.trim() }),
      })
      setMsg('Массовая выдача запущена')
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Маркетинг" subtitle="Акции PWA и ваучеры" />
      {err ? <p className="text-red-600 text-sm">{err}</p> : null}
      {msg ? <p className="text-emerald-700 text-sm">{msg}</p> : null}

      <section className="space-y-2">
        <h2 className="font-semibold">Акции</h2>
        <input className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Заголовок" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Текст" value={body} onChange={(e) => setBody(e.target.value)} />
        <button type="button" onClick={createPromo} className="rounded-xl bg-brand text-white px-4 py-2 text-sm">
          Создать акцию
        </button>
        {!promos.length ? (
          <EmptyState title="Нет акций" />
        ) : (
          <ul className="rounded-2xl border bg-white divide-y text-sm">
            {promos.map((p) => (
              <li key={p.id} className="p-3 flex justify-between gap-2">
                <div>
                  <div className="font-medium">{p.title}</div>
                  <div className="text-ink-secondary">{p.body}</div>
                </div>
                <button type="button" className="text-red-600 shrink-0" onClick={() => delPromo(p.id)}>
                  Удал.
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Ваучеры</h2>
        <input className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Код шаблона" value={voucherCode} onChange={(e) => setVoucherCode(e.target.value)} />
        <div className="flex gap-2">
          <input className="rounded-xl border px-3 py-2 text-sm w-28" placeholder="user id" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
          <button type="button" onClick={grantOne} className="rounded-xl border px-3 py-2 text-sm bg-white">
            Выдать одному
          </button>
          <button type="button" onClick={grantAll} className="rounded-xl border px-3 py-2 text-sm bg-white">
            Всем
          </button>
        </div>
      </section>
    </div>
  )
}
