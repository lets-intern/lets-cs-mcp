import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { safeEqual } from './auth.js'
import { todayKst } from './dates.js'
import { discardDraft, sendDraft, type Deps } from './reply.js'
import {
  countDrafts,
  countRepliesToday,
  createTemplate,
  deleteTemplate,
  getReply,
  getSettings,
  getTemplate,
  listActiveTemplates,
  listDebugRecords,
  listReplies,
  listTemplates,
  saveSettings,
  setTemplateEnabled,
  updateTemplate,
  type TemplateFields,
} from './store.js'
import {
  ConnectConfigPage,
  ConnectPage,
  DebugBox,
  DebugRecordsPage,
  DebugSummaryPage,
  HomePage,
  LoginPage,
  LogPage,
  LogRow,
  PromptPage,
  ReadOnlyBox,
  SettingsBox,
  SettingsEnvPage,
  SettingsModePage,
  SettingsSendPage,
  TemplateForm,
  TemplateItem,
  TemplatesNewPage,
  TemplatesPage,
} from './views.js'

const COOKIE = 'cs_session'
const WEEK = 7 * 24 * 60 * 60

export type DashboardDeps = {
  authToken: string
  dashboardPassword: string
  getDeps: () => Promise<Deps>
  apiBase: string
  dbKind: string
}

const dateOrNull = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const intOrNull = (v: unknown) => {
  const n = typeof v === 'string' ? parseInt(v, 10) : NaN
  return Number.isFinite(n) ? n : null
}

function parseTemplateForm(b: Record<string, unknown>): TemplateFields | null {
  const title = String(b.title ?? '').trim()
  const situation = String(b.situation ?? '').trim()
  const body = String(b.body ?? '').trim()
  if (!title || !situation || !body) return null
  const validFrom = dateOrNull(b.validFrom)
  const validUntil = dateOrNull(b.validUntil)
  if (validFrom && validUntil && validFrom > validUntil) return null
  return {
    title,
    situation,
    body,
    challengeId: intOrNull(b.challengeId),
    validFrom,
    validUntil,
    autoSend: b.autoSend === 'on',
    priority: intOrNull(b.priority) ?? 0,
  }
}

