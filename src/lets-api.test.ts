import { describe, expect, it } from 'vitest'
import { createLetsApi } from './lets-api.js'

const env = { LETS_API_BASE: 'http://lets.test', LETS_ADMIN_EMAIL: 'a@b.c', LETS_ADMIN_PASSWORD: 'pw' }

describe('렛츠 API 클라이언트', () => {
  it('로그인 후 WAITING 문의를 조회한다', async () => {
    const calls: string[] = []
    const f = (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`)
      if (url.endsWith('/signin')) return Response.json({ status: 200, data: { accessToken: 't' } })
      return Response.json({ status: 200, data: { questionList: [] } })
    }) as unknown as typeof fetch
    await createLetsApi(env, f).listQuestions({ answerStatus: 'WAITING' })
    expect(calls[0]).toBe('POST http://lets.test/api/v2/user/signin')
    expect(calls[1]).toContain('/api/v2/admin/challenge/questions?answerStatus=WAITING')
  })

  it('401 이면 한 번 다시 로그인해서 재시도한다', async () => {
    let logins = 0
    let hits = 0
    const f = (async (url: string) => {
      if (url.endsWith('/signin')) {
        logins++
        return Response.json({ status: 200, data: { accessToken: `t${logins}` } })
      }
      hits++
      return hits === 1 ? new Response('', { status: 401 }) : Response.json({ status: 200, data: { ok: 1 } })
    }) as unknown as typeof fetch
    const res = await createLetsApi(env, f).getQuestion(1, 2)
    expect(res).toEqual({ ok: 1 })
    expect(logins).toBe(2)
  })

  it('답변 저장은 PATCH answer 로 보내고 빈 응답도 받는다', async () => {
    let sent: { url: string; body: string } | null = null
    const f = (async (url: string, init: RequestInit) => {
      if (url.endsWith('/signin')) return Response.json({ status: 200, data: { accessToken: 't' } })
      sent = { url, body: String(init.body) }
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch
    await createLetsApi(env, f).saveAnswer(10, 5, '안녕하세요')
    expect(sent).toEqual({
      url: 'http://lets.test/api/v2/admin/challenge/10/questions/5/answer',
      body: JSON.stringify({ answer: '안녕하세요' }),
    })
  })
})
