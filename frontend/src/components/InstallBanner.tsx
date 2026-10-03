import { useEffect, useState } from 'react'
import {
  dismissInstallBanner,
  isDismissed,
  isIos,
  isStandalone,
  type BeforeInstallPromptEvent,
} from '../lib/install'

/**
 * Баннер «Установить на экран» — как у банковских PWA.
 * Android/Chrome: системный prompt.
 * iOS: подсказка Поделиться → На экран «Домой».
 * Не показывается в standalone и 14 дней после «Позже».
 */
export default function InstallBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [iosHint, setIosHint] = useState(false)
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (isStandalone() || isDismissed()) return

    const onBip = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onBip)

    // iOS: нет beforeinstallprompt — свой баннер через короткую паузу
    let iosTimer: ReturnType<typeof setTimeout> | undefined
    if (isIos()) {
      iosTimer = setTimeout(() => {
        if (!isStandalone() && !isDismissed()) {
          setIosHint(true)
          setVisible(true)
        }
      }, 2500)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      if (iosTimer) clearTimeout(iosTimer)
    }
  }, [])

  if (!visible || isStandalone()) return null

  async function install() {
    if (!deferred) {
      // iOS — просто раскрыли подсказку, кнопка уже «Понятно»
      return
    }
    setBusy(true)
    try {
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      if (outcome === 'accepted') {
        setVisible(false)
        setDeferred(null)
      } else {
        dismissInstallBanner()
        setVisible(false)
      }
    } catch {
      dismissInstallBanner()
      setVisible(false)
    } finally {
      setBusy(false)
    }
  }

  function later() {
    dismissInstallBanner()
    setVisible(false)
  }

  return (
    <div
      className="fixed left-0 right-0 z-50 px-3"
      style={{ bottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px) + 0.5rem)' }}
    >
      <div className="max-w-[480px] mx-auto bg-brand text-white rounded-2xl shadow-lg p-3 flex gap-3 items-start">
        <img
          src="/logo-mark.png"
          alt=""
          className="w-12 h-12 rounded-xl shrink-0 bg-white/10 object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">Установить 6.7 Coffee</p>
          {iosHint && !deferred ? (
            <p className="text-white/85 text-xs mt-1 leading-relaxed">
              Нажмите в Safari <b>Поделиться</b> (□↑), затем <b>«На экран „Домой“»</b> — ярлык появится как приложение.
            </p>
          ) : (
            <p className="text-white/85 text-xs mt-1 leading-relaxed">
              Карта и скидки на рабочем столе, удобнее чем во вкладке браузера.
            </p>
          )}
          <div className="flex gap-2 mt-2.5">
            {deferred ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void install()}
                className="text-xs font-semibold bg-white text-brand px-3 py-1.5 rounded-lg disabled:opacity-60"
              >
                {busy ? '…' : 'Установить'}
              </button>
            ) : iosHint ? (
              <button
                type="button"
                onClick={later}
                className="text-xs font-semibold bg-white text-brand px-3 py-1.5 rounded-lg"
              >
                Понятно
              </button>
            ) : null}
            <button
              type="button"
              onClick={later}
              className="text-xs text-white/80 px-2 py-1.5"
            >
              Позже
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
