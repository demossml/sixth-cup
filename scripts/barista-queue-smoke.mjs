#!/usr/bin/env node
/**
 * E2E-симуляция очереди бариста по чеклисту серии (backend/PWA).
 *
 * Что проверяет на живом сервере:
 *   1) админ создаёт бариста (login/password, точка обязательна);
 *   2) бариста логинится по паролю;
 *   3) касса создаёт заказ device-запросом (прокси-токен + X-Evotor-Store-Uuid);
 *   4) повтор того же clientOrderId возвращает тот же заказ (идемпотентность);
 *   5) бариста видит заказ в активных, тап → seen, «Исполнен» → done (второй раз — no-op);
 *   6) касса видит done в списке статусов.
 *
 * Запуск (точка должна быть привязана к uuid Эвотора):
 *   BASE=http://127.0.0.1:3000 \
 *   ADMIN_TOKEN=... PROXY_TOKEN=... STORE_UUID=... \
 *   node scripts/barista-queue-smoke.mjs
 *
 * Пароль тестового пользователя удаляется вместе с пользователем — он не нужен в проде.
 */
const BASE = (process.env.BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''
const PROXY_TOKEN = process.env.PROXY_TOKEN || ''
const STORE_UUID = process.env.STORE_UUID || ''

let failed = 0
const check = (ok, title, extra = '') => {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${title}${extra ? ` — ${extra}` : ''}`)
}

async function req(path, { method = 'GET', token, admin, device, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(admin ? { 'X-Admin-Token': ADMIN_TOKEN } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(device ? { Authorization: `Bearer ${PROXY_TOKEN}`, 'X-Evotor-Store-Uuid': STORE_UUID } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* не JSON */ }
  return { status: res.status, json, text }
}

if (!ADMIN_TOKEN || !PROXY_TOKEN || !STORE_UUID) {
  console.error('Нужны переменные ADMIN_TOKEN, PROXY_TOKEN, STORE_UUID')
  process.exit(2)
}

const login = `smoke-barista-${Date.now().toString(36)}`
const password = `smoke-${Math.random().toString(36).slice(2, 12)}`
const clientOrderId = `smoke-cart-${Date.now()}`

const created = await req('/api/admin/app-users', {
  method: 'POST',
  admin: true,
  body: { login, password, role: 'barista', storeUuid: STORE_UUID },
})
check(created.status === 201, 'admin создаёт бариста', `status ${created.status}`)
const userId = created.json?.user?.id

const auth = await req('/api/staff/login', { method: 'POST', body: { login, password } })
check(auth.status === 200 && typeof auth.json?.token === 'string', 'вход бариста по паролю', `status ${auth.status}`)
const token = auth.json?.token

const wrong = await req('/api/staff/login', { method: 'POST', body: { login, password: 'definitely-wrong' } })
check(wrong.status === 401, 'неверный пароль → 401', `status ${wrong.status}`)

const me = await req('/api/staff/me', { token })
check(me.status === 200 && me.json?.user?.role === 'barista', 'GET /api/staff/me', `status ${me.status}`)

const orderBody = {
  clientOrderId,
  storeUuid: STORE_UUID,
  items: [
    { name: 'Капучино 350', qty: 1, mods: ['Овсяное', 'Ваниль'], note: null },
    { name: 'Круассан', qty: 2, mods: [], note: 'разогреть' },
  ],
  totalKopecks: 45500,
}
const o1 = await req('/api/devices/kitchen/orders', { method: 'POST', device: true, body: orderBody })
check(o1.status === 200 && o1.json?.status === 'new', 'касса создаёт заказ со статусом new', `status ${o1.status}`)
check(Number.isInteger(o1.json?.queueNumber), 'номер очереди выдан', `№${o1.json?.queueNumber}`)

const o2 = await req('/api/devices/kitchen/orders', { method: 'POST', device: true, body: orderBody })
check(o2.json?.id === o1.json?.id, 'повтор clientOrderId → тот же заказ', `${o2.json?.id}`)

const active = await req('/api/staff/kitchen/orders?status=active', { token })
const inQueue = (active.json?.orders ?? []).some((o) => o.id === o1.json?.id)
check(inQueue, 'бариста видит заказ в активных')

const seen = await req(`/api/staff/kitchen/orders/${o1.json?.id}/seen`, { method: 'POST', token })
check(seen.json?.order?.status === 'seen', 'тап → seen', `status ${seen.status}`)

const done = await req(`/api/staff/kitchen/orders/${o1.json?.id}/done`, { method: 'POST', token })
check(done.json?.order?.status === 'done' && done.json?.changed === true, '«Исполнен» → done', `status ${done.status}`)

const doneAgain = await req(`/api/staff/kitchen/orders/${o1.json?.id}/done`, { method: 'POST', token })
check(doneAgain.json?.changed === false, 'повтор «Исполнен» ничего не меняет')

const deviceList = await req(`/api/devices/kitchen/orders?storeUuid=${encodeURIComponent(STORE_UUID)}`, { device: true })
const doneSeenByTill = (deviceList.json?.orders ?? []).find((o) => o.id === o1.json?.id)
check(doneSeenByTill?.status === 'done', 'касса видит done в списке статусов')

// Уборка: тестовый логин не должен оставаться в проде.
const off = userId
  ? await req(`/api/admin/app-users/${userId}`, { method: 'PATCH', admin: true, body: { active: false } })
  : { status: 0 }
check(off.status === 200, 'тестовый пользователь отключён', `status ${off.status}`)

console.log(failed === 0 ? '\nВсе проверки пройдены.' : `\nПровалено проверок: ${failed}`)
process.exit(failed === 0 ? 0 : 1)
