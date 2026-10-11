import { db } from '../../db'

/** Queue a product upsert for every Evotor store with sync_enabled=1 (outbox; pushed by the sync worker). */
export function enqueueProductSync(productIds: number[]) {
  const ids = [...new Set(productIds.filter((id) => Number.isInteger(id) && id > 0))]
  if (!ids.length) return
  // Outbox only for stores with sync_enabled=1
  const cols = db.prepare(`PRAGMA table_info(evotor_stores)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'sync_enabled')) {
    db.exec(`ALTER TABLE evotor_stores ADD COLUMN sync_enabled INTEGER NOT NULL DEFAULT 0`)
  }
  const stores = db.prepare('SELECT store_uuid FROM evotor_stores WHERE COALESCE(sync_enabled,0)=1').all() as { store_uuid: string }[]
  for (const store of stores) {
    for (const productId of ids) {
      const existing = db.prepare(`SELECT id FROM evotor_outbox WHERE store_uuid=? AND entity='PRODUCT' AND entity_key=? AND status='PENDING' LIMIT 1`)
        .get(store.store_uuid, String(productId)) as { id: number } | undefined
      if (existing) db.prepare(`UPDATE evotor_outbox SET next_at=?,last_error=NULL WHERE id=?`).run(Date.now(), existing.id)
      else db.prepare(`INSERT INTO evotor_outbox(store_uuid,entity,entity_key,op,priority,status,attempts,next_at) VALUES(?,?,?,?,5,'PENDING',0,?)`)
        .run(store.store_uuid, 'PRODUCT', String(productId), 'UPSERT', Date.now())
    }
  }
}
