import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, RefreshCw, WifiOff } from 'lucide-react'
import { useApp } from '../lib/app'
import { fmtClock, STALE_MS } from '../lib/syncStatus'
import {
  buildMenuItems,
  itemsCountLabel,
  pickPopular,
  storeHours,
  type MenuDirectory,
  type MenuItem,
} from '../lib/menuModel'
import CategoryChips from '../components/menu/CategoryChips'
import MenuSkeleton from '../components/menu/MenuSkeleton'
import ProductCard from '../components/menu/ProductCard'
import MenuHeader from '../components/menu/MenuHeader'
import SeasonHero from '../components/menu/SeasonHero'
import StateBlock from '../components/StateBlock'
import { OrderQrScreen } from '../components/order/OrderQrScreen'
import { cartTotal, loadCart, loadOrderRef, type CartLine, type OrderOut } from '../lib/preorderApi'
import ActiveOrderBanner from '../components/order/ActiveOrderBanner'
import { useActiveOrder } from '../lib/useActiveOrder'
import { banLeftSec, banText } from '../lib/orderBanner'
import { useNow } from '../lib/useNow'

/** Сколько ждём чтения кэша/первой синхронизации, прежде чем объявить «нет каталога». */
const FIRST_LOAD_GRACE_MS = 1500

type Props = {
  /** Каталог «Смотреть всё»: все позиции, без hero и подборки. */
  catalog?: boolean
}

/**
 * Экран меню как в макете: шапка с логотипом и поиском, строка кофейни, счётчик позиций,
 * сезонный hero, «Популярное», чипы категорий и сетка карточек 4:5.
 * Карточка товара и корзина — отдельные экраны (`/menu/:id`, `/cart`).
 */
