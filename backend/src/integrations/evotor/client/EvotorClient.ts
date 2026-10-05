/**
 * HTTP client for api.evotor.ru
 * Auth: X-Authorization (workApp FACT). V2 Accept headers (MASTER-TZ §3).
 * No token in logs.
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

type Query = Record<string, string | number | undefined | null>

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export class EvotorClient {
  constructor(
    private readonly token = evotorConfig.apiToken,
    private readonly baseUrl = evotorConfig.apiBaseUrl,
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.token?.trim())
  }

  private async request<T>(
    method: string,
    path: string,
    opts?: { query?: Query; body?: unknown; retry?: boolean },
  ): Promise<T> {
    if (!this.isConfigured) {
      throw new EvotorApiError('EVOTOR_API_TOKEN not set', 0, path)
    }

    const url = new URL(path.startsWith('http') ? path : `${this.baseUrl}${path}`)
    if (opts?.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
      }
    }

    const headers: Record<string, string> = {
      'X-Authorization': this.token,
      Accept: 'application/vnd.evotor.v2+json',
    }
    if (opts?.body !== undefined) {
      headers['Content-Type'] = 'application/vnd.evotor.v2+json'
    }

    const maxAttempts = opts?.retry === false ? 1 : 5
    const backoffs = [1000, 2000, 4000, 8000, 16000]
    let lastStatus = 0
    let lastText = ''

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), 15_000)
      try {
        const res = await fetch(url.toString(), {
          method,
          headers,
          body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: ac.signal,
        })
        lastStatus = res.status
        lastText = await res.text()

        if (res.status === 401) {
          throw new EvotorApiError('Unauthorized (401) — token invalid', 401, path)
        }
        if ([400, 403, 404].includes(res.status)) {
          throw new EvotorApiError(`HTTP ${res.status}: ${lastText.slice(0, 200)}`, res.status, path)
        }
        if ([429, 500, 502, 503, 504].includes(res.status) && attempt < maxAttempts - 1) {
          const jitter = Math.floor(Math.random() * 300)
          await sleep(backoffs[attempt] + jitter)
          continue
        }
        if (!res.ok) {
          throw new EvotorApiError(`HTTP ${res.status}: ${lastText.slice(0, 200)}`, res.status, path)
        }
        if (!lastText) return undefined as T
        return JSON.parse(lastText) as T
      } finally {
        clearTimeout(t)
      }
    }
    throw new EvotorApiError(`HTTP ${lastStatus}: ${lastText.slice(0, 200)}`, lastStatus, path)
  }

  getStores() {
    return this.request<{ items?: unknown[] } | unknown[]>('GET', evotorPaths.stores)
  }

  getDevices() {
    return this.request<{ items?: unknown[] } | unknown[]>('GET', evotorPaths.devices)
  }

  getEmployees() {
    return this.request<{ items?: unknown[] } | unknown[]>('GET', evotorPaths.employees)
  }

  getDocuments(
    storeId: string,
    params: { since?: number | string; until?: number | string; type?: string; cursor?: string },
  ) {
    const query: Query = params.cursor
      ? { cursor: params.cursor }
      : {
          since: params.since,
          until: params.until,
          type: params.type,
        }
    return this.request<{
      items?: unknown[]
      paging?: { next_cursor?: string }
    }>('GET', evotorPaths.documents(storeId), { query })
  }

  getDocument(storeId: string, docId: string) {
    return this.request<unknown>('GET', evotorPaths.document(storeId, docId))
  }

  getProducts(storeId: string, cursor?: string) {
    return this.request<{ items?: unknown[]; paging?: { next_cursor?: string } }>(
      'GET',
      evotorPaths.products(storeId),
      { query: cursor ? { cursor } : {} },
    )
  }

  putProduct(storeId: string, productId: string, body: unknown) {
    return this.request<unknown>('PUT', evotorPaths.product(storeId, productId), {
      body,
      retry: false,
    })
  }
}
