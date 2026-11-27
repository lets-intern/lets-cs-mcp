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

  it('가상 전송 버튼과 미리보기, 가상 전송 기록의 사유가 보인다', async () => {
    const { app, deps } = await setup()
    const { submitReply } = await import('./reply.js')
    const { createTemplate } = await import('./store.js')
    const cookie = await login(app)

    const home = await (await app.request('/', { headers: { cookie } })).text()
    expect(home).toContain('가상 전송 모드')
    const off = await app.request('/settings/dry-run', form(cookie, 'value=0'))
    expect(await off.text()).toContain('가상 전송 켜기')
    await app.request('/settings/dry-run', form(cookie, 'value=1'))

    await saveSettings(deps.db, { readOnly: false, autoSendEnabled: true, answerFooter: '드림' })
    const t = await createTemplate(
      deps.db,
      { title: '환불', situation: 's', body: '{{userName}}님 {{challengeTitle}} 안내', challengeId: null, validFrom: null, validUntil: null, autoSend: true, priority: 0 },
      new Date(),
    )
    const preview = await (await app.request(`/templates/${t.id}/preview`, { headers: { cookie } })).text()
    expect(preview).toContain('홍길동님 샘플 챌린지 안내')
    expect(preview).toContain('드림')

    await submitReply(deps, { challengeId: 10, questionId: 1, body: '홍길동님 안내', templateId: t.id, mode: 'send' })
    const log = await (await app.request('/log', { headers: { cookie } })).text()
    expect(log).toContain('가상 전송')
    expect(log).toContain('실제 전송')
    expect(log).toContain(`사유: 자동 전송 조건 통과, 템플릿 #${t.id}`)
  })

  it('기록 화면에서 초안을 보낼 수 있다', async () => {
    const { app, deps, saved } = await setup()
    const { submitReply } = await import('./reply.js')
    await saveSettings(deps.db, { readOnly: false })
    await submitReply(deps, { challengeId: 10, questionId: 1, body: '안내', mode: 'draft' })
    const cookie = await login(app)
    const log = await (await app.request('/log', { headers: { cookie } })).text()
    expect(log).toContain('초안')
    const sent = await app.request('/replies/1/send', form(cookie, ''))
    expect(await sent.text()).toContain('전송됨')
    expect(saved).toHaveLength(1)
  })
})