export default function MenuPage({ catalog = false }: Props) {
  const { dir: rawDir, sync, syncing, lastSync } = useApp()
  const dir = rawDir as MenuDirectory | null
  const nav = useNavigate()
  const [catId, setCatId] = useState<number | 'all'>('all')
  const [sort, setSort] = useState<'menu' | 'price'>('menu')
  const [loadError, setLoadError] = useState(false)
  const [waited, setWaited] = useState(false)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [cart, setCart] = useState<CartLine[]>(() => loadCart())
  const [orderView, setOrderView] = useState<OrderOut | null>(null)
  const { order: activeOrder, bannedUntil, offline: orderOffline, refresh: refreshOrder } = useActiveOrder()
  const clock = useNow(30_000)
  const banLeft = banLeftSec(bannedUntil, clock)
  const banMessage = banLeft > 0
    ? `Прошлый заказ не был забран и оплачен. Новый заказ будет доступен через ${banText(banLeft)}.`
    : null

  const stores = dir?.stores ?? []
  const storeId = useMemo(() => {
    try { return Number(localStorage.getItem('sc_store_id')) || null } catch { return null }
  }, [])
  const store = stores.find((s) => s.id === storeId) ?? null

  // Точка не выбрана — сначала спрашиваем «где заберёте», как в макете.
  useEffect(() => {
    if (catalog || store || !dir) return
    if (stores.length > 1) nav('/pick-store', { replace: true })
  }, [catalog, store, stores.length, dir, nav])

  // Корзина живёт в sessionStorage: экран меню перечитывает её после возврата с карточки/корзины.
  useEffect(() => {
    setCart(loadCart())
  }, [dir, orderView])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  useEffect(() => {
    if (dir || syncing || waited) return
    const t = setTimeout(() => setWaited(true), FIRST_LOAD_GRACE_MS)
    return () => clearTimeout(t)
  }, [dir, syncing, waited])

  const items = useMemo(() => (dir ? buildMenuItems(dir) : []), [dir])
  const popular = useMemo(() => pickPopular(items), [items])
  const categories = dir?.categories ?? []

  const visible = useMemo(() => {
    const byCat = catId === 'all' ? items : items.filter((i) => i.product.categoryId === catId)
    if (sort === 'menu') return byCat
    // «По цене» — от дешёвого: у позиций с объёмами берём минимальную цену.
    return [...byCat].sort((a, b) => (a.product.priceFrom ?? a.product.price) - (b.product.priceFrom ?? b.product.price))
  }, [items, catId, sort])

  const selectCategory = useCallback((id: number | 'all') => setCatId(id), [])

  const openItem = useCallback((it: MenuItem) => nav(`/menu/${it.product.id}`), [nav])

  async function refreshCatalog() {
    setLoadError(false)
    const r = await sync()
    if (r === 'offline' || r === 'auth' || r === 'error') setLoadError(true)
  }

  if (!dir) {
    if (online && !waited) {
      return (
        <main className="pb-5" aria-busy="true">
          <MenuSkeleton />
        </main>
      )
    }
    return (
      <main className="px-4 pb-6" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <h1 className="font-display text-[28px] leading-8 font-semibold text-ink mb-4">Меню</h1>
        <div className="rounded-3xl bg-white border border-line p-6 text-center shadow-card">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-tint text-brand flex items-center justify-center mb-4">
            {online ? <RefreshCw size={22} strokeWidth={1.75} /> : <WifiOff size={22} strokeWidth={1.75} />}
          </div>
          <h2 className="font-display text-lg font-semibold text-ink">{online ? 'Не удалось загрузить меню' : 'Нет соединения'}</h2>
          <p className="text-sm text-ink-secondary mt-2 mb-4">
            {online
              ? 'Проверьте соединение и попробуйте ещё раз. Карта доступна во вкладке «Карта».'
              : 'Когда появится сеть, меню загрузится. Карта доступна во вкладке «Карта».'}
          </p>
          <button
            type="button"
            onClick={() => void refreshCatalog()}
            disabled={syncing || !online}
            className="btn min-h-11 inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={16} className={syncing ? 'animate-spin motion-reduce:animate-none' : ''} />
            {syncing ? 'Обновляем…' : 'Повторить'}
          </button>
          {loadError && <p role="alert" className="text-sm text-bad mt-3">Не удалось загрузить каталог.</p>}
        </div>
      </main>
    )
  }

  const lastTs = lastSync > 0 ? lastSync : dir.generatedAt > 0 ? dir.generatedAt * 1000 : 0
  const stale = lastTs > 0 && Date.now() - lastTs > STALE_MS
  const at = lastTs > 0 ? fmtClock(lastTs) : ''
  const note = !online
    ? `Нет сети. Показано сохранённое меню${at ? ` · данные на ${at}` : ''}`
    : loadError
      ? 'Не удалось обновить меню'
      : stale
        ? `Меню может быть устаревшим${at ? ` · данные на ${at}` : ''}`
        : ''

  const heroContent = dir.content?.find((c) => c.placement === 'menu_hero') ?? null
  const heroProduct =
    (heroContent?.productId != null ? items.find((i) => i.product.id === heroContent.productId) : null) ??
    items.find((i) => i.badge === 'seasonal') ??
    null
  const showHero = !catalog && catId === 'all' && !!heroProduct
  const showPopular = !catalog && catId === 'all' && popular.length > 0
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0)
  const hours = store ? storeHours(store) : null

  return (
    <main className="pb-28">
      {catalog ? (
        <div className="px-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
          <button type="button" onClick={() => nav('/menu')} className="mb-2 inline-flex items-center gap-1 text-[14px] text-brand">
            <ChevronRight size={16} strokeWidth={2} className="rotate-180" /> В меню
          </button>
          <h1 className="font-display text-[26px] leading-8 font-semibold text-ink">Всё меню</h1>
        </div>
      ) : (
        <MenuHeader
          store={store ?? (stores.length === 1 ? stores[0] : null)}
          searchOpen={false}
          query=""
          onQuery={() => {}}
          onToggleSearch={() => nav('/search')}
          onChangeStore={() => nav('/pick-store')}
        />
      )}

      {!catalog && (
        <div className="px-4 mt-4 flex items-end justify-between gap-3">
          <h1 className="font-display text-[30px] leading-9 font-semibold text-ink">Меню</h1>
          <span className="text-[13px] leading-5 text-ink-secondary num pb-1">{itemsCountLabel(items.length)}</span>
        </div>
      )}

      {note && (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-xl bg-warn-bg text-warn px-3 py-2 text-[13px] leading-[18px]" role="status">
          <span>{note}</span>
          {online && (
            <button type="button" onClick={() => void refreshCatalog()} disabled={syncing} className="shrink-0 min-h-9 px-2 font-semibold underline disabled:opacity-50">
              {syncing ? 'Обновляем…' : 'Обновить'}
            </button>
          )}
        </div>
      )}

      <div className="px-4 mt-3 space-y-2">
        <ActiveOrderBanner
          order={activeOrder}
          storeName={stores.find((s) => s.id === activeOrder?.storeId)?.name ?? null}
          offline={orderOffline}
          onOpen={(order) => setOrderView(order)}
        />
        {banMessage && (
          <div role="status" className="rounded-2xl bg-warn-bg text-warn px-3.5 py-2.5 text-[13px] leading-[18px]">
            {banMessage}
          </div>
        )}
        {hours && !hours.open && (
          <div role="status" className="rounded-2xl bg-warn-bg text-warn px-3.5 py-2.5 text-[13px] leading-[18px]">
            {`Кофейня закрыта · ${hours.label}. Заказ можно отправить, когда откроется.`}
          </div>
        )}
      </div>

      {showHero && heroProduct && (
        <section className="px-4 mt-3" aria-label="Сезонное предложение">
          <SeasonHero
            item={heroProduct}
            title={heroContent?.title ?? null}
            body={heroContent?.body ?? null}
            imageUrl={heroContent?.imageUrl ?? null}
            onOpen={() => openItem(heroProduct)}
          />
        </section>
      )}

      <div className="sticky top-0 z-20 bg-page/95 backdrop-blur-sm px-4 pb-3 pt-3 mt-3">
        <CategoryChips categories={categories} active={catId} onSelect={selectCategory} />
        {catalog && (
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[12px] leading-4 text-ink-secondary num">{itemsCountLabel(visible.length)}</span>
            <div className="flex items-center gap-1 rounded-full border border-line bg-white p-0.5" role="group" aria-label="Сортировка">
              {(['menu', 'price'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSort(k)}
                  aria-pressed={sort === k}
                  className={`min-h-8 px-2.5 rounded-full text-[13px] leading-5 transition-colors ${
                    sort === k ? 'bg-brand text-white' : 'text-ink-secondary'
                  }`}
                >
                  {k === 'menu' ? 'По меню' : 'По цене'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {showPopular && (
        <section aria-labelledby="menu-popular" className="mb-4">
          <div className="px-4 mb-2 flex items-center justify-between gap-3">
            <h2 id="menu-popular" className="text-[18px] leading-6 font-semibold text-ink">Популярное</h2>
            <button type="button" onClick={() => nav('/catalog')} className="text-[13px] leading-5 font-semibold text-brand underline">
              Смотреть всё
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 px-4">
            {popular.map((it) => (
              <ProductCard key={it.product.id} item={it} onSelect={openItem} eager />
            ))}
          </div>
        </section>
      )}

      {visible.length > 0 ? (
        <div className={showPopular ? 'mt-4' : 'mt-3'}>
          {showPopular && <h2 className="px-4 mb-2 text-[18px] leading-6 font-semibold text-ink">Всё меню</h2>}
          <div className="grid grid-cols-2 gap-3 px-4">
            {visible.map((it, i) => (
              <ProductCard key={it.product.id} item={it} onSelect={openItem} eager={i < 2 && !showPopular} defer={i >= 6} />
            ))}
          </div>
        </div>
      ) : (
        <div className="px-4">
          {items.length === 0 ? (
            <StateBlock title="Скоро обновим меню" body="Пока здесь нет товаров." />
          ) : (
            <StateBlock title="Скоро обновим" body="В этой категории пока нет позиций." actionLabel="Показать всё" onAction={() => setCatId('all')} />
          )}
        </div>
      )}

      <p className="text-[12px] leading-[18px] text-ink-secondary text-center mt-5 px-4">
        Заказ и оплата — на кассе{!note && at ? ` · данные на ${at}` : ''}
      </p>

      {cartCount > 0 && (
        <div className="fixed left-0 right-0 max-w-[480px] mx-auto px-4 z-40" style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}>
          <button
            type="button"
            onClick={() => nav('/cart')}
            className="w-full min-h-14 rounded-2xl bg-brand text-white px-4 flex items-center justify-between gap-3 shadow-lift"
          >
            <span className="text-[15px] leading-5 font-semibold">Корзина · {cartCount}</span>
            <span className="num text-[15px] leading-5">{cartTotal(cart)} ₽</span>
          </button>
        </div>
      )}

      {orderView && (
        <OrderQrScreen
          orderId={orderView.id}
          qrPayload={loadOrderRef()?.orderId === orderView.id ? loadOrderRef()?.qrPayload ?? null : null}
          initial={orderView}
          onStatusChange={() => void refreshOrder()}
          onClose={() => { setOrderView(null); void refreshOrder() }}
          onOpenLoyalty={() => { setOrderView(null); nav('/') }}
        />
      )}
    </main>
  )
}
