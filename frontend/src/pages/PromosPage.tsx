import { useApp } from '../lib/app'

export default function PromosPage() {
  const { dir } = useApp()
  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-3">Акции</h1>
      {!dir && <p className="text-muted text-sm">Акции загрузятся при первом подключении.</p>}
      {dir?.promos.map((p) => (
        <div key={p.id} className="card">
          <div className="flex justify-between items-start">
            <b>{p.emoji} {p.title}</b>
            {p.sponsor && <span className="bg-brand-soft text-brand text-xs px-1.5 py-0.5 rounded">реклама</span>}
          </div>
          <div className="text-muted text-sm mt-1">{p.body}</div>
          {p.sponsor && <div className="text-muted text-xs mt-1">Партнёр: {p.sponsor}</div>}
          <div className="text-muted text-xs mt-1">до {new Date(p.endsAt * 1000).toLocaleDateString()}</div>
        </div>
      ))}
    </div>
  )
}
