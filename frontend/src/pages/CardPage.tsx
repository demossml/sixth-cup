import { useState } from 'react'
import Qr from '../components/Qr'
import ScanModal from '../components/ScanModal'
import { useApp } from '../lib/app'
import { addReceipt } from '../lib/customer'
import { activeVouchers, freeAvailable, progress } from '../lib/proof'
import { AppIcon, Gift, RefreshCw, ScanLine, Ticket, Wallet, Wifi, WifiOff } from '../lib/icons'

export default function CardPage() {
  const { dir, me, best, syncing, lastSync, sync, reload } = useApp()
  const [scan, setScan] = useState(false)
  const [msg, setMsg] = useState('')

  const N = dir?.cupsForFree ?? 5
  const online = Date.now() - lastSync < 5 * 60_000

  async function onScan(text: string) {
    setScan(false)
    const r = await addReceipt(text, dir, me)
    setMsg(r.ok ? 'Чек принят, карта обновлена' : r.reason)
    if (r.ok) await reload()
  }

  return (
    <div className="pb-4">
      <div className="bg-brand text-white px-4 pt-10 pb-5 rounded-b-3xl">
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="text-white/70 text-xs">Моя карта</p>
            <h1 className="text-xl font-bold">{me ? `№${me.id}` : '—'}</h1>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${online ? 'bg-white/20' : 'bg-black/20'}`}>
            {syncing ? <RefreshCw size={12} className="animate-spin" /> : online ? <Wifi size={12} /> : <WifiOff size={12} />}
            {syncing ? 'синк…' : online ? 'на связи' : 'офлайн'}
          </span>
        </div>
      </div>

      <div className="px-4 -mt-3">
        {dir?.promos[0] && (
          <div className="card flex gap-3 items-start border-0 shadow-soft">
            <div className="w-10 h-10 rounded-xl bg-brand-soft flex items-center justify-center shrink-0">
              <AppIcon name={dir.promos[0].icon || 'Sparkles'} size={20} className="text-brand" />
            </div>
            <div className="min-w-0">
              <b className="text-sm text-ink">{dir.promos[0].title}</b>
              <div className="text-ink-secondary text-xs mt-0.5 line-clamp-2">{dir.promos[0].body}</div>
            </div>
          </div>
        )}

        {!best ? (
          <div className="card mt-2">
            <b className="text-ink">Карта ещё не загружена</b>
            <p className="text-ink-secondary text-sm mt-1">Подключитесь к Wi-Fi один раз — карта сохранится и будет работать без интернета.</p>
            <button className="btn mt-3" onClick={() => sync()}>Загрузить карту</button>
          </div>
        ) : (
          <>
            <div className="card mt-2 bg-gradient-to-br from-brand to-brand-dark border-0 text-white shadow-soft overflow-hidden relative">
              <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full -mr-8 -mt-8" />
              <div className="text-white/70 text-xs mb-1 relative">Карта участника · №{me?.id}</div>
              <div className="flex gap-2 justify-center py-2 relative">
                {Array.from({ length: N }, (_, i) => (
                  <div
                    key={i}
                    className={`w-11 h-11 rounded-full flex items-center justify-center border-2 ${
                      i < progress(best.state, N) ? 'border-white bg-white/20 text-white' : 'border-dashed border-white/40 text-white/40'
                    }`}
                  >
                    {i < progress(best.state, N) ? <AppIcon name="Coffee" size={18} /> : null}
                  </div>
                ))}
                <div className={`w-11 h-11 rounded-full flex items-center justify-center border-2 ${
                  freeAvailable(best.state, N) > 0 ? 'border-accent-gold bg-amber-400/30 text-accent-gold' : 'border-dashed border-white/40 text-white/40'
                }`}>
                  <Gift size={18} />
                </div>
              </div>
              {freeAvailable(best.state, N) > 0 ? (
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-center text-sm font-semibold text-amber-800">
                  Следующий стакан бесплатно · доступно: {freeAvailable(best.state, N)}
                </div>
              ) : (
                <p className="text-white/70 text-center text-sm mt-1">
                  До бесплатного: {N - progress(best.state, N)}
                </p>
              )}
            </div>

            {best.state.cb > 0 && (
              <div className="card flex items-center gap-3 bg-emerald-50 border-emerald-100">
                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center">
                  <Wallet size={20} className="text-accent-green" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-ink">Кэшбэк {best.state.cb} ₽</div>
                  <div className="text-xs text-ink-secondary">Можно списать на кассе</div>
                </div>
              </div>
            )}

            <div className="card text-center">
              <p className="text-sm font-medium text-ink mb-1">Покажите код кассиру</p>
              <Qr value={best.token} />
            </div>

            <h2 className="text-sm font-semibold text-ink mt-3 mb-2 flex items-center gap-1.5">
              <Ticket size={16} className="text-brand" /> Мои купоны
            </h2>
            {activeVouchers(best.state).length === 0 && (
              <p className="text-ink-tertiary text-sm">Пока нет. Новые приходят при синхронизации.</p>
            )}
            {activeVouchers(best.state).map((v) => (
              <div key={v[0]} className="card flex justify-between items-center py-3">
                <b className="text-sm">{v[1] === 'p' ? `Скидка ${v[2]}%` : `Скидка ${v[2]} ₽`}</b>
                <span className="text-ink-tertiary text-xs">до {new Date(v[3] * 86_400_000).toLocaleDateString()}</span>
              </div>
            ))}

            <details className="mt-3">
              <summary className="text-ink-tertiary text-xs cursor-pointer">Технический код карты</summary>
              <textarea className="input mt-1 text-xs" readOnly value={best.token} rows={3} onFocus={(e) => e.target.select()} />
            </details>
          </>
        )}

        {msg && (
          <p className={`text-sm mt-3 ${msg.includes('принят') ? 'text-ok' : 'text-bad'}`}>{msg}</p>
        )}

        <div className="flex gap-2 mt-4">
          <button className="btn flex items-center justify-center gap-2" onClick={() => { setMsg(''); setScan(true) }}>
            <ScanLine size={18} /> Сканировать чек
          </button>
          <button className="btn-ghost !w-12 flex items-center justify-center px-0" onClick={() => sync()} aria-label="Синхронизировать">
            <RefreshCw size={18} className={syncing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {scan && <ScanModal title="Наведите камеру на QR кассира" onResult={onScan} onClose={() => setScan(false)} />}
    </div>
  )
}
