import { serve } from '@hono/node-server'
import app from './index.js'

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) })
console.log(`lets-cs-mcp listening on :${process.env.PORT ?? 8787}`)
