import { openDB } from 'idb'
import type { StoredReceipt } from './types'

const dbp = openDB('sixth-cup', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('kv')
      db.createObjectStore('receipts', { keyPath: 'id' })
      db.createObjectStore('seen', { keyPath: 'userId' })
    }
    if (oldVersion < 2) {
      db.createObjectStore('account')
    }
  },
})

export type LocalAccount = { userId: number; jwt: string; createdAt: number }

export const kvGet = async <T>(key: string) => (await (await dbp).get('kv', key)) as T | undefined
export const kvSet = async (key: string, value: unknown) => { await (await dbp).put('kv', value, key) }
export const kvDel = async (key: string) => { await (await dbp).delete('kv', key) }

export const getAccount = async () => (await (await dbp).get('account', 'current')) as LocalAccount | undefined
export const saveAccount = async (account: LocalAccount) => { await (await dbp).put('account', account, 'current') }
export const clearAccount = async () => { await (await dbp).delete('account', 'current') }

export const putReceipt = async (r: StoredReceipt) => { await (await dbp).put('receipts', r) }
export const allReceipts = async () => (await (await dbp).getAll('receipts')) as StoredReceipt[]

export type Seen = { userId: number; q: number; token: string }
export const putSeen = async (s: Seen) => { await (await dbp).put('seen', s) }
export const getSeen = async (userId: number) => (await (await dbp).get('seen', userId)) as Seen | undefined

export async function clearUserData() {
  const d = await dbp
  await clearAccount()
  await d.delete('kv', 'card')
  await d.delete('kv', 'me')
  await d.delete('kv', 'referrals')
  await d.clear('receipts')
}

export async function resetLocal() {
  const d = await dbp
  await clearAccount()
  await d.clear('kv')
  await d.clear('receipts')
  await d.clear('seen')
}
