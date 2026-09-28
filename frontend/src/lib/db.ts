import { openDB } from 'idb'
import type { StoredReceipt } from './types'

const dbp = openDB('sixth-cup', 1, {
  upgrade(db) {
    db.createObjectStore('kv')
    db.createObjectStore('receipts', { keyPath: 'id' })
    db.createObjectStore('seen', { keyPath: 'userId' })
  },
})

export const kvGet = async <T>(key: string) => (await (await dbp).get('kv', key)) as T | undefined
export const kvSet = async (key: string, value: unknown) => { await (await dbp).put('kv', value, key) }
export const kvDel = async (key: string) => { await (await dbp).delete('kv', key) }

export const putReceipt = async (r: StoredReceipt) => { await (await dbp).put('receipts', r) }
export const allReceipts = async () => (await (await dbp).getAll('receipts')) as StoredReceipt[]

export type Seen = { userId: number; q: number; token: string }
export const putSeen = async (s: Seen) => { await (await dbp).put('seen', s) }
export const getSeen = async (userId: number) => (await (await dbp).get('seen', userId)) as Seen | undefined

export async function clearUserData() {
  const d = await dbp
  await d.delete('kv', 'card')
  await d.delete('kv', 'me')
  await d.clear('receipts')
}

export async function resetLocal() {
  const d = await dbp
  await d.clear('kv')
  await d.clear('receipts')
  await d.clear('seen')
}
