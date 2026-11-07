import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, WifiOff } from '../lib/icons'
import { useApp } from '../lib/app'
import { fmtClock, STALE_MS } from '../lib/syncStatus'
import {
  buildMenuItems,
  modifierGroupsFor,
  pickHighlights,
  searchItems,
  type MenuDirectory,
  type MenuItem,
} from '../lib/menuModel'
import CategoryChips from '../components/menu/CategoryChips'
import MenuSearch from '../components/menu/MenuSearch'
import MenuSkeleton from '../components/menu/MenuSkeleton'
import ProductCard from '../components/menu/ProductCard'
import ProductSheet from '../components/menu/ProductSheet'
import StateBlock from '../components/StateBlock'
import { CartSheet } from '../components/order/CartSheet'
import { OrderQrScreen } from '../components/order/OrderQrScreen'
import {
  clearCart,
  createOrder,
  loadCart,
  loadOrderRef,
  saveCart,
  saveOrderRef,
  type CartLine,
  type OrderOut,
} from '../lib/preorderApi'
import ActiveOrderBanner from '../components/order/ActiveOrderBanner'
import { useActiveOrder } from '../lib/useActiveOrder'
import { banLeftSec, banText } from '../lib/orderBanner'
import { useNow } from '../lib/useNow'

/** Сколько ждём чтения кэша/первой синхронизации, прежде чем объявить «нет каталога». */
const FIRST_LOAD_GRACE_MS = 1500

