import { Link } from 'react-router-dom'
import { useApp } from '../lib/app'
import { ArrowLeft, Store } from '../lib/icons'

/** Кофейни: из directory (кэшируется, работает офлайн). */
export default function StoresPage() {
  const { dir } = useApp()
  const stores = dir?.stores ?? []
  return (
    <div className="pb-6">
      <header className="bg-white px-4 pb-4 border-b border-line" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <Link to="/more" className="inline-flex items-center gap-1 min-h-11 text-brand text-sm no-underline"><ArrowLeft size={18} /> Ещё</Link>
        <h1 className="text-2xl font-bold text-ink">Кофейни</h1>
      </header>
      <div className="p-4 space-y-2">
        {stores.length === 0 && (
          <div className="card text-center py-8">
            <b>Список кофеен появится после первого обновления</b>
            <p className="text-ink-secondary text-sm mt-2">Откройте «Карту» при подключении к сети.</p>
          </div>
        )}
        {stores.map((s) => (
          <article key={s.id} className="card !mb-0 flex items-start gap-3">
            <span className="w-11 h-11 rounded-xl bg-brand-soft text-brand flex items-center justify-center shrink-0"><Store size={21} /></span>
            <span className="min-w-0">
              <b className="block text-ink text-base">{s.name}</b>
              {s.address && <span className="block text-ink-secondary text-sm mt-0.5">{s.address}</span>}
            </span>
          </article>
        ))}
      </div>
    </div>
  )
}
