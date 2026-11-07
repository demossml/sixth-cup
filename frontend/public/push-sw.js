/**
 * Push «заказ готов» в service worker (подключается через workbox.importScripts).
 *
 * Показываем уведомление только по данным сервера; клик открывает экран заказа.
 * Ничего не кэшируем и не перехватываем: это отдельный обработчик события `push`.
 */
/* eslint-disable no-undef */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: '6.7 Coffee', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || '6.7 Coffee'
  const body = data.body || ''
  const url = data.url || '/'
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || undefined,
      data: { url },
      // Тихое уведомление: транзакционное, но не «кричит» вибрацией.
      silent: false,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = all.find((c) => c.url.includes('/'))
      if (existing) {
        await existing.focus()
        if ('navigate' in existing) await existing.navigate(url)
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
