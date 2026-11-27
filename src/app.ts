import { Hono } from 'hono'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { safeEqual } from './auth.js'
import { dashboard } from './dashboard.js'
import { openDb, type Db } from './db.js'
import { createLetsApi, readEnv, type LetsApi } from './lets-api.js'
import { createMcpServer } from './mcp.js'

export type AppDeps = {
  authToken: string
  dashboardPassword: string
  api: LetsApi
  getDb: () => Promise<Db>
  now?: () => Date
  apiBase?: string
  dbKind?: string
}

export function createApp(options: AppDeps) {
  const app = new Hono()
  const now = options.now ?? (() => new Date())
  const getDeps = async () => ({ db: await options.getDb(), api: options.api, now })

  // 처리하지 못한 오류는 서버 로그(Vercel 로그)에 남기고 호출한 쪽에는 요약만 돌려준다.
  app.onError((err, c) => {
    console.error(`[lets-cs] ${c.req.method} ${new URL(c.req.url).pathname}`, err)
    return c.json({ error: 'internal', message: err instanceof Error ? err.message : String(err) }, 500)
  })

  app.get('/health', (c) => c.json({ ok: true }))

  app.use('/mcp', async (c, next) => {
    const sent = c.req.header('authorization') ?? ''
    if (!safeEqual(sent, `Bearer ${options.authToken}`)) return c.json({ error: 'unauthorized' }, 401)
    await next()
  })

  // 요청마다 서버와 트랜스포트를 새로 만든다. 세션을 들고 있지 않아 서버리스에서도 동작한다.
  app.all('/mcp', async (c) => {
    const server = await createMcpServer(await getDeps())
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    await server.connect(transport)
    return transport.handleRequest(c.req.raw)
  })

  app.route(
    '/',
    dashboard({
      authToken: options.authToken,
      dashboardPassword: options.dashboardPassword,
      getDeps,
      apiBase: options.apiBase ?? '',
      dbKind: options.dbKind ?? '',
    }),
  )

  return app
}

function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined
  return () => (p ??= fn())
}

export function createAppFromEnv() {
  const authToken = process.env.MCP_AUTH_TOKEN
  const dashboardPassword = process.env.DASHBOARD_PASSWORD
  if (!authToken || !dashboardPassword) throw new Error('MCP_AUTH_TOKEN, DASHBOARD_PASSWORD 가 필요하다')
  const env = readEnv()
  const dbUrl = process.env.TURSO_DATABASE_URL ?? 'file:local.db'
  // Vercel 의 파일 시스템은 쓸 수 없다. 로컬 파일로 조용히 떨어지지 않게 막는다.
  const openConfiguredDb = () => {
    if (process.env.VERCEL && dbUrl.startsWith('file:')) {
      return Promise.reject(new Error('TURSO_DATABASE_URL 이 설정되지 않았다. Vercel 에서는 로컬 파일 DB 를 쓸 수 없다'))
    }
    return openDb(dbUrl, process.env.TURSO_AUTH_TOKEN)
  }
  return createApp({
    authToken,
    dashboardPassword,
    api: createLetsApi(env),
    getDb: once(openConfiguredDb),
    apiBase: env.LETS_API_BASE,
    dbKind: dbUrl.startsWith('file:') ? '로컬 파일 (local.db)' : `Turso (${new URL(dbUrl.replace(/^libsql:/, 'https:')).host})`,
  })
}
