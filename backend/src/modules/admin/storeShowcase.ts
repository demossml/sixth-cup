/**
 * Витрина точки ↔ облачная точка Эвотор.
 *
 * Гость видит `stores` (название, адрес, фото — всё вводит владелец), облако живёт в `evotor_stores`.
 * Связь — `evotor_stores.local_store_id`. Название и адрес из облака **никогда** не перезаписывают
 * витрину: они лежат снимками (`evotor_name`, `evotor_address`), чтобы в админке была кнопка
 * «Взять из Эвотора».
 */
import type Database from 'better-sqlite3'

type Db = Database.Database

export type EvotorStoreRow = {
  store_uuid: string
  name: string | null
  address: string | null
  code: string | null
  local_store_id: number | null
}

export function evotorStoreById(db: Db, uuid: string): EvotorStoreRow | undefined {
  return db.prepare('SELECT store_uuid, name, address, code, local_store_id FROM evotor_stores WHERE store_uuid=?')
    .get(uuid) as EvotorStoreRow | undefined
}

export function linkedEvotorStore(db: Db, localStoreId: number): EvotorStoreRow | undefined {
  return db.prepare('SELECT store_uuid, name, address, code, local_store_id FROM evotor_stores WHERE local_store_id=?')
    .get(localStoreId) as EvotorStoreRow | undefined
}

/**
 * Обновить снимки названия и адреса из облака. Значения витрины (`name`, `address`) не трогаем —
 * владелец мог назвать точку понятнее («6.7 Coffee на Багратиона»).
 */
export function refreshEvotorSnapshot(db: Db, uuid: string): void {
  const row = evotorStoreById(db, uuid)
  if (!row?.local_store_id) return
  db.prepare('UPDATE stores SET evotor_name=?, evotor_address=? WHERE id=?')
    .run(row.name ?? null, row.address ?? null, row.local_store_id)
}

/** Привязать витрину к облачной точке. Одна облачная точка — одна витрина (уникальный индекс). */
export function linkStore(db: Db, localStoreId: number, uuid: string): void {
  // Прежняя привязка снимается: у витрины может быть только одна касса.
  db.prepare('UPDATE evotor_stores SET local_store_id=NULL WHERE local_store_id=? AND store_uuid<>?')
    .run(localStoreId, uuid)
  db.prepare('UPDATE evotor_stores SET local_store_id=? WHERE store_uuid=?').run(localStoreId, uuid)
  refreshEvotorSnapshot(db, uuid)
}

export function unlinkStore(db: Db, localStoreId: number): void {
  db.prepare('UPDATE evotor_stores SET local_store_id=NULL WHERE local_store_id=?').run(localStoreId)
  db.prepare('UPDATE stores SET evotor_name=NULL, evotor_address=NULL WHERE id=?').run(localStoreId)
}

/**
 * Создать витрину из облачной точки (или вернуть уже созданную).
 * Название и адрес заполняются облачными значениями как отправная точка — дальше владелец правит руками.
 */
export function ensureShowcaseForEvotorStore(
  db: Db,
  uuid: string,
  organizationId: number | null,
): { storeId: number; created: boolean } | null {
  const row = evotorStoreById(db, uuid)
  if (!row) return null
  if (row.local_store_id) {
    refreshEvotorSnapshot(db, uuid)
    return { storeId: Number(row.local_store_id), created: false }
  }
  // Юрлица не создаём: если организация уже есть — привяжем, иначе витрина живёт без неё.
  const org = organizationId ?? (
    (db.prepare('SELECT id FROM organizations ORDER BY id LIMIT 1').get() as { id: number } | undefined)?.id ?? null
  )
  const r = db.prepare(`INSERT INTO stores(name, address, organization_id, evotor_name, evotor_address)
      VALUES(?,?,?,?,?)`)
    .run(row.name || `Точка ${uuid.slice(0, 6)}`, row.address || '', org, row.name ?? null, row.address ?? null)
  const storeId = Number(r.lastInsertRowid)
  linkStore(db, storeId, uuid)
  return { storeId, created: true }
}

/** Отметка в админке: чего не хватает витрине для понятного выбора гостя. */
export function showcaseGaps(store: {
  address: string | null
  lat: number | null
  lng: number | null
  photoUrl: string | null
  hoursJson: string | null
}): string[] {
  const gaps: string[] = []
  if (!store.address || !store.address.trim()) gaps.push('адрес')
  if (store.lat == null || store.lng == null) gaps.push('координаты')
  if (!store.photoUrl) gaps.push('фото')
  if (!store.hoursJson) gaps.push('часы работы')
  return gaps
}
