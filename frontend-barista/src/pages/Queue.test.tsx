// @vitest-environment jsdom
/**
 * Симуляция экрана бариста без Playwright: вход уже выполнен, заказы приходят с мока fetch.
 * Проверяем то, что требует заказчик: новый заказ моргает, тап снимает моргание (seen),
 * «Исполнен» убирает заказ из очереди и отправляет done на сервер.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import QueuePage from './Queue'

type Call = { url: string; method: string; body: unknown }

const order = {
  id: 'ko-1',
  storeUuid: 'store-1',
  queueNumber: 7,
  clientOrderId: 'cart-1',
  status: 'new',
  items: [{ name: 'Капучино 350', qty: 1, mods: ['Овсяное'], note: null }],
  createdAt: Date.now(),
  seenAt: null,
  doneAt: null,
}

let calls: Call[] = []
let ordersState: typeof order[] = []

beforeEach(() => {
  calls = []
  ordersState = [{ ...order }]
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    if (url.endsWith('/api/staff/me')) {
      return new Response(JSON.stringify({ user: { login: 'barista', role: 'barista', alertBlink: true, displayName: null } }), { status: 200 })
    }
    if (url.includes('/api/staff/kitchen/orders') && method === 'GET') {
      return new Response(JSON.stringify({ orders: ordersState }), { status: 200 })
    }
    if (url.endsWith('/seen')) {
      ordersState = ordersState.map((o) => ({ ...o, status: 'seen' }))
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    if (url.endsWith('/done')) {
      ordersState = []
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    if (url.endsWith('/api/staff/me') && method === 'PATCH') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('экран бариста', () => {
  it('новый заказ виден, моргает, тап → seen, «Исполнен» → done', async () => {
    render(<QueuePage onLogout={() => {}} />)

    // Карточка появилась и моргает (класс анимации).
    const card = await screen.findByText('№7')
    const cardEl = card.closest('li')!
    expect(cardEl.className).toContain('is-blinking')
    expect(screen.getByText(/Капучино 350/)).toBeTruthy()

    // Тап по карточке снимает моргание и отправляет seen.
    fireEvent.click(card)
    await waitFor(() => expect(cardEl.className).not.toContain('is-blinking'))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/orders/ko-1/seen') && c.method === 'POST')).toBe(true))

    // «Исполнен» — заказ уходит из очереди.
    fireEvent.click(screen.getByRole('button', { name: 'Исполнен' }))
    await waitFor(() => expect(screen.queryByText('№7')).toBeNull())
    expect(calls.some((c) => c.url.endsWith('/orders/ko-1/done') && c.method === 'POST')).toBe(true)
    expect(await screen.findByText('Заказов нет')).toBeTruthy()
  })

  it('переключатель моргания сохраняется на сервере', async () => {
    render(<QueuePage onLogout={() => {}} />)
    await screen.findByText('№7')
    const toggle = screen.getByRole('checkbox') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/staff/me') && c.method === 'PATCH' && (c.body as { alertBlink: boolean }).alertBlink === false)).toBe(true))
  })
})
