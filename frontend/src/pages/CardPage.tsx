import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Qr from '../components/Qr'
import ScanModal from '../components/ScanModal'
import { useApp } from '../lib/app'
import { submitScannedReceipt } from '../lib/customer'
import { activeVouchers, freeAvailable, progress } from '../lib/proof'
import { AppIcon, Gift, RefreshCw, ScanLine, Ticket, Users, Wallet, Wifi, WifiOff } from '../lib/icons'

/**
 * Главный экран карты.
 * Важно: QR кассиру — сразу после шапки/прогресса, не внизу длинной ленты.
 * Новое: прогресс стаканов сверху + кликабельный «Приведи друга».
 */
export default function CardPage() {
  const { dir, me, best, syncing, lastSync, sync, reload } = useApp()
  const nav = useNavigate()
  const [scan, setScan] = useState(false)
  const [msg, setMsg] = useState('')

  const N = dir?.cupsForFree ?? 5
  const online = Date.now() - lastSync < 5 * 60_000
  const paidProgress = best ? progress(best.state, N) : 0
  const freeLeft = best ? freeAvailable(best.state, N) : 0
  const left = Math.max(0, N - paidProgress)
  const pct = dir?.referralCashbackPercent ?? 3

  async function onScan(text: string) {
    setScan(false)
    setMsg('Отправляем чек на сервер…')
    const r = await submitScannedReceipt(text, dir, me)
    setMsg(r.ok ? r.message : r.reason)
    await reload()
  }

  async function onSync() {
    setMsg('')
    const status = await sync()
    if (status === 'auth') {
      const { ensureGuest } = await import('../lib/ensureGuest')
      const { setJwt } = await import('../api')
      setJwt(null)
      await ensureGuest()
      await sync()
      setMsg('Выдана новая карта (без телефона).')
    } else if (status === 'offline') {
      setMsg('Нет сети. Если карта уже была — QR ниже должен остаться.')
    }
  }

  return (
    <div className="pb-4">
      {/* Шапка + прогресс стаканов */}
      <div className="bg-brand text-white px-4 pt-10 pb-5 rounded-b-3xl">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-white/70 text-xs">Моя карта</p>
            <h1 className="text-xl font-bold">Карта лояльности</h1>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${online ? 'bg-white/20' : 'bg-black/20'}`}>
            {syncing ? <RefreshCw size={12} className="animate-spin" /> : online ? <Wifi size={12} /> : <WifiOff size={12} />}
            {syncing ? 'синк…' : online ? 'на связи' : 'офлайн'}
          </span>
        </div>

        <div className="bg-white/10 rounded-2xl px-3 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">Стаканы до подарка</span>
            <span className="text-sm font-bold tabular-nums">
              {best ? (freeLeft > 0 ? 'Подарок!' : `${paidProgress} из ${N}`) : `— / ${N}`}
            </span>
          </div>
          <div className="flex items-center justify-center gap-1.5">
            {Array.from({ length: N }, (_, i) => (
              <div
                key={i}
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border-2 ${
                  best && i < paidProgress
                    ? 'border-white bg-white/25 text-white'
                    : 'border-dashed border-white/35 text-white/35'
                }`}
              >
                {best && i < paidProgress ? <AppIcon name="Coffee" size={15} /> : null}
              </div>
            ))}
            <div
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border-2 ${
                freeLeft > 0
                  ? 'border-amber-300 bg-amber-400/40 text-amber-100'
                  : 'border-dashed border-white/35 text-white/35'
              }`}
            >
              <Gift size={15} />
            </div>
          </div>
          <p className="text-center text-white/80 text-xs mt-2">
            {!best
              ? 'После появления сети здесь будет прогресс'
              : freeLeft > 0
                ? `Бесплатных доступно: ${freeLeft}`
                : `Осталось ${left} до бесплатного`}
          </p>
        </div>
      </div>

      <div className="px-4 -mt-2 space-y-2">
        {/* Приведи друга — активный баннер */}
        <button
          type="button"
          onClick={() => nav('/invite')}
          className="card w-full flex gap-3 items-center border-0 shadow-soft text-left active:scale-[0.99] transition-transform"
        >
          <div className="w-11 h-11 rounded-xl bg-brand-soft flex items-center justify-center shrink-0">
            <Users size={22} className="text-brand" />
          </div>
          <div className="min-w-0 flex-1">
            <b className="text-sm text-ink">Приведи друга</b>
            <div className="text-ink-secondary text-xs mt-0.5">
              {pct}% с покупок друга · нажмите — QR для друга
            </div>
          </div>
          <span className="text-brand text-lg font-light shrink-0">›</span>
        </button>

        {!best ? (
          <div className="card">
            <b className="text-ink">Карта ещё подгружается</b>
            <p className="text-ink-secondary text-sm mt-1 leading-relaxed">
              Телефон и SMS не нужны. Нужен интернет один раз — карта и QR появятся автоматически.
            </p>
            <button type="button" className="btn mt-3" onClick={() => void onSync()} disabled={syncing}>
              {syncing ? 'Синхронизация…' : 'Обновить карту'}
            </button>
          </div>
        ) : (
          <>
            {/* QR кассиру — сразу, как в рабочей версии */}
            <div className="card text-center">
              <p className="text-sm font-medium text-ink mb-1">Покажите код кассиру</p>
              <Qr value={best.token} />
              {me?.cardCode && (
                <div className="mt-3 rounded-xl bg-surface px-3 py-2">
                  <div className="text-xs text-ink-tertiary">Номер карты — если QR не сканируется</div>
                  <div className="mt-0.5 text-3xl font-bold tracking-[0.2em] tabular-nums text-ink">
                    {me.cardCode.padStart(4, '0')}
                  </div>
                </div>
              )}
            </div>

            {freeLeft > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-center text-sm font-semibold text-amber-800">
                Следующий стакан бесплатно · доступно: {freeLeft}
              </div>
            )}

            {best.state.cb > 0 && (
              <div className="card flex items-center gap-3 bg-emerald-50 border-emerald-100">
                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center">
                  <Wallet size={20} className="text-accent-green" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-ink">Кэшбэк {Math.floor(best.state.cb / 100)} ₽</div>
                  <div className="text-xs text-ink-secondary">Можно списать на кассе</div>
                </div>
              </div>
            )}

            <h2 className="text-sm font-semibold text-ink mt-2 mb-1 flex items-center gap-1.5">
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


          </>
        )}

        {msg && (
          <p className={`text-sm ${msg.includes('принят') || msg.includes('должна') ? 'text-ok' : 'text-bad'}`}>
            {msg}
          </p>
        )}

        <div className="flex gap-2 mt-3">
          <button
            type="button"
            className="btn flex items-center justify-center gap-2"
            onClick={() => {
              setMsg('')
              setScan(true)
            }}
          >
            <ScanLine size={18} /> Сканировать чек
          </button>
          <button
            type="button"
            className="btn-ghost !w-12 flex items-center justify-center px-0"
            onClick={() => void onSync()}
            aria-label="Синхронизировать"
          >
            <RefreshCw size={18} className={syncing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {scan && (
        <ScanModal title="Сканировать чек лояльности" onResult={onScan} onClose={() => setScan(false)} />
      )}
    </div>
  )
}
