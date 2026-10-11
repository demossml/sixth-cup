import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Qr from '../components/Qr'
import { useApp } from '../lib/app'
import { activeVouchers } from '../lib/proof'
import { formatRub } from '../lib/money'
import { Coffee, Gift, RefreshCw, Ticket, Users, Wallet, Wifi, WifiOff } from '../lib/icons'

/**
 * Главный экран: QR кассиру виден сразу (0 лишних тапов).
 * Прогресс и кэшбэк — компактно; fullscreen QR — опциональное увеличение.
 */
export default function CardPage() {
  const { dir, me, best, syncing, lastSync, sync } = useApp()
  const nav = useNavigate()
  const [msg, setMsg] = useState('')
  const saved = (() => { try { return localStorage.getItem('sc-saved') === '1' } catch { return false } })()

  const N = me?.cupsForFree ?? dir?.cupsForFree ?? 5
  const hasNetwork = typeof navigator === 'undefined' ? true : navigator.onLine
  const stale = !!lastSync && Date.now() - lastSync >= 5 * 60_000
  const paidProgress = Math.min(N, Math.max(0, me?.cupsTowardFree ?? 0))
  const freeLeft = me?.freeAvailable ?? 0
  const left = Math.max(0, N - paidProgress)
  const pct = dir?.referralCashbackPercent ?? 3
  const cashbackText = formatRub(me?.cashbackBalance)
  const fromFriendsKop = me?.fromFriendsKopecks ?? (me?.fromFriendsRub ?? 0) * 100
  const vouchers = activeVouchers({ v: me?.vouchers ?? [] } as never)
  const proof = best?.token
  const cardCode = me?.cardCode ?? ''

  // Best-effort: не гасить экран, пока на главной с QR (очередь у кассы).
  useEffect(() => {
    if (!proof) return
    let lock: { release: () => Promise<void> } | null = null
    let active = true
    const wake = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    void wake.wakeLock?.request('screen').then((l) => {
      if (active) lock = l
      else void l.release()
    }).catch(() => {})
    return () => {
      active = false
      if (lock) void lock.release().catch(() => {})
    }
  }, [proof])

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
      setMsg('Нет сети. Если карта уже была — QR остаётся на экране.')
    }
  }

  const syncLabel = syncing
    ? 'синк…'
    : !hasNetwork
      ? 'нет сети'
      : stale
        ? 'давно не обновлялась'
        : lastSync
          ? `обновлено ${new Date(lastSync).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
          : 'на связи'

  return (
    <div className="pb-6">
      {/* Компактная шапка */}
      <div className="bg-brand text-white px-4 pt-9 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-white/75 text-[11px] leading-none mb-0.5">6.7 Coffee</p>
            <h1 className="text-lg font-bold leading-tight">Карта лояльности</h1>
          </div>
          <button
            type="button"
            onClick={() => void onSync()}
            className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-full min-h-[36px] ${hasNetwork ? 'bg-white/20' : 'bg-black/25'}`}
            aria-label="Обновить данные"
          >
            {hasNetwork ? <Wifi size={12} /> : <WifiOff size={12} />}
            {syncing ? <RefreshCw size={12} className="animate-spin" /> : null}
            {syncLabel}
          </button>
        </div>

        {/* Кружки-штампы: сколько куплено и сколько ещё до подарка */}
        <div className="mt-4" aria-label={`Прогресс ${paidProgress} из ${N}`}>
          <div className="flex items-end justify-between gap-1">
            {Array.from({ length: N }, (_, i) => {
              const filled = i < paidProgress
              return (
                <div key={i} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      filled ? 'bg-white text-brand' : 'bg-white/15 text-white/45 border border-white/30'
                    }`}
                  >
                    <Coffee size={20} strokeWidth={filled ? 2.25 : 1.75} />
                  </div>
                  <span className={`text-[10px] ${filled ? 'text-white' : 'text-white/50'}`}>{i + 1}</span>
                </div>
              )
            })}
            <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  freeLeft > 0
                    ? 'bg-accent-orange text-white'
                    : 'bg-white/15 text-white/45 border border-dashed border-white/40'
                }`}
              >
                <Gift size={18} strokeWidth={2} />
              </div>
              <span className="text-[10px] text-white/80">бесплатно</span>
            </div>
          </div>
          <p className="mt-2.5 text-sm text-white font-medium text-center">
            {freeLeft > 0
              ? `Есть подарок: ${freeLeft} ${freeLeft === 1 ? 'напиток' : 'напитка'} — скажите бариста`
              : left > 0
                ? `Ещё ${left} ${left === 1 ? 'стакан' : left < 5 ? 'стакана' : 'стаканов'} до бесплатного`
                : `Купите ${N} ${N === 1 ? 'стакан' : 'стаканов'} — следующий в подарок`}
          </p>
        </div>
      </div>

      <div className="px-4 -mt-1 space-y-3">
        {/* QR СРАЗУ — главный блок */}
        <div className="card !p-4 !pt-5 shadow-md border border-line">
          {!me && !proof ? (
            <div className="text-center py-8 space-y-2">
              <p className="text-sm text-ink-secondary">Нужен интернет один раз — карта и QR появятся сами.</p>
              <button type="button" className="btn min-h-12 w-full" onClick={() => void onSync()}>
                Получить карту
              </button>
            </div>
          ) : !proof ? (
            <div className="text-center py-6 space-y-2">
              <p className="text-sm text-ink-secondary">Код карты ещё не готов. Обновите данные.</p>
              <button type="button" className="btn-ghost min-h-11" onClick={() => void onSync()}>
                <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} /> Обновить
              </button>
            </div>
          ) : (
            <>
              <p className="text-center text-xs font-medium text-ink-secondary mb-2">
                Покажите этот QR на кассе
              </p>
              <button
                type="button"
                className="w-full flex flex-col items-center bg-white rounded-2xl p-2 active:scale-[0.99] transition-transform"
                onClick={() => nav('/card-qr')}
                aria-label="Открыть QR на весь экран"
              >
                <div className="bg-white p-2 rounded-xl">
                  <Qr value={proof} size={280} alt="QR карты для кассы" />
                </div>
                <p className="mt-3 text-3xl font-bold tracking-widest tabular-nums text-ink">
                  {cardCode || '—'}
                </p>
                <p className="text-[11px] text-ink-tertiary mt-1">
                  Не сканируется — назовите номер · нажмите для увеличения
                </p>
              </button>
              {(!hasNetwork || stale) && (
                <p className="text-center text-[11px] text-ink-secondary mt-2">
                  {!hasNetwork ? 'Офлайн · ' : 'Данные могут быть устаревшими · '}
                  {lastSync
                    ? `на ${new Date(lastSync).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
                    : 'синхронизации ещё не было'}
                </p>
              )}
            </>
          )}
        </div>

        {/* Кэшбэк — компактно */}
        {me && (
          <div className="card flex items-center gap-3 !py-3">
            <div className="w-10 h-10 rounded-xl bg-brand-soft flex items-center justify-center shrink-0">
              <Wallet size={20} className="text-brand" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink">Кэшбэк {cashbackText} ₽</div>
              <div className="text-xs text-ink-secondary">Списать можно у бариста на кассе</div>
            </div>
          </div>
        )}

        {/* Инвайт */}
        <button
          type="button"
          onClick={() => nav('/invite')}
          className="card w-full text-left flex items-center gap-3 !py-3 active:bg-brand-soft/50"
        >
          <div className="w-10 h-10 rounded-xl bg-accent-orange/15 flex items-center justify-center shrink-0">
            <Users size={20} className="text-accent-orange" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink">Пригласить друга</div>
            <div className="text-xs text-ink-secondary">{pct}% с его покупок после оплаты на кассе</div>
          </div>
        </button>

        {(me?.friendsCount ?? 0) > 0 || fromFriendsKop > 0 ? (
          <div className="card flex items-center gap-3 !py-3">
            <div className="w-10 h-10 rounded-xl bg-brand-soft flex items-center justify-center">
              <Gift size={20} className="text-brand" />
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">От друзей +{formatRub(fromFriendsKop)} ₽</div>
              <div className="text-xs text-ink-secondary">Друзей: {me?.friendsCount ?? 0}</div>
            </div>
          </div>
        ) : null}

        {!saved && me && (
          <p className="text-xs text-ink-secondary px-1">
            Сохраните восстановление карты в профиле («Ещё»), чтобы не потерять прогресс.
          </p>
        )}

        {vouchers.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5">
              <Ticket size={16} className="text-brand" /> Купоны
            </h2>
            {vouchers.map((v) => (
              <div key={v[0]} className="card flex justify-between items-center !py-3">
                <b className="text-sm">{v[1] === 'p' ? `Скидка ${v[2]}%` : `Скидка ${v[2]} ₽`}</b>
                <span className="text-ink-tertiary text-xs">до {new Date(v[3] * 86_400_000).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}

        {msg && (
          <p className={`text-sm ${msg.includes('карта') ? 'text-ok' : 'text-bad'}`}>{msg}</p>
        )}
      </div>
    </div>
  )
}
