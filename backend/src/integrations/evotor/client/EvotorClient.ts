/**
 * HTTP client for api.evotor.ru.
 *
 * Authentication is the fixed EVOTOR_API_TOKEN from server env.
 * Fiscal documents/catalog reads continue to use the verified v1 inventories API.
 * Product CREATE/UPDATE use the Cloud catalog API where the Cloud generates the
 * product id on first POST; subsequent updates use that saved id in PUT.
 */
import { evotorConfig } from '../../../config'
import { evotorPaths } from './endpoints'

export class EvotorApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public path: string,
    public method = 'GET',
    public stage = 'request',
    public bodyEmpty = false,
  ) {
    super(message)
    this.name = 'EvotorApiError'
  }
}

export function formatDateWithTime(date: Date, isEndOfDay = false): string {
  const d = new Date(date)
  if (isEndOfDay) {
    d.setDate(d.getDate() + 1)
    d.setHours(0, 0, 0, 0)
  } else {
    d.setHours(0, 0, 0, 0)
  }
  const pad = (n: number) => [...String(n)].length === 1 ? `0${n}` : String(n)
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

  private buildUrl(pathOrUrl: string): string {
    let url = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${this.baseUrl.replace(/\/$/, '')}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`
    if (this.proxyUrl?.trim() && url.startsWith('https://api.evotor.ru/')) {
      url = `${this.proxyUrl}?url=${encodeURIComponent(url)}`
    }
    return url
  }

  private async requestJson(pathOrUrl: string, method = 'GET', body?: unknown, stage = 'request'): Promise<unknown> {
    if (!this.isConfigured) throw new EvotorApiError(`[${stage}] ${method} ${pathOrUrl} status=0 EVOTOR_API_TOKEN not set bodyEmpty=true`, 0, pathOrUrl, method, stage, true)
    const url = this.buildUrl(pathOrUrl)
    const backoffs = [1000, 2000, 4000, 8000]
    let lastStatus = 0
    let lastBody = ''
    for (let attempt = 0; attempt < 5; attempt++) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 15_000)
      try {
        const res = await fetch(url, {
          method,
          headers: {
            'X-Authorization': this.token,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ac.signal,
        })
        lastStatus = res.status
        lastBody = await res.text()
        if (res.status === 401) throw new EvotorApiError(`[${stage}] ${method} ${pathOrUrl} status=401 body=${lastBody.slice(0, 400) || '<empty>'} bodyEmpty=${!lastBody}`, 401, pathOrUrl, method, stage, !lastBody)
        if ([408, 429, 500, 502, 503, 504].includes(res.status) && attempt < 4) {
          await new Promise((r) => setTimeout(r, backoffs[attempt] + Math.random() * 300))
          continue
        }
        if (!res.ok) throw new EvotorApiError(`[${stage}] ${method} ${pathOrUrl} status=${res.status} body=${lastBody.slice(0, 400) || '<empty>'} bodyEmpty=${!lastBody}`, res.status, pathOrUrl, method, stage, !lastBody)
        if (!lastBody) return null
        try { return JSON.parse(lastBody) } catch { return lastBody }
      } finally {
        clearTimeout(timer)
      }
    }
    throw new EvotorApiError(`[${stage}] ${method} ${pathOrUrl} status=${lastStatus} body=${lastBody.slice(0, 400) || '<empty>'} bodyEmpty=${!lastBody}`, lastStatus, pathOrUrl, method, stage, !lastBody)
  }

  async getStores(): Promise<unknown> {
    return this.requestJson(evotorPaths.storesSearch)
  }

  async getEmployees(): Promise<unknown> {
    return this.requestJson(evotorPaths.employeesSearch)
  }

  async getProducts(storeId: string): Promise<unknown> {
    return this.requestJson(evotorPaths.products(storeId), 'GET', undefined, 'list')
  }

  async getDocuments(storeId: string, since: string, until: string, types?: string, cursor?: string): Promise<unknown> {
    // With a cursor the date window must NOT be repeated (Evotor cursor pagination).
    const q = cursor ? new URLSearchParams({ cursor }) : new URLSearchParams({ gtCloseDate: since, ltCloseDate: until })
    if (types && !cursor) q.set('types', types)
    return this.requestJson(`${evotorPaths.documents(storeId)}?${q}`)
  }

  async getSellDocuments(storeId: string, since: string, until: string): Promise<unknown> {
    return this.getDocuments(storeId, since, until, 'SELL')
  }

  /** Cloud Catalog API: Cloud generates the product id on first POST. */
  async createCloudProduct(storeId: string, product: Record<string, unknown>): Promise<unknown> {
    return this.requestJson(evotorPaths.v2Products(storeId), 'POST', product, 'create')
  }

  /** Cloud Catalog API: replace/update an already identified product. */
  async replaceCloudProduct(storeId: string, productId: string, product: Record<string, unknown>): Promise<unknown> {
    return this.requestJson(evotorPaths.v2Product(storeId, productId), 'PUT', product, 'replace')
  }

  /**
   * DELETE /stores/{id}/products?id=uuid1,uuid2 (max 1000).
   * Official Cloud API: removes products from store inventory.
   */
  async deleteCloudProducts(storeId: string, productIds: string[]): Promise<unknown> {
    if (!productIds.length) return { deleted: 0 }
    const unique = [...new Set(productIds.filter(Boolean))]
    const results: unknown[] = []
    for (let i = 0; i < unique.length; i += 1000) {
      const chunk = unique.slice(i, i + 1000)
      const q = chunk.map(encodeURIComponent).join(',')
      results.push(await this.requestJson(`${evotorPaths.v2Products(storeId)}?id=${q}`, 'DELETE'))
    }
    return { deleted: unique.length, batches: results.length }
  }


  /** Legacy v1 bulk product write retained only for explicit recovery tooling. */
  async postProducts(storeId: string, products: Record<string, unknown>[]): Promise<unknown> {
    return this.requestJson(evotorPaths.products(storeId), 'POST', products)
  }

  async postProductExtras(storeId: string, extras: Record<string, unknown>[]): Promise<unknown> {
    return this.requestJson(evotorPaths.productExtras(storeId), 'POST', extras, 'extras')
  }
}
