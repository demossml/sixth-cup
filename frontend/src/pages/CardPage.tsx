import { useState } from 'react'
import Qr from '../components/Qr'
import ScanModal from '../components/ScanModal'
import { useApp } from '../lib/app'
import { addReceipt } from '../lib/customer'
import { activeVouchers, freeAvailable, progress } from '../lib/proof'

export default function CardPage() {
  const { dir, me, best, syncing, lastSync, sync, reload } = useApp()
  const [scan, setScan] = useState(false)
  const [msg, setMsg] = useState('')

  const N = dir?.cupsForFree ?? 5
  const online = Date.now() - lastSync < 5 * 60_000

  async function onScan(text: string) {
    setScan(false)
    const r = await addReceipt(text, dir, me)
    setMsg(r.ok ? '✅ Чек принят, карта обновлена' : r.reason)
    if (r.ok) await reload()
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold">Моя карта {me && `№${me.id}`}</h1>
        <span className={`text-xs px-2 py-1 rounded-lg ${online ? 'bg-brand-soft text-brand' : 'bg-red-50 text-bad'}`}>
          {syncing ? 'синхронизация…' : online ? 'на связи' : 'офлайн'}
        </span>
      </div>

      {dir?.promos[0] && (
        <div className="card bg-gradient-to-r from-brand-soft to-white">
          <b>{dir.promos[0].emoji} {dir.promos[0].title}</b>
          <div className="text-muted text-sm">{dir.promos[0].body}</div>
        </div>
      )}

      {!best ? (
        <div className="card">
          <b>Карта ещё не загружена</b>
          <p className="text-muted text-sm mt-1">Подключитесь к Wi-Fi один раз — карта сохранится и будет работать без интернета.</p>
          <button className="btn mt-3" onClick={() => sync()}>Загрузить карту</button>
        </div>
      ) : (
        <>
          <div className="flex gap-2 justify-center my-4">
            {Array.from({ length: N }, (_, i) => (
              <div key={i} className={`w-11 h-11 rounded-full flex items-center justify-center text-xl border-2 ${i < progress(best.state, N) ? 'border-brand bg-brand-soft' : 'border-dashed border-line'}`}>
                {i < progress(best.state, N) ? '☕' : ''}
              </div>
            ))}
            <div className={`w-11 h-11 rounded-full flex items-center justify-center text-xl border-2 border-[#e0a030] ${freeAvailable(best.state, N) > 0 ? 'bg-amber-100' : ''}`}>🎁</div>
          </div>

          {freeAvailable(best.state, N) > 0
            ? <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-center font-bold mb-3">Следующий стакан бесплатно! (доступно: {freeAvailable(best.state, N)})</div>
            : <p className="text-muted text-center text-sm mb-3">До бесплатного стакана: {N - progress(best.state, N)}</p>}

          {best.state.cb > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center mb-3">
              💰 Кэшбэк: <b>{best.state.cb} ₽</b>
              <div className="text-muted text-xs">Можно списать на кассе</div>
            </div>
          )}

          <Qr value={best.token} />
          <p className="text-muted text-center text-sm">Покажите этот код кассиру</p>

          <h2 className="text-base font-semibold mt-4 mb-2">Мои купоны</h2>
          {activeVouchers(best.state).length === 0 && <p className="text-muted text-sm">Пока нет. Новые приходят при синхронизации.</p>}
          {activeVouchers(best.state).map((v) => (
            <div key={v[0]} className="card flex justify-between items-center">
              <b>{v[1] === 'p' ? `Скидка ${v[2]}%` : `Скидка ${v[2]} ₽`}</b>
              <span className="text-muted text-xs">до {new Date(v[3] * 86_400_000).toLocaleDateString()}</span>
            </div>
          ))}

          <details className="mt-3">
            <summary className="text-muted text-sm cursor-pointer">Технический код карты</summary>
            <textarea className="input mt-1 text-xs" readOnly value={best.token} rows={3} onFocus={(e) => e.target.select()} />
          </details>
        </>
      )}

      {msg && <p className={`text-sm mt-2 ${msg.startsWith('✅') ? 'text-ok' : 'text-bad'}`}>{msg}</p>}
      <div className="flex gap-2 mt-3">
        <button className="btn" onClick={() => { setMsg(''); setScan(true) }}>📷 Сканировать чек</button>
        <button className="btn-ghost !w-auto px-4" onClick={() => sync()}>🔄</button>
      </div>
      {scan && <ScanModal title="Наведите камеру на QR кассира" onResult={onScan} onClose={() => setScan(false)} />}
    </div>
  )
}
