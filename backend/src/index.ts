import { serve } from '@hono/node-server'
import { app } from './app'
import { config } from './config'
import { seedIfEmpty } from './db/seed'
import { PollService } from './integrations/evotor/sync/PollService'
import { db } from './db'
import { evotorConfig } from './config'
import { EvotorClient } from './integrations/evotor/client/EvotorClient'
import { ProductPushService } from './integrations/evotor/sync/ProductPushService'

seedIfEmpty()

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`6.7 Coffee API: http://localhost:${info.port}`)
})

if (evotorConfig.enabled) {
  const poll = new PollService(db)
  let running = false
  let catalogBootstrapped = false
  const evotorClient = new EvotorClient()
  const catalog = new ProductPushService(db, evotorClient)
  const refreshStores = async () => {
    const raw = await evotorClient.getStores()
    const items = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).items) ? (raw as { items: unknown[] }).items : [])
    const now = Date.now()
    const upsert = db.prepare(`INSERT INTO evotor_stores(store_uuid,name,address,code,raw_json,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(store_uuid) DO UPDATE SET name=excluded.name,address=excluded.address,code=excluded.code,raw_json=excluded.raw_json,updated_at=excluded.updated_at`)
    for (const value of items) {
      if (!value || typeof value !== 'object') continue
      const o = value as Record<string, unknown>
      const uuid = String(o.uuid ?? o.id ?? '').trim()
      if (!uuid) continue
      upsert.run(uuid, o.name ?? null, o.address ?? null, o.code ?? null, JSON.stringify(o), now)
      db.prepare(`INSERT OR IGNORE INTO evotor_sync_state(store_uuid,last_seen_close_ms) VALUES(?,0)`).run(uuid)
    }
  }
  const tick = async () => {
    if (running) return
    running = true
    try {
      const r = await poll.runFast()
      await refreshStores()
      if (r.inserted) console.log('[evotor] fast poll', r)
      const stores = db.prepare('SELECT store_uuid FROM evotor_stores').all() as { store_uuid: string }[]
      for (const store of stores) {
        if (!catalogBootstrapped) {
          const sync = await catalog.syncStore(store.store_uuid)
          if (sync.pulled.imported || sync.pulled.updated || sync.pushed.pushed || sync.pushed.errors.length) console.log('[evotor] catalog bootstrap', store.store_uuid, sync)
        } else {
          const sync = await catalog.pushToStore(store.store_uuid)
          if (sync.pushed || sync.errors.length) console.log('[evotor] catalog push', store.store_uuid, sync)
        }
      }
      catalogBootstrapped = true
    } catch (e) {
      console.error('[evotor] fast/catalog tick failed', String(e))
    } finally {
      running = false
    }
  }
  const hourly = async () => {
    try {
      const r = await poll.runHourly()
      await refreshStores()
      const stores = db.prepare('SELECT store_uuid FROM evotor_stores').all() as { store_uuid: string }[]
      for (const store of stores) {
        const sync = await catalog.syncStore(store.store_uuid)
        if (sync.pulled.imported || sync.pulled.updated || sync.pushed.pushed) console.log('[evotor] catalog sync', store.store_uuid, sync)
      }
      if (r.inserted) console.log('[evotor] hourly poll', r)
    } catch (e) {
      console.error('[evotor] hourly sync failed', String(e))
    }
  }
  void tick()
  setInterval(() => void tick(), Math.max(15, evotorConfig.pollIntervalSec) * 1000)
  setInterval(() => void hourly(), 3_600_000)
  setInterval(() => void poll.runDaily().catch((e) => console.error('[evotor] daily poll failed', String(e))), 86_400_000)
}
