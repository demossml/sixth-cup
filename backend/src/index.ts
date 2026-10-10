import { serve } from '@hono/node-server'
import { app } from './app'
import { config } from './config'
import { seedIfEmpty } from './db/seed'
import { PollService } from './integrations/evotor/sync/PollService'
import { db } from './db'
import { evotorConfig } from './config'
import { EvotorClient } from './integrations/evotor/client/EvotorClient'
import { ProductPushService } from './integrations/evotor/sync/ProductPushService'
import { installProcessErrorHooks, log, shortId } from './lib/logBuffer'

installProcessErrorHooks()

seedIfEmpty()

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`6.7 Coffee API: http://localhost:${info.port}`)
  log.info('server started', { port: info.port, env: config.isDev ? 'dev' : 'production', evotor: evotorConfig.enabled ? 'on' : 'off' })
})

if (evotorConfig.enabled) {
  // Ensure sync_enabled column exists (admin checkboxes)
  try {
    const cols = db.prepare(`PRAGMA table_info(evotor_stores)`).all() as { name: string }[]
    if (!cols.some((c) => c.name === 'sync_enabled')) {
      db.exec(`ALTER TABLE evotor_stores ADD COLUMN sync_enabled INTEGER NOT NULL DEFAULT 0`)
    }
  } catch { /* ignore */ }

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
  let lastIdleLogAt = 0
  const tick = async () => {
    if (running) return
    running = true
    try {
      const r = await poll.runFast()
      await refreshStores()
      for (const e of r.errors) log.error(`evotor poll failed: ${e.error.slice(0, 200)}`, { store: shortId(e.storeUuid) })
      if (r.inserted) log.info('evotor poll', { stores: r.stores, newDocs: r.inserted, seen: r.seen, sell: r.sellSeen, errors: r.errors.length })
      else if (Date.now() - lastIdleLogAt > 10 * 60_000) {
        // heartbeat so "is polling alive?" is answerable without flooding the buffer every minute
        lastIdleLogAt = Date.now()
        log.info('evotor poll idle (no new docs)', { stores: r.stores, seen: r.seen, sell: r.sellSeen, errors: r.errors.length })
      }
      const stores = db.prepare('SELECT store_uuid FROM evotor_stores WHERE COALESCE(sync_enabled,0)=1').all() as { store_uuid: string }[]
      for (const store of stores) {
        if (!catalogBootstrapped) {
          const sync = await catalog.syncStore(store.store_uuid)
          if (sync.pulled.imported || sync.pulled.updated || sync.pushed.pushed || sync.pushed.errors.length) log[sync.pushed.errors.length ? 'warn' : 'info']('evotor catalog bootstrap', { store: shortId(store.store_uuid), pulled: sync.pulled.imported, updated: sync.pulled.updated, pushed: sync.pushed.pushed, errors: sync.pushed.errors.length, firstError: sync.pushed.errors[0]?.slice(0, 120) })
        } else {
          const sync = await catalog.pushToStore(store.store_uuid)
          if (sync.pushed || sync.errors.length) log[sync.errors.length ? 'warn' : 'info']('evotor catalog push', { store: shortId(store.store_uuid), pushed: sync.pushed, errors: sync.errors.length, firstError: sync.errors[0]?.slice(0, 120) })
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
      const stores = db.prepare('SELECT store_uuid FROM evotor_stores WHERE COALESCE(sync_enabled,0)=1').all() as { store_uuid: string }[]
      for (const store of stores) {
        const sync = await catalog.syncStore(store.store_uuid)
        if (sync.pulled.imported || sync.pulled.updated || sync.pushed.pushed) log.info('evotor catalog sync', { store: shortId(store.store_uuid), pulled: sync.pulled.imported, updated: sync.pulled.updated, pushed: sync.pushed.pushed })
      }
      if (r.inserted) log.info('evotor hourly poll', { stores: r.stores, newDocs: r.inserted })
    } catch (e) {
      console.error('[evotor] hourly sync failed', String(e))
    }
  }
  void tick()
  setInterval(() => void tick(), Math.max(15, evotorConfig.pollIntervalSec) * 1000)
  setInterval(() => void hourly(), 3_600_000)
  setInterval(() => void poll.runDaily().catch((e) => console.error('[evotor] daily poll failed', String(e))), 86_400_000)
}
