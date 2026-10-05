/**
 * Phase 0 probe — run on server with EVOTOR_API_TOKEN set.
 * Writes summary to stdout; save sanitized samples to __fixtures__ manually.
 *
 *   cd backend && EVOTOR_API_TOKEN=... npx tsx scripts/evotor-probe.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { EvotorClient } from '../src/integrations/evotor/client/EvotorClient'

const client = new EvotorClient()
const outDir = join(import.meta.dirname ?? '.', '../src/integrations/evotor/__fixtures__')

async function main() {
  const report: Record<string, unknown> = {
    at: new Date().toISOString(),
    configured: client.isConfigured,
  }
  if (!client.isConfigured) {
    console.error('Set EVOTOR_API_TOKEN')
    process.exit(1)
  }

  try {
    const stores = await client.getStores()
    report.stores = stores
    console.log('0.1 stores OK')
  } catch (e) {
    report.storesError = String(e)
    console.error('0.1 stores FAIL', e)
  }

  try {
    const devices = await client.getDevices()
    report.devices = Array.isArray(devices)
      ? { count: devices.length }
      : { count: (devices as { items?: unknown[] }).items?.length }
    console.log('0.1 devices OK')
  } catch (e) {
    report.devicesError = String(e)
  }

  try {
    const storesRaw = await client.getStores()
    const items = Array.isArray(storesRaw)
      ? storesRaw
      : ((storesRaw as { items?: { id?: string; uuid?: string }[] }).items ?? [])
    const first = items[0] as { id?: string; uuid?: string } | undefined
    const storeId = first?.id ?? first?.uuid
    if (storeId) {
      const docs = await client.getDocuments(storeId, {
        since: Date.now() - 7 * 86400_000,
      })
      report.documentsSampleMeta = {
        storeId,
        itemCount: docs.items?.length ?? 0,
        next_cursor: docs.paging?.next_cursor ? 'yes' : 'no',
        types: [...new Set((docs.items ?? []).map((d) => (d as { type?: string }).type))],
      }
      const sell = (docs.items ?? []).find((d) => (d as { type?: string }).type === 'SELL')
      if (sell) {
        mkdirSync(outDir, { recursive: true })
        const sanitized = JSON.parse(JSON.stringify(sell)) as Record<string, unknown>
        // strip likely PII
        const body = sanitized.body as Record<string, unknown> | undefined
        if (body) {
          delete body.customer_email
          delete body.customer_phone
        }
        writeFileSync(join(outDir, 'sell-sample.json'), JSON.stringify(sanitized, null, 2))
        report.sellFixture = 'sell-sample.json written'
        console.log('0.3 SELL fixture written')
      } else {
        console.log('0.3 no SELL in last 7d — create a test sale on terminal')
      }
    }
  } catch (e) {
    report.documentsError = String(e)
    console.error('0.3 documents FAIL', e)
  }

  console.log(JSON.stringify(report, null, 2))
  console.log('\nNext: fill docs/EVOTOR-FACTS.md; run APK prototype for 0.6 extras.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
