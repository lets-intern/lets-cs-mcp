import { describe, expect, it } from 'vitest'
import { saveSettings } from './store.js'
import { setup } from './test-helpers.js'

const rpc = (method: string, params: unknown, token?: string) =>
  new Request('http://x/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })

describe('MCP 엔드포인트', () => {
  it('토큰이 없거나 틀리면 401', async () => {
    const { app } = await setup()
    expect((await app.fetch(rpc('tools/list', {}))).status).toBe(401)
    expect((await app.fetch(rpc('tools/list', {}, 'wrong'))).status).toBe(401)
  })

  it('읽기 전용이면 reply_question 도구가 없고, 꺼지면 생긴다', async () => {
    const { app, db } = await setup()
    const names = async () =>
      ((await (await app.fetch(rpc('tools/list', {}, 'secret'))).json()).result.tools as { name: string }[]).map((t) => t.name)

    expect(await names()).toEqual(['list_pending_questions', 'get_question', 'list_active_templates', 'list_replies'])
    await saveSettings(db, { readOnly: false })
    expect(await names()).toContain('reply_question')
  })

  it('문의를 읽을 때 이메일과 전화번호는 내보내지 않는다', async () => {
    const { app } = await setup()
    const res = await app.fetch(rpc('tools/call', { name: 'list_pending_questions', arguments: {} }, 'secret'))
    const text = (await res.json()).result.content[0].text as string
    expect(text).toContain('홍길동')
    expect(text).not.toContain('secret@x.com')
    expect(text).not.toContain('010-0000-0000')
  })
})

async function login(app: Awaited<ReturnType<typeof setup>>['app']) {
  const res = await app.request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'password=pw',
  })
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!
}

const form = (cookie: string, body: string, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
  body,
})

describe('대시보드', () => {
  it('로그인 전에는 로그인 화면으로 보내고, 틀린 비밀번호는 거부한다', async () => {
    const { app } = await setup()
    const res = await app.request('/')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/login')
    const bad = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=nope',
    })
    expect(bad.status).toBe(401)
  })

  it('로그인하면 MCP 주소, 키, 읽기 전용 버튼이 보인다', async () => {
    const { app } = await setup()
    const cookie = await login(app)
    const html = await (await app.request('http://dash.test/', { headers: { cookie } })).text()
    expect(html).toContain('http://dash.test/mcp')
    expect(html).toContain('data-copy="secret"')
    expect(html).toContain('읽기 전용 모드')
    expect(html).toContain('읽기 전용 끄기')
  })

  it('읽기 전용 버튼이 설정을 바꾼다', async () => {
    const { app, db } = await setup()
    const cookie = await login(app)
    const off = await app.request('/settings/read-only', form(cookie, 'value=0'))
    expect(await off.text()).toContain('읽기 전용 켜기')
    const { getSettings } = await import('./store.js')
    expect((await getSettings(db)).readOnly).toBe(false)
    await app.request('/settings/read-only', form(cookie, 'value=1'))
    expect((await getSettings(db)).readOnly).toBe(true)
  })

  it('템플릿을 만들고 끄고 지운다', async () => {
    const { app } = await setup()
    const cookie = await login(app)
    const created = await app.request(
      '/templates',
      form(cookie, 'title=환불&situation=환불 문의&body=안내&validUntil=2026-12-31&autoSend=on'),
    )
    const html = await created.text()
    expect(html).toContain('환불')
    expect(html).toContain('자동 전송')
    expect(html).toContain('~ 2026-12-31')

    const bad = await app.request('/templates', form(cookie, 'title=&situation=a&body=b'))
    expect(bad.status).toBe(400)
    const reversed = await app.request('/templates', form(cookie, 'title=a&situation=a&body=b&validFrom=2026-12-02&validUntil=2026-12-01'))
    expect(reversed.status).toBe(400)

    const toggled = await app.request('/templates/1/toggle', form(cookie, ''))
    expect(await toggled.text()).toContain('켜기')
    const del = await app.request('/templates/1', form(cookie, '', 'DELETE'))
    expect(del.status).toBe(200)
  })

  it('디버깅 모드 버튼이 설정을 바꾼다', async () => {
    const { app, db } = await setup()
    const { getSettings } = await import('./store.js')
    const cookie = await login(app)
    const home = await (await app.request('/', { headers: { cookie } })).text()
    expect(home).toContain('디버깅 모드')
    const off = await app.request('/settings/debug', form(cookie, 'value=0'))
    expect(await off.text()).toContain('디버깅 모드 켜기')
    expect((await getSettings(db)).debugMode).toBe(false)
    await app.request('/settings/debug', form(cookie, 'value=1'))
    expect((await getSettings(db)).debugMode).toBe(true)
  })

  it('디버깅 탭에 문의, 템플릿, 쓴 답변, 운영이었다면의 결과가 쌓여 보인다', async () => {
    const { app, deps, saved } = await setup()
    const { submitReply } = await import('./reply.js')
    const { createTemplate } = await import('./store.js')
    const cookie = await login(app)

    const empty = await (await app.request('/debug', { headers: { cookie } })).text()
    expect(empty).toContain('디버깅 기록이 없다')

    await saveSettings(deps.db, { readOnly: false })
    const t = await createTemplate(
      deps.db,
      { title: '환불 안내', situation: 's', body: '가이드', challengeId: null, validFrom: null, validUntil: null, autoSend: true, priority: 0 },
      new Date(),
    )
    await submitReply(deps, { challengeId: 10, questionId: 1, body: '부분 환불만 가능합니다', templateId: t.id, mode: 'send' })

    const page = await (await app.request('/debug', { headers: { cookie } })).text()
    expect(page).toContain('환불하고 싶어요')
    expect(page).toContain('템플릿: 환불 안내')
    expect(page).toContain('부분 환불만 가능합니다')
    expect(page).toContain('운영이었다면 자동 전송')
    expect(page).toContain('유저에게는 아무것도 보내지 않았다')
    expect(saved).toHaveLength(0)

    const week = await app.request('/debug?days=7', { headers: { cookie } })
    expect(week.status).toBe(200)
  })

  it('기록 화면에서 초안을 보낼 수 있다', async () => {
    const { app, deps, saved } = await setup()
    const { submitReply } = await import('./reply.js')
    await saveSettings(deps.db, { readOnly: false, debugMode: false })
    await submitReply(deps, { challengeId: 10, questionId: 1, body: '안내', mode: 'draft' })
    const cookie = await login(app)
    const log = await (await app.request('/log', { headers: { cookie } })).text()
    expect(log).toContain('초안')
    expect(log).toContain('>전송<')

    await saveSettings(deps.db, { debugMode: true })
    const blocked = await (await app.request('/log', { headers: { cookie } })).text()
    expect(blocked).not.toContain('>전송<')
    const refused = await app.request('/replies/1/send', form(cookie, ''))
    expect(await refused.text()).toContain('디버깅 모드라 유저에게 보낼 수 없다')
    expect(saved).toHaveLength(0)

    await saveSettings(deps.db, { debugMode: false })
    const sent = await app.request('/replies/1/send', form(cookie, ''))
    expect(await sent.text()).toContain('전송됨')
    expect(saved).toHaveLength(1)
  })
})
