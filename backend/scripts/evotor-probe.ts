/**
 * Phase 0 probe — EVOTOR_API_TOKEN fixed in env (no webhook).
 * Pattern: workApp Evotor + X-Authorization + v1 inventories.
 *
 *   export EVOTOR_API_TOKEN='…'
 *   npm run evotor:probe
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { EvotorClient, formatDateWithTime } from '../src/integrations/evotor/client/EvotorClient'

const client = new EvotorClient()

function asArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown[] }).items)) {
    return (data as { items: unknown[] }).items
  }
  return []
}

async function main() {
  if (!client.isConfigured) {
    console.error('Set EVOTOR_API_TOKEN in env (fixed token from Evotor, not webhook).')
    process.exit(1)
  }

  const report: Record<string, unknown> = { at: new Date().toISOString(), mode: 'v1+X-Authorization' }

  try {
    const stores = await client.getStores()
    const list = asArray(stores)
    report.storesCount = list.length
    report.storeSample = list[0]
      ? {
          keys: Object.keys(list[0] as object),
          uuid: (list[0] as { uuid?: string; id?: string }).uuid ?? (list[0] as { id?: string }).id,
        }
      : null
    console.log('0.1 stores OK', report.storesCount)
  } catch (e) {
    report.storesError = String(e)
    console.error('0.1 stores FAIL', e)
  }

  try {
    const em = await client.getEmployees()
    report.employeesCount = asArray(em).length
    console.log('0.1 employees OK', report.employeesCount)
  } catch (e) {
    report.employeesError = String(e)
  }

  try {
    const stores = asArray(await client.getStores())
    const first = stores[0] as { uuid?: string; id?: string } | undefined
    const storeId = first?.uuid ?? first?.id
    if (storeId) {
      const since = formatDateWithTime(new Date(Date.now() - 7 * 86400_000), false)
      const until = formatDateWithTime(new Date(), true)
      const docs = asArray(await client.getDocuments(storeId, since, until))
      report.documentsCount = docs.length
      report.docTypes = [...new Set(docs.map((d) => (d as { type?: string }).type))]
      const sell = docs.find((d) => (d as { type?: string }).type === 'SELL')
      if (sell) {
        const dir = join(import.meta.dirname ?? '.', '../src/integrations/evotor/__fixtures__')
        mkdirSync(dir, { recursive: true })
        const copy = JSON.parse(JSON.stringify(sell)) as Record<string, unknown>
        writeFileSync(join(dir, 'sell-sample.json'), JSON.stringify(copy, null, 2))
        report.sellFixture = 'sell-sample.json'
        report.sellKeys = Object.keys(sell as object)
        console.log('0.3 SELL fixture written')
      } else {
        console.log('0.3 no SELL in 7d — make a test sale on terminal')
      }
    }
  } catch (e) {
    report.documentsError = String(e)
    console.error('0.3 documents FAIL', e)
  }

  console.log(JSON.stringify(report, null, 2))
  console.log('\nFill docs/EVOTOR-FACTS.md from this output. Token stays only in server .env.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