export default function MenuPage() {
  const { dir: rawDir, sync, syncing, lastSync, me } = useApp()
  const dir = rawDir as MenuDirectory | null
  const nav = useNavigate()
  const [catId, setCatId] = useState<number | 'all'>('all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [selected, setSelected] = useState<MenuItem | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [waited, setWaited] = useState(false)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  // Корзина предзаказа живёт в sessionStorage; схлопываем одинаковые позиции по ключу.
  const [cart, setCart] = useState<CartLine[]>(() => loadCart())
  const [cartOpen, setCartOpen] = useState(false)
  const [cartBusy, setCartBusy] = useState(false)
  const [cartError, setCartError] = useState<string | null>(null)
  const [storeId, setStoreId] = useState<number | null>(null)
  const [placed, setPlaced] = useState<{ orderId: string; qrPayload: string | null; order: OrderOut } | null>(null)
  const [orderView, setOrderView] = useState<OrderOut | null>(null)
  const [blockNote, setBlockNote] = useState<string | null>(null)
  const { order: activeOrder, bannedUntil, offline: orderOffline, refresh: refreshOrder } = useActiveOrder()
  // Бан за невыкуп: понятный текст + заблокированная кнопка «Собрать заказ».
  const clock = useNow(30_000)
  const banLeft = banLeftSec(bannedUntil, clock)
  const banMessage = banLeft > 0
    ? `Прошлый заказ не был забран и оплачен. Новый заказ будет доступен через ${banText(banLeft)}.`
    : null

  const stores = dir?.stores ?? []
  useEffect(() => {
    if (storeId != null || stores.length === 0) return
    // Выбранная точка запоминается: гость не выбирает её заново на каждом заказе.
    let saved: number | null = null
    try { saved = Number(localStorage.getItem('sc_store_id')) || null } catch { saved = null }
    if (saved != null && stores.some((s) => s.id === saved)) setStoreId(saved)
    else setStoreId(stores.length === 1 ? stores[0].id : null)
  }, [storeId, stores])

  const pickStore = useCallback((id: number) => {
    setStoreId(id)
    try { localStorage.setItem('sc_store_id', String(id)) } catch { /* private mode */ }
  }, [])

  const updateCart = useCallback((lines: CartLine[]) => {
    setCart(lines)
    saveCart(lines)
  }, [])

  const addToCart = useCallback((line: { productId: string; name: string; price: number; volumeId?: string; volumeLabel?: string }) => {
    setCart((prev) => {
      const key = `${line.productId}|${line.volumeId ?? ''}`
      const exists = prev.find((l) => l.key === key)
      const next = exists
        ? prev.map((l) => (l.key === key ? { ...l, quantity: Math.min(99, l.quantity + 1) } : l))
        : [
            ...prev,
            {
              key,
              productId: line.productId,
              name: line.name,
              quantity: 1,
              volumeId: line.volumeId,
              volumeLabel: line.volumeLabel,
              unitPriceEstimate: line.price,
              modifiers: [],
              configText: line.volumeLabel ?? '',
            },
          ]
      saveCart(next)
      return next
    })
  }, [])

  async function submitOrder() {
    if (storeId == null || !cart.length) return
    setCartBusy(true)
    setCartError(null)
    setBlockNote(null)
    const r = await createOrder({
      storeId,
      cardId: me?.cardCode ? String(me.cardCode) : null,
      items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity, volumeId: l.volumeId ?? undefined })),
    })
    setCartBusy(false)
    if (!r.ok) {
      // «Уже есть заказ» и бан — это не ошибка ввода: показываем понятный путь, а не красный текст.
      if (r.error === 'active_order_exists') {
        setCartOpen(false)
        setBlockNote('У вас уже есть активный заказ — сначала заберите его.')
        await refreshOrder()
        return
      }
      if (r.error === 'preorder_banned') {
        setCartOpen(false)
        setBlockNote(r.message || 'Новый заказ пока недоступен: прошлый не был забран и оплачен.')
        await refreshOrder()
        return
      }
      setCartError(r.message || 'Не удалось собрать заказ')
      return
    }
    saveOrderRef({ orderId: r.order.id, qrPayload: r.qrPayload })
    setPlaced({ orderId: r.order.id, qrPayload: r.qrPayload, order: r.order })
    setCartOpen(false)
    updateCart([])
    clearCart()
    void refreshOrder()
  }

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

  // Каталога ещё нет: даём кэшу из IndexedDB / первой синхронизации шанс, и только потом рисуем ошибку.
  useEffect(() => {
    if (dir || syncing || waited) return
    const t = setTimeout(() => setWaited(true), FIRST_LOAD_GRACE_MS)
    return () => clearTimeout(t)
  }, [dir, syncing, waited])

  // Тяжёлая подготовка (сортировка, бейджи, поисковые строки) — один раз на смену каталога.
  const items = useMemo(() => (dir ? buildMenuItems(dir) : []), [dir])
  const highlights = useMemo(() => pickHighlights(items), [items])
  const categories = dir?.categories ?? []

  const searching = deferredQuery.trim().length > 0
  const visible = useMemo(() => {
    if (searching) return searchItems(items, deferredQuery) // поиск — по всему меню, не только по категории
    return catId === 'all' ? items : items.filter((i) => i.product.categoryId === catId)
  }, [items, catId, deferredQuery, searching])

  const groups = useMemo(() => (dir && selected ? modifierGroupsFor(dir, selected.product) : []), [dir, selected])

  const selectCategory = useCallback((id: number | 'all') => {
    setQuery('')
    setCatId(id)
  }, [])
  const openItem = useCallback((it: MenuItem) => setSelected(it), [])
  const closeSheet = useCallback(() => setSelected(null), [])
  const showCard = useCallback(() => {
    setSelected(null)
    nav('/')
  }, [nav])

  async function refreshCatalog() {
    setLoadError(false)
    const r = await sync()
    if (r === 'offline' || r === 'auth' || r === 'error') setLoadError(true)
  }

  const pad = { paddingTop: 'max(1rem, env(safe-area-inset-top))' }
  const title = <h1 className="text-[28px] leading-8 font-semibold text-ink">Меню</h1>

  /* ——— каталога нет: загрузка / офлайн / ошибка ——— */
  if (!dir) {
    if (online && !waited) {
      return (
        <main className="pb-5" aria-busy="true">
          <header className="px-4 pb-3" style={pad}>{title}</header>
          <MenuSkeleton />
        </main>
      )
    }
    return (
      <main className="px-4 pb-6" style={pad}>
        <div className="mb-4">{title}</div>
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

  const lastTs = lastSync > 0 ? lastSync : dir.generatedAt > 0 ? dir.generatedAt * 1000 : 0 // generatedAt — секунды сервера
  const stale = lastTs > 0 && Date.now() - lastTs > STALE_MS
  const at = lastTs > 0 ? fmtClock(lastTs) : ''
  const note = !online
    ? `Нет сети. Показано сохранённое меню${at ? ` · данные на ${at}` : ''}`
    : loadError
      ? 'Не удалось обновить меню'
      : stale
        ? `Меню может быть устаревшим${at ? ` · данные на ${at}` : ''}`
        : ''
  const store = dir.stores.length === 1 ? dir.stores[0] : null
  const showHighlights = !searching && catId === 'all' && highlights.length > 0
  const activeChip = searching ? null : catId

  return (
    <main className="pb-5">
      <header className="px-4 pb-3" style={pad}>
        {title}
        {store && <p className="mt-1 text-[13px] text-ink-secondary truncate">{store.name}</p>}
        {note && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-warn-bg text-warn px-3 py-2 text-[13px] leading-[18px]" role="status">
            <span>{note}</span>
            {online && (
              <button type="button" onClick={() => void refreshCatalog()} disabled={syncing} className="shrink-0 min-h-9 px-2 font-semibold underline disabled:opacity-50">
                {syncing ? 'Обновляем…' : 'Обновить'}
              </button>
            )}
          </div>
        )}
      </header>

      <div className="px-4 pb-3 space-y-2">
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
        {blockNote && (
          <div role="status" className="rounded-2xl bg-warn-bg text-warn px-3.5 py-2.5 text-[13px] leading-[18px]">
            {blockNote}
          </div>
        )}
        <MenuSearch value={query} onChange={setQuery} />
      </div>

      {/* Sticky-категории: под вырез/статус-бар в standalone добавляем safe-area */}
      <div className="sticky top-0 z-20 bg-page/95 backdrop-blur-sm px-4 pb-3 pt-2" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <CategoryChips categories={categories} active={activeChip} onSelect={selectCategory} />
      </div>

      {showHighlights && (
        <section aria-labelledby="menu-highlights" className="mb-4">
          <h2 id="menu-highlights" className="px-4 mb-2 text-[17px] leading-6 font-semibold text-ink">Стоит попробовать</h2>
          <div className="flex gap-3 overflow-x-auto scrollbar-none px-4 pb-1 snap-x snap-proximity scroll-px-4">
            {highlights.map((it, i) => (
              <ProductCard key={it.product.id} item={it} onSelect={openItem} eager={i < 2} badge={it.cmsBadge} className="w-[148px] shrink-0 snap-start" />
            ))}
          </div>
        </section>
      )}

      {searching && (
        <p className="px-4 mb-2 text-[13px] text-ink-secondary" aria-live="polite">
          {visible.length > 0 ? `Найдено: ${visible.length}` : ''}
        </p>
      )}

      {visible.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 px-4">
          {visible.map((it, i) => (
            <ProductCard key={it.product.id} item={it} onSelect={openItem} eager={!showHighlights && i < 2} defer={i >= 6} />
          ))}
        </div>
      ) : (
        <div className="px-4">
          {searching ? (
            <StateBlock
              title="Ничего не нашли"
              body={`По запросу «${deferredQuery.trim()}» в меню пусто. Попробуйте другое название.`}
              actionLabel="Сбросить поиск"
              onAction={() => setQuery('')}
            />
          ) : items.length === 0 ? (
            <StateBlock title="Скоро обновим меню" body="Пока здесь нет товаров." />
          ) : (
            <StateBlock title="Скоро обновим" body="В этой категории пока нет позиций." actionLabel="Показать всё" onAction={() => setCatId('all')} />
          )}
        </div>
      )}

      <p className="text-[12px] leading-[18px] text-ink-secondary text-center mt-5 px-4">
        Заказ и оплата — на кассе{!note && at ? ` · данные на ${at}` : ''}
      </p>

      {cart.length > 0 && (
        <div className="fixed left-0 right-0 max-w-[480px] mx-auto px-4 z-40" style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}>
          <button
            type="button"
            onClick={() => { setCartError(null); setCartOpen(true) }}
            className="w-full min-h-14 rounded-2xl bg-brand text-white px-4 flex items-center justify-between gap-3 shadow-lift"
          >
            <span className="text-[15px] leading-5 font-semibold">Корзина · {cart.reduce((s, l) => s + l.quantity, 0)}</span>
            <span className="num text-[15px] leading-5">≈ {cart.reduce((s, l) => s + l.unitPriceEstimate * l.quantity, 0)} ₽</span>
          </button>
        </div>
      )}

      {selected && (
        <ProductSheet
          item={selected}
          groups={groups}
          onClose={closeSheet}
          onShowCard={showCard}
          onAddToCart={online ? addToCart : undefined}
        />
      )}

      <CartSheet
        open={cartOpen}
        lines={cart}
        stores={stores.map((s) => ({ id: s.id, name: s.name }))}
        storeId={storeId}
        storeName={stores.find((s) => s.id === storeId)?.name}
        onChange={updateCart}
        onStoreChange={pickStore}
        onClose={() => setCartOpen(false)}
        onSubmit={() => void submitOrder()}
        submitting={cartBusy}
        error={cartError}
        blocked={banMessage}
      />

      {placed && (
        <OrderQrScreen
          orderId={placed.orderId}
          qrPayload={placed.qrPayload}
          initial={placed.order}
          onStatusChange={() => void refreshOrder()}
          onClose={() => { setPlaced(null); void refreshOrder() }}
          onOpenLoyalty={() => { setPlaced(null); nav('/') }}
        />
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

