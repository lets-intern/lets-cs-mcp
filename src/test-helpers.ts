import { createApp } from './app.js'
import { openDb, type Db } from './db.js'
import type { LetsApi, Question } from './lets-api.js'

export const NOW = new Date('2026-11-27T01:00:00Z') // KST 2026-11-27 10:00

export function question(over: Partial<Question> = {}): Question {
  return {
    id: 1,
    answerStatus: 'WAITING',
    title: '환불 문의',
    content: '환불하고 싶어요',
    answer: null,
    isVisible: true,
    challengeId: 10,
    challengeTitle: '11월 챌린지',
    userName: '홍길동',
    createDate: '2026-11-26T09:00:00',
    ...over,
    // 서버는 이메일과 전화번호도 내려준다. MCP 가 걸러내는지 확인하려고 넣는다.
    ...({ email: 'secret@x.com', phoneNum: '010-0000-0000' } as object),
  } as Question
}

export function fakeApi(initial: Question[]) {
  const questions = new Map(initial.map((q) => [q.id, q]))
  const saved: { challengeId: number; questionId: number; answer: string }[] = []
  const listCalls: { page?: number; size?: number; answerStatus?: string }[] = []
  const api = {
    async listQuestions(p: { answerStatus?: string; page?: number; size?: number }) {
      listCalls.push(p)
      const list = [...questions.values()].filter((q) => !p.answerStatus || q.answerStatus === p.answerStatus)
      return { questionList: list, pageInfo: { totalElements: list.length } }
    },
    async getQuestion(_c: number, id: number) {
      const q = questions.get(id)
      if (!q) throw new Error('404')
      return q
    },
    async saveAnswer(challengeId: number, questionId: number, answer: string) {
      saved.push({ challengeId, questionId, answer })
      return null
    },
  } as unknown as LetsApi
  return { api, saved, questions, listCalls }
}

export async function setup(initial: Question[] = [question()]) {
  const db: Db = await openDb(':memory:')
  const f = fakeApi(initial)
  const deps = { db, api: f.api, now: () => NOW }
  const app = createApp({
    authToken: 'secret',
    dashboardPassword: 'pw',
    api: f.api,
    getDb: async () => db,
    now: () => NOW,
    apiBase: 'http://lets.test',
    dbKind: 'test',
  })
  return { db, deps, app, ...f }
}
