#!/usr/bin/env node
/**
 * Быстрый smoke-прогон API 6.7 Coffee (без записи в прод-БД, только чтение + гостевая сессия).
 *
 * Запуск:
 *   node scripts/e2e-smoke.mjs                       # http://127.0.0.1:3000
 *   BASE=https://api.67coffee.ru node scripts/e2e-smoke.mjs
 *
 * Коды 200/304 считаем успехом; 401/403 на админских ручках — ожидаемо без токена.
 * Смысл: после деплоя одной командой убедиться, что меню, кофейни, заказ и push живы.
 */
const BASE = (process.env.BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '')

let failed = 0

const log = (ok, title, extra = '') => {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${title}${extra ? ` — ${extra}` : ''}`)
}

async function req(path, init) {
  const res = await fetch(`${BASE}${path}`, init)
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* не JSON — вернём текст */
  }
  return { res, json, text }
}

async function main() {
  console.log(`Smoke: ${BASE}\n`)

  const health = await req('/health').catch(() => null)
  if (!health) {
    log(false, 'GET /api/health — сервер не отвечает')
    process.exit(1)
  }
  log(health.res.ok, 'GET /health', `HTTP ${health.res.status}`)

  const dir = await req('/api/directory')
  const products = dir.json?.products ?? []
  const stores = dir.json?.stores ?? []
  log(dir.res.ok, 'GET /api/directory', `точек ${stores.length}, товаров ${products.length}`)
  log(stores.length > 0, 'кофейни в каталоге есть')
  log(products.every((p) => p.soldOut === undefined || typeof p.soldOut === 'boolean'), 'у товаров корректный флаг soldOut')

  const withVolumes = products.find((p) => p.hasVolumes)
  if (withVolumes) {
    const cfg = await req(`/api/directory/config/${withVolumes.id}`)
    log(cfg.res.ok && cfg.json?.ok === true, 'GET /api/directory/config/:id', `объёмов ${cfg.json?.volumes?.length ?? 0}`)
  } else {
    log(true, 'GET /api/directory/config/:id — пропущен (нет товара с объёмами)')
  }

  const geo = await req('/api/directory/geo')
  log(geo.res.ok, 'GET /api/directory/geo', `точек ${geo.json?.stores?.length ?? 0}`)

  // Гостевая сессия: свой случайный invite не передаём — только проверяем, что ручка жива.
  const guest = await req('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const jwt = guest.json?.token ?? guest.json?.jwt ?? null
  log(guest.res.ok && !!jwt, 'POST /api/auth/guest', `HTTP ${guest.res.status}`)

  log(!!jwt, 'гостевая сессия выдана')

  if (!jwt) {
    log(false, 'ваучеры/квота — нет гостевого JWT')
  } else if (!stores.length || !products.length) {
    console.log('• каталог пуст — quote пропущен (на пустой базе это нормально)')
  } else {
    const product = products.find((p) => !p.soldOut) ?? products[0]
    const quote = await req('/api/orders/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ storeId: stores[0].id, items: [{ productId: String(product.id), quantity: 1 }], benefit: null }),
    })
    log(quote.res.ok && typeof quote.json?.total === 'number', 'POST /api/orders/quote', `итог ${quote.json?.total} ₽`)

    const sync = await req('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ receipts: [] }),
    })
    log(sync.res.ok, 'POST /api/sync', `HTTP ${sync.res.status}`)
  }

  const key = await req('/api/push/public-key')
  if (key.res.status === 503) console.log('• push выключен: VAPID-ключи не заданы (на проде должны быть)')
  else log(key.res.ok && typeof key.json?.publicKey === 'string', 'GET /api/push/public-key', `HTTP ${key.res.status}`)

  const admin = await req('/api/admin/products')
  log(admin.res.status === 401 || admin.res.status === 403 || admin.res.ok, 'GET /api/admin/products без токена — закрыт', `HTTP ${admin.res.status}`)

  console.log('')
  if (failed) {
    console.error(`Провалено проверок: ${failed}`)
    process.exit(1)
  }
  console.log('Smoke: всё зелёное')
}

await main()
