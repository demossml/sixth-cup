import { serve } from '@hono/node-server'
import { app } from './app'
import { config } from './config'
import { seedIfEmpty } from './db/seed'

seedIfEmpty()

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`6.7 Coffee API: http://localhost:${info.port}`)
})
