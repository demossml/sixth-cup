/**
 * HTTP client for api.evotor.ru — pattern from workApp Evotor class.
 *
 * Auth: header X-Authorization: <EVOTOR_API_TOKEN>
 * Token: permanent in server .env (owner pastes token from Evotor). No webhook exchange.
 * Optional EVOTOR_PROXY_URL like workApp (proxy?url=).
 */
import { evotorConfig } from '../../../config'
import { evotorPaths } from './endpoints'

export class EvotorApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public path: string,
  ) {
    super(message)
    this.name = 'EvotorApiError'
  }
}

/**
 * Evotor v1 inventories dates: plain `YYYY-MM-DD`.
 * - gtCloseDate (since) is inclusive → start of day.
 * - ltCloseDate (until) is EXCLUSIVE → next day, so the whole `date` day is included.
 * Verified against api.evotor.ru (a time component returns HTTP 400 invalid_format).
 */
export function formatDateWithTime(date: Date, isEndOfDay = false): string {
  const d = new Date(date)
  if (isEndOfDay) {
    // exclusive upper bound: include all of `date` by advancing to the next day
    d.setDate(d.getDate() + 1)
    d.setHours(0, 0, 0, 0)
  } else {
    d.setHours(0, 0, 0, 0)
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export class EvotorClient {
  constructor(
    private readonly token = evotorConfig.apiToken,
    private readonly baseUrl = evotorConfig.apiBaseUrl,
    private readonly proxyUrl = evotorConfig.proxyUrl,
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.token?.trim())
  }

  private async request(pathOrUrl: string): Promise<unknown> {
    if (!this.isConfigured) {
      throw new EvotorApiError('EVOTOR_API_TOKEN not set', 0, pathOrUrl)
    }

    let url = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${this.baseUrl.replace(/\/$/, '')}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`

    if (this.proxyUrl?.trim() && url.startsWith('https://api.evotor.ru/')) {
      url = `${this.proxyUrl}?url=${encodeURIComponent(url)}`
    }

    const backoffs = [1000, 2000, 4000, 8000, 16000]
    let lastStatus = 0
    let lastBody = ''

    for (let attempt = 0; attempt < 5; attempt++) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 15_000)
      try {
        const res = await fetch(url, {
          headers: { 'X-Authorization': this.token },
          signal: ac.signal,
        })
        lastStatus = res.status
        lastBody = await res.text()
        if (res.status === 401) {
          throw new EvotorApiError('Unauthorized — check EVOTOR_API_TOKEN', 401, pathOrUrl)
        }
        if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 4) {
          await new Promise((r) => setTimeout(r, backoffs[attempt] + Math.random() * 300))
          continue
        }
        if (!res.ok) {
          throw new EvotorApiError(`HTTP ${res.status}: ${lastBody.slice(0, 240)}`, res.status, pathOrUrl)
        }
        if (!lastBody) return null
        return JSON.parse(lastBody)
      } finally {
        clearTimeout(timer)
      }
    }
    throw new EvotorApiError(`HTTP ${lastStatus}: ${lastBody.slice(0, 240)}`, lastStatus, pathOrUrl)
  }

  /** workApp getShops → stores/search (array or wrapped) */
  async getStores(): Promise<unknown> {
    return this.request(evotorPaths.storesSearch)
  }

  async getEmployees(): Promise<unknown> {
    return this.request(evotorPaths.employeesSearch)
  }

  async getProducts(storeId: string): Promise<unknown> {
    return this.request(evotorPaths.products(storeId))
  }

  /**
   * Documents for store in [since, until], optional type filter (SELL, PAYBACK, …).
   * workApp: gtCloseDate, ltCloseDate, types=
   */
  async getDocuments(
    storeId: string,
    since: string,
    until: string,
    types?: string,
  ): Promise<unknown> {
    const q = new URLSearchParams({
      gtCloseDate: since,
      ltCloseDate: until,
    })
    if (types) q.set('types', types)
    return this.request(`${evotorPaths.documents(storeId)}?${q}`)
  }

  async getSellDocuments(storeId: string, since: string, until: string): Promise<unknown> {
    return this.getDocuments(storeId, since, until, 'SELL')
  }

  /**
   * V1: POST array of products to a store. Overwrites/creates by uuid.
   * POST /api/v1/inventories/stores/{storeUuid}/products
   */
  async postProducts(storeId: string, products: Record<string, unknown>[]): Promise<unknown> {
    if (!this.isConfigured) {
      throw new EvotorApiError('EVOTOR_API_TOKEN not set', 0, 'postProducts')
    }
    const path = evotorPaths.products(storeId)
    const url = `${this.baseUrl.replace(/\/$/, '')}${path}`
    let requestUrl = url
    if (this.proxyUrl?.trim() && url.startsWith('https://api.evotor.ru/')) {
      requestUrl = `${this.proxyUrl}?url=${encodeURIComponent(url)}`
    }
    const res = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'X-Authorization': this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(products),
    })
    const text = await res.text()
    if (!res.ok) {
      throw new EvotorApiError(`HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, path)
    }
    return text ? JSON.parse(text) : { ok: true }
  }
}
