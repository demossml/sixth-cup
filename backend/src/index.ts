import { serve } from '@hono/node-server'
import { app } from './app'
import { config } from './config'
import { seedIfEmpty } from './db/seed'
import { PollService } from './integrations/evotor/sync/PollService'
import { db } from './db'
import { evotorConfig } from './config'

seedIfEmpty()

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`6.7 Coffee API: http://localhost:${info.port}`)
})

if (evotorConfig.enabled) {
  const poll = new PollService(db)
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const r = await poll.runFast()
      if (r.inserted) console.log('[evotor] fast poll', r)
    } catch (e) {
      console.error('[evotor] fast poll failed', String(e))
    } finally {
      running = false
    }
  }
  void tick()
  setInterval(() => void tick(), Math.max(15, evotorConfig.pollIntervalSec) * 1000)
  setInterval(() => void poll.runHourly().catch((e) => console.error('[evotor] hourly poll failed', String(e))), 3_600_000)
  setInterval(() => void poll.runDaily().catch((e) => console.error('[evotor] daily poll failed', String(e))), 86_400_000)
}
