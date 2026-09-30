import { serve } from '@hono/node-server'
import { app } from './app'
import { config } from './config'
import { seedIfEmpty } from './db/seed'

seedIfEmpty()

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Шестой стакан API: http://localhost:${info.port}`)
})
