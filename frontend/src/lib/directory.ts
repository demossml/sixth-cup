import { api, unwrap } from '../api'
import { kvGet, kvSet } from './db'
import type { Directory } from './types'

export const loadDirectory = () => kvGet<Directory>('directory')

export async function refreshDirectory(): Promise<Directory | null> {
  try {
    const d = (await unwrap(api.api.directory.$get())) as unknown as Directory
    await kvSet('directory', d)
    return d
  } catch {
    return null
  }
}
