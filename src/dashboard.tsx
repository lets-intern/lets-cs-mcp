import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { safeEqual } from './auth.js'
import { sinceKst, todayKst } from './dates.js'
import { discardDraft, sendDraft, type Deps } from './reply.js'
import {
  countDrafts,
  countRepliesToday,
  createPolicyDoc,
  createTemplate,
  deletePolicyDoc,
  deleteTemplate,
  existingPolicyIds,
  getReply,
  getDbCreatedAt,
  getPolicyDoc,
  getPolicyRevision,
  getSettings,
  getTemplate,
  listActiveTemplates,
  listDebugRecords,
  listPolicyDocs,
  listPolicyRevisions,
  listReplies,
  listTemplates,
  policyUsage,
  saveSettings,
  setPolicyEnabled,
  setTemplateEnabled,
  updatePolicyDoc,
  updateTemplate,
  type PolicyFields,
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
  PoliciesNewPage,
  PoliciesPage,
  PolicyForm,
  PolicyHistory,
  PolicyItem,
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
  WorkflowDocPage,
  WorkflowPage,
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
    policyIds: String(b.policyIds ?? '').split(',').map((v) => parseInt(v, 10)).filter((n) => Number.isInteger(n) && n > 0),
  }
}

function parsePolicyForm(b: Record<string, unknown>): PolicyFields | null {
  const title = String(b.title ?? '').trim()
  const body = String(b.body ?? '').trim()
  if (!title || !body) return null
  const sourceUrl = String(b.sourceUrl ?? '').trim()
  return {
    title,
    body,
    summary: String(b.summary ?? '').trim(),
    appliesWhen: String(b.appliesWhen ?? '').trim(),
    tags: String(b.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    owner: String(b.owner ?? '').trim(),
    // javascript: 같은 주소가 링크로 나가지 않게 http(s) 만 받는다
    sourceUrl: /^https?:\/\//.test(sourceUrl) ? sourceUrl : '',
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
  app.get('/settings/env', async (c) => {
    const { db } = await d.getDeps()
    return c.html(<SettingsEnvPage apiBase={d.apiBase} dbKind={d.dbKind} dbCreatedAt={await getDbCreatedAt(db)} />)
  })

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
    fields.policyIds = await existingPolicyIds(db, fields.policyIds ?? [])
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
    fields.policyIds = await existingPolicyIds(db, fields.policyIds ?? [])
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

  app.get('/policies', async (c) => {
    const { db } = await d.getDeps()
    return c.html(<PoliciesPage policies={await listPolicyDocs(db, true)} />)
  })

  app.get('/policies/new', (c) => c.html(<PoliciesNewPage />))

  app.post('/policies', async (c) => {
    const { db, now } = await d.getDeps()
    const fields = parsePolicyForm(await c.req.parseBody())
    if (!fields) return c.body(null, 400)
    return c.html(<PolicyItem p={await createPolicyDoc(db, fields, '사람', now())} />)
  })

  app.get('/policies/:id', async (c) => {
    const { db } = await d.getDeps()
    const p = await getPolicyDoc(db, Number(c.req.param('id')))
    return p ? c.html(<PolicyItem p={p} />) : c.body(null, 404)
  })

  app.get('/policies/:id/edit', async (c) => {
    const { db } = await d.getDeps()
    const p = await getPolicyDoc(db, Number(c.req.param('id')))
    return p ? c.html(<PolicyForm p={p} />) : c.body(null, 404)
  })

  app.put('/policies/:id', async (c) => {
    const { db, now } = await d.getDeps()
    const fields = parsePolicyForm(await c.req.parseBody())
    if (!fields) return c.body(null, 400)
    const p = await updatePolicyDoc(db, Number(c.req.param('id')), fields, '사람', '대시보드에서 수정', now())
    return p ? c.html(<PolicyItem p={p} />) : c.body(null, 404)
  })

  app.post('/policies/:id/toggle', async (c) => {
    const { db, now } = await d.getDeps()
    const id = Number(c.req.param('id'))
    const cur = await getPolicyDoc(db, id)
    if (!cur) return c.body(null, 404)
    return c.html(<PolicyItem p={(await setPolicyEnabled(db, id, !cur.enabled, '사람', now()))!} />)
  })

  app.delete('/policies/:id', async (c) => {
    const { db } = await d.getDeps()
    await deletePolicyDoc(db, Number(c.req.param('id')))
    return c.body('')
  })

  app.get('/policies/:id/history', async (c) => {
    const { db } = await d.getDeps()
    const id = Number(c.req.param('id'))
    const p = await getPolicyDoc(db, id)
    return p ? c.html(<PolicyHistory p={p} revisions={await listPolicyRevisions(db, id)} />) : c.body(null, 404)
  })

  app.post('/policies/:id/restore/:revId', async (c) => {
    const { db, now } = await d.getDeps()
    const id = Number(c.req.param('id'))
    const rev = await getPolicyRevision(db, Number(c.req.param('revId')))
    if (!rev || rev.docId !== id) return c.body(null, 404)
    const p = await updatePolicyDoc(
      db,
      id,
      { title: rev.title, summary: rev.summary, appliesWhen: rev.appliesWhen, tags: rev.tags, body: rev.body },
      '사람',
      `이력 #${rev.id} 로 되돌림`,
      now(),
    )
    return p ? c.html(<PolicyItem p={p} />) : c.body(null, 404)
  })

  app.get('/workflow', async (c) => {
    const { db, now } = await d.getDeps()
    const settings = await getSettings(db)
    const latest = (await listDebugRecords(db, '2000-01-01', 1))[0]
    return c.html(
      <WorkflowPage
        settings={settings}
        lastRecordAt={latest?.updatedAt ?? null}
        todayCount={await countRepliesToday(db, todayKst(now()), 'simulated')}
      />,
    )
  })

  app.get('/workflow/doc', async (c) => {
    const { db } = await d.getDeps()
    return c.html(<WorkflowDocPage settings={await getSettings(db)} />)
  })

  const debugWindow = async (c: Context) => {
    const { db, now } = await d.getDeps()
    const asked = Number(c.req.query('days'))
    const days = [7, 14, 30].includes(asked) ? asked : 14
    const since = sinceKst(now(), days)
    return { db, days, since, records: await listDebugRecords(db, since) }
  }

  app.get('/debug', async (c) => {
    const { db, days, since, records } = await debugWindow(c)
    const policies = policyUsage(records, await listPolicyDocs(db))
    return c.html(<DebugSummaryPage records={records} days={days} since={since} debugMode={(await getSettings(db)).debugMode} policies={policies} />)
  })

  app.get('/debug/records', async (c) => {
    const { db, days, since, records } = await debugWindow(c)
    const policyTitles = Object.fromEntries((await listPolicyDocs(db, true)).map((p) => [p.id, p.title]))
    return c.html(<DebugRecordsPage records={records} days={days} since={since} policyTitles={policyTitles} />)
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