export function dashboard(d: DashboardDeps) {
  const app = new Hono()

  app.get('/login', (c) => c.html(<LoginPage />))

  app.post('/login', async (c) => {
    const body = await c.req.parseBody()
    if (!safeEqual(String(body.password ?? ''), d.dashboardPassword)) return c.html(<LoginPage error />, 401)
    const token = await sign({ exp: Math.floor(Date.now() / 1000) + WEEK }, d.authToken)
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: new URL(c.req.url).protocol === 'https:',
      path: '/',
      maxAge: WEEK,
    })
    return c.redirect('/')
  })

  app.post('/logout', (c) => {
    deleteCookie(c, COOKIE, { path: '/' })
    return c.redirect('/login')
  })

  app.use('*', async (c, next) => {
    const token = getCookie(c, COOKIE)
    const ok = token ? await verify(token, d.authToken, 'HS256').then(() => true, () => false) : false
    if (ok) return next()
    if (c.req.header('hx-request')) {
      c.header('HX-Redirect', '/login')
      return c.body(null, 401)
    }
    return c.redirect('/login')
  })

  app.get('/', async (c) => {
    const deps = await d.getDeps()
    const today = todayKst(deps.now())
    const settings = await getSettings(deps.db)
    const stats = {
      activeTemplates: (await listActiveTemplates(deps.db, today)).length,
      drafts: await countDrafts(deps.db),
      sentToday: await countRepliesToday(deps.db, today, 'sent'),
      debugToday: await countRepliesToday(deps.db, today, 'simulated'),
      maxSendPerDay: settings.maxSendPerDay,
    }
    return c.html(<HomePage stats={stats} settings={settings} />)
  })

  const origin = (c: Context) => new URL(c.req.url).origin

  app.get('/connect', (c) => c.html(<ConnectPage origin={origin(c)} token={d.authToken} />))
  app.get('/connect/config', (c) => c.html(<ConnectConfigPage origin={origin(c)} token={d.authToken} />))
  app.get('/connect/prompt', (c) => c.html(<PromptPage />))

  app.get('/settings', async (c) => {
    const { db } = await d.getDeps()
    return c.html(<SettingsModePage settings={await getSettings(db)} />)
  })
  app.get('/settings/send', async (c) => {
    const { db } = await d.getDeps()
    return c.html(<SettingsSendPage settings={await getSettings(db)} />)
  })
  app.get('/settings/env', (c) => c.html(<SettingsEnvPage apiBase={d.apiBase} dbKind={d.dbKind} />))

  app.post('/settings/read-only', async (c) => {
    const { db } = await d.getDeps()
    const body = await c.req.parseBody()
    await saveSettings(db, { readOnly: body.value === '1' })
    return c.html(<ReadOnlyBox readOnly={(await getSettings(db)).readOnly} />)
  })

  app.post('/settings/debug', async (c) => {
    const { db } = await d.getDeps()
    const body = await c.req.parseBody()
    await saveSettings(db, { debugMode: body.value === '1' })
    return c.html(<DebugBox debugMode={(await getSettings(db)).debugMode} />)
  })

  app.post('/settings', async (c) => {
    const { db } = await d.getDeps()
    const body = await c.req.parseBody()
    const max = Math.min(200, Math.max(1, intOrNull(body.maxSendPerDay) ?? 20))
    await saveSettings(db, {
      autoSendEnabled: body.autoSendEnabled === 'on',
      maxSendPerDay: max,
      answerFooter: String(body.answerFooter ?? ''),
    })
    return c.html(<SettingsBox settings={await getSettings(db)} saved />)
  })

  app.get('/templates', async (c) => {
    const { db, now } = await d.getDeps()
    return c.html(<TemplatesPage templates={await listTemplates(db)} today={todayKst(now())} />)
  })

  app.post('/templates', async (c) => {
    const { db, now } = await d.getDeps()
    const fields = parseTemplateForm(await c.req.parseBody())
    if (!fields) return c.body(null, 400)
    const t = await createTemplate(db, fields, now())
    return c.html(<TemplateItem t={t} today={todayKst(now())} />)
  })

  app.get('/templates/new', (c) => c.html(<TemplatesNewPage />))

  app.get('/templates/:id', async (c) => {
    const { db, now } = await d.getDeps()
    const t = await getTemplate(db, Number(c.req.param('id')))
    return t ? c.html(<TemplateItem t={t} today={todayKst(now())} />) : c.body(null, 404)
  })

  app.get('/templates/:id/edit', async (c) => {
    const { db } = await d.getDeps()
    const t = await getTemplate(db, Number(c.req.param('id')))
    return t ? c.html(<TemplateForm t={t} />) : c.body(null, 404)
  })

  app.put('/templates/:id', async (c) => {
    const { db, now } = await d.getDeps()
    const fields = parseTemplateForm(await c.req.parseBody())
    if (!fields) return c.body(null, 400)
    const t = await updateTemplate(db, Number(c.req.param('id')), fields, now())
    return t ? c.html(<TemplateItem t={t} today={todayKst(now())} />) : c.body(null, 404)
  })

  app.post('/templates/:id/toggle', async (c) => {
    const { db, now } = await d.getDeps()
    const id = Number(c.req.param('id'))
    const current = await getTemplate(db, id)
    if (!current) return c.body(null, 404)
    const t = await setTemplateEnabled(db, id, !current.enabled, now())
    return c.html(<TemplateItem t={t!} today={todayKst(now())} />)
  })

  app.delete('/templates/:id', async (c) => {
    const { db } = await d.getDeps()
    await deleteTemplate(db, Number(c.req.param('id')))
    return c.body('')
  })

  const debugWindow = async (c: Context) => {
    const { db, now } = await d.getDeps()
    const asked = Number(c.req.query('days'))
    const days = [7, 14, 30].includes(asked) ? asked : 14
    const since = todayKst(new Date(now().getTime() - (days - 1) * 24 * 60 * 60 * 1000))
    return { db, days, since, records: await listDebugRecords(db, since) }
  }

  app.get('/debug', async (c) => {
    const { db, days, since, records } = await debugWindow(c)
    return c.html(<DebugSummaryPage records={records} days={days} since={since} debugMode={(await getSettings(db)).debugMode} />)
  })

  app.get('/debug/records', async (c) => {
    const { days, since, records } = await debugWindow(c)
    return c.html(<DebugRecordsPage records={records} days={days} since={since} />)
  })

  const logPage = (path: '/log' | '/log/drafts') => async (c: Context) => {
    const { db } = await d.getDeps()
    const settings = await getSettings(db)
    const replies = await listReplies(db, 100, path === '/log/drafts' ? 'draft' : undefined)
    return c.html(<LogPage replies={replies} canSend={!settings.readOnly && !settings.debugMode} path={path} />)
  }
  app.get('/log', logPage('/log'))
  app.get('/log/drafts', logPage('/log/drafts'))

  app.post('/replies/:id/send', async (c) => {
    const deps = await d.getDeps()
    const id = Number(c.req.param('id'))
    const result = await sendDraft(deps, id)
    const reply = await getReply(deps.db, id)
    if (!reply) return c.body('')
    const settings = await getSettings(deps.db)
    return c.html(<LogRow r={reply} note={result.ok ? undefined : result.reason} canSend={!settings.readOnly && !settings.debugMode} />)
  })

  app.post('/replies/:id/discard', async (c) => {
    const deps = await d.getDeps()
    const id = Number(c.req.param('id'))
    await discardDraft(deps, id)
    const reply = await getReply(deps.db, id)
    return reply ? c.html(<LogRow r={reply} />) : c.body('')
  })

  return app
}
