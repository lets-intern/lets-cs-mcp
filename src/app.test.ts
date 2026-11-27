import { describe, expect, it } from 'vitest'
import { saveSettings } from './store.js'
import { question, setup } from './test-helpers.js'

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

    expect(await names()).toEqual([
      'list_pending_questions',
      'get_question',
      'list_active_templates',
      'list_templates',
      'get_overview',
      'get_debug_summary',
      'list_debug_records',
      'list_replies',
    ])
    await saveSettings(db, { readOnly: false })
    const all = await names()
    for (const tool of ['reply_question', 'save_template', 'update_template', 'delete_template']) expect(all).toContain(tool)
  })

  it('문의 목록의 page 는 서버가 1부터 세므로 기본값이 1이고 0 은 거부한다', async () => {
    const { app, listCalls } = await setup()
    const call = async (args: unknown) =>
      (await (await app.fetch(rpc('tools/call', { name: 'list_pending_questions', arguments: args }, 'secret'))).json()).result
    await call({})
    expect(listCalls[0]?.page).toBe(1)
    await call({ page: 2 })
    expect(listCalls[1]?.page).toBe(2)
    const zero = await call({ page: 0 })
    expect(zero.isError).toBe(true)
    expect(listCalls).toHaveLength(2)
  })

  it('MCP 로 템플릿을 만들고 고치고 지운다. 자동 전송은 켤 수 없다', async () => {
    const { app, db } = await setup()
    const { saveSettings, getTemplate } = await import('./store.js')
    const call = async (name: string, args: unknown) => {
      const r = (await (await app.fetch(rpc('tools/call', { name, arguments: args }, 'secret'))).json()).result
      const text = r.content[0].text as string
      // 입력 검사나 없는 도구는 JSON 이 아닌 'MCP error ...' 문장으로 돌아온다
      return { isError: Boolean(r.isError), text, body: /^[[{]/.test(text) ? JSON.parse(text) : null }
    }

    // 읽기 전용일 때는 쓰기 도구가 없어서 호출이 실패한다
    const blocked = await call('save_template', { title: 'a', situation: 'b', body: 'c' })
    expect(blocked.isError).toBe(true)
    expect(blocked.text).toContain('not found')

    await saveSettings(db, { readOnly: false })
    const created = await call('save_template', {
      title: '환불', situation: '환불 문의', body: '가이드', validUntil: '2026-12-31', autoSend: true,
    })
    expect(created.isError).toBe(false)
    const id = created.body.template.id
    expect(created.body.template).toMatchObject({ title: '환불', autoSend: false, status: 'active', validUntil: '2026-12-31' })
    expect((await getTemplate(db, id))?.autoSend).toBe(false)

    const updated = await call('update_template', { id, body: '고친 가이드', validUntil: null, challengeId: 10 })
    expect(updated.body.template).toMatchObject({ body: '고친 가이드', validUntil: null, challengeId: 10, autoSend: false })

    expect((await call('update_template', { id, validFrom: '2026-12-05', validUntil: '2026-12-01' })).isError).toBe(true)
    expect((await call('update_template', { id: 9999, title: 'x' })).isError).toBe(true)
    expect((await call('save_template', { title: 'a', situation: 'b', body: 'c', validFrom: '12/05' })).isError).toBe(true)

    const off = await call('update_template', { id, enabled: false })
    expect(off.body.template.status).toBe('disabled')
    const all = await call('list_templates', {})
    expect(all.body).toHaveLength(1)
    const active = await call('list_active_templates', {})
    expect(active.body.templates).toHaveLength(0)

    expect((await call('delete_template', { id })).isError).toBe(false)
    expect((await call('list_templates', {})).body).toHaveLength(0)
  })

  it('AI 가 현황, 디버깅 경과, 기록을 스스로 읽을 수 있다. 모드는 읽기만 된다', async () => {
    const { app, db, deps } = await setup([question({ id: 1 }), question({ id: 2, userName: '김철수' })])
    const { saveSettings, createTemplate } = await import('./store.js')
    const { submitReply } = await import('./reply.js')
    const call = async (name: string, args: unknown) =>
      JSON.parse((await (await app.fetch(rpc('tools/call', { name, arguments: args }, 'secret'))).json()).result.content[0].text)

    await saveSettings(db, { readOnly: false })
    const t = await createTemplate(
      db,
      { title: '환불', situation: 's', body: '가이드', challengeId: null, validFrom: null, validUntil: null, autoSend: true, priority: 0 },
      new Date('2026-11-27T01:00:00Z'),
    )
    await submitReply(deps, { challengeId: 10, questionId: 1, body: '첫 답변', templateId: t.id, mode: 'send' })
    await submitReply(deps, { challengeId: 10, questionId: 2, body: '둘째 답변', mode: 'draft' })

    const overview = await call('get_overview', {})
    expect(overview).toMatchObject({ modes: { readOnly: false, debugMode: true, autoSendEnabled: false }, activeTemplates: 1, debugRecordsToday: 2 })

    const summary = await call('get_debug_summary', { days: 7 })
    expect(summary.total).toBe(2)
    expect(summary.byIntended).toEqual({ wouldAutoSend: 1, wouldBeDraft: 1 })
    expect(summary.byTemplate).toEqual(expect.arrayContaining([{ template: `#${t.id} 환불`, count: 1 }, { template: '템플릿 없이 작성', count: 1 }]))

    const records = await call('list_debug_records', {})
    expect(records.total).toBe(2)
    expect(records.records[0]).toMatchObject({ questionContent: '환불하고 싶어요', answer: expect.any(String), intended: expect.any(String) })
    const only = await call('list_debug_records', { templateId: t.id })
    expect(only.total).toBe(1)
    expect(only.records[0]).toMatchObject({ templateTitle: '환불', answer: '첫 답변', intended: 'send' })
    expect(JSON.stringify(records)).not.toContain('secret@x.com')
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

  it('상단에는 섹션, 왼쪽에는 그 섹션의 하위 메뉴가 놓인다', async () => {
    const { app } = await setup()
    const cookie = await login(app)
    const get = async (path: string) => {
      const res = await app.request(`http://dash.test${path}`, { headers: { cookie } })
      expect(res.status, path).toBe(200)
      return res.text()
    }

    const home = await get('/')
    for (const label of ['대시보드', '연결', '설정', '템플릿', '디버깅', '기록']) expect(home).toContain(`>${label}</a>`)
    expect(home).not.toContain('class="side"') // 하위 메뉴가 하나뿐인 섹션은 왼쪽 메뉴를 그리지 않는다
    expect(home).not.toContain('data-copy="secret"') // 첫 페이지에 키를 두지 않는다

    const connect = await get('/connect')
    expect(connect).toContain('class="side"')
    for (const label of ['서버 주소와 키', 'Claude 설정', '예약 실행 프롬프트']) expect(connect).toContain(`>${label}</a>`)
    expect(connect).toContain('http://dash.test/mcp')
    expect(connect).toContain('data-copy="secret"')

    const config = await get('/connect/config')
    expect(config).toContain('claude mcp add --transport http lets-cs http://dash.test/mcp')
    expect(await get('/connect/prompt')).toContain('lets-cs MCP 로 챌린지 문의를 처리한다')

    const mode = await get('/settings')
    expect(mode).toContain('읽기 전용 모드')
    expect(mode).toContain('디버깅 모드')
    expect(mode).toContain('읽기 전용 끄기')
    expect(await get('/settings/send')).toContain('하루 전송 상한')
    expect(await get('/settings/env')).toContain('http://lets.test')

    const templates = await get('/templates')
    expect(templates).toContain('>새 템플릿</a>')
    expect(await get('/templates/new')).toContain('새 템플릿 (답변 가이드)')
    for (const path of ['/debug', '/debug/records', '/log', '/log/drafts']) await get(path)
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

  it('디버깅 경과에 문의, 템플릿, 쓴 답변, 운영이었다면의 결과가 쌓여 보인다', async () => {
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

    const summary = await (await app.request('/debug', { headers: { cookie } })).text()
    expect(summary).toContain('<strong>1</strong>건') // 기록 1건
    expect(summary).toContain('운영이었다면 자동 전송')
    expect(summary).toContain('환불 안내')
    expect(summary).toContain('class="split"')
    expect(summary).toContain('class="bar"')
    expect(summary).not.toContain('자동 전송 후보가 하나도 없다') // 자동 전송 1건이 있으므로 안내가 없다
    expect(summary).toContain('유저에게는 아무것도 보내지 않았다')

    const records = await (await app.request('/debug/records', { headers: { cookie } })).text()
    expect(records).toContain('환불하고 싶어요')
    expect(records).toContain('템플릿: 환불 안내')
    expect(records).toContain('부분 환불만 가능합니다')
    expect(saved).toHaveLength(0)

    expect((await app.request('/debug?days=7', { headers: { cookie } })).status).toBe(200)
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
