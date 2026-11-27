import type { Db } from './db.js'
import { todayKst } from './dates.js'
import type { LetsApi, Question } from './lets-api.js'
import {
  countRepliesToday,
  findOpenReply,
  getReply,
  getSettings,
  getTemplate,
  insertReply,
  templateStatus,
  updateReply,
} from './store.js'

export type Deps = { db: Db; api: LetsApi; now: () => Date }

export type ReplyResult =
  | { ok: true; status: 'draft' | 'simulated' | 'sent'; replyId: number; note?: string }
  | { ok: false; reason: string }

const fail = (reason: string): ReplyResult => ({ ok: false, reason })

const isAnswered = (q: Question) => q.answerStatus === 'COMPLETED' || Boolean(q.answer?.trim())

export const withFooter = (body: string, footer: string) => (footer.trim() ? `${body}\n\n${footer.trim()}` : body)

// 템플릿 본문의 {{변수}} 를 값으로 바꾼다. 값이 없는 변수는 그대로 둔다.
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => vars[key] ?? m)
}

export type SubmitInput = {
  challengeId: number
  questionId: number
  body: string
  templateId?: number
  mode: 'draft' | 'send'
}

// MCP 의 reply_question 이 부른다. 읽기 전용이면 아무것도 쓰지 않는다.
export async function submitReply(deps: Deps, input: SubmitInput): Promise<ReplyResult> {
  const { db, api, now } = deps
  const settings = await getSettings(db)
  if (settings.readOnly) return fail('읽기 전용 모드라 답변을 쓸 수 없다')

  const body = input.body.trim()
  if (!body) return fail('본문이 비어 있다')
  if (body.includes('{{')) return fail('치환되지 않은 {{변수}} 가 남아 있다')

  const open = await findOpenReply(db, input.questionId)
  if (open?.status === 'sent') return fail('이미 전송한 문의다')

  const question = await api.getQuestion(input.challengeId, input.questionId)
  if (isAnswered(question)) return fail('이미 답변이 달린 문의다')

  let effective: 'draft' | 'send' = input.mode
  let note: string | undefined
  if (effective === 'send') {
    const template = input.templateId ? await getTemplate(db, input.templateId) : null
    const today = todayKst(now())
    // 가상 전송 중에는 가상 전송 건수도 상한에 센다. 켰을 때 어떻게 될지 그대로 보여주려는 것이다.
    const used = await countRepliesToday(db, today, settings.dryRun ? 'simulated' : 'sent')
    if (!settings.autoSendEnabled) {
      effective = 'draft'
      note = '자동 전송이 꺼져 있어 초안으로 저장했다'
    } else if (!template) {
      effective = 'draft'
      note = 'templateId 가 없거나 템플릿을 찾지 못해 초안으로 저장했다'
    } else if (templateStatus(template, today) !== 'active') {
      effective = 'draft'
      note = '유효하지 않은 템플릿이라 초안으로 저장했다'
    } else if (template.challengeId !== null && template.challengeId !== input.challengeId) {
      effective = 'draft'
      note = '다른 챌린지용 템플릿이라 초안으로 저장했다'
    } else if (!template.autoSend) {
      effective = 'draft'
      note = '이 템플릿은 자동 전송이 허용되지 않아 초안으로 저장했다'
    } else if (used >= settings.maxSendPerDay) {
      effective = 'draft'
      note = '오늘 전송 상한에 도달해 초안으로 저장했다'
    }
  }

  const base = {
    questionId: input.questionId,
    challengeId: input.challengeId,
    templateId: input.templateId ?? null,
    error: null,
    userName: question.userName ?? null,
    questionTitle: question.title ?? null,
  }

  if (effective === 'draft') {
    const why = note ?? 'mode=draft 로 요청됨'
    const row = open
      ? await updateReply(db, open.id, { status: 'draft', body, templateId: input.templateId ?? null, note: why }, now())
      : await insertReply(db, { ...base, body, status: 'draft', note: why }, now())
    return { ok: true, status: 'draft', replyId: row.id, note }
  }

  const finalBody = withFooter(body, settings.answerFooter)

  if (settings.dryRun) {
    // 보내지 않는다. 실제로 나갔을 최종 문구(푸터 포함)를 그대로 남긴다.
    const why = `자동 전송 조건 통과, 템플릿 #${input.templateId}. 가상 전송이라 보내지 않음`
    const row = open
      ? await updateReply(db, open.id, { status: 'simulated', body: finalBody, templateId: input.templateId ?? null, note: why }, now())
      : await insertReply(db, { ...base, body: finalBody, status: 'simulated', note: why }, now())
    return { ok: true, status: 'simulated', replyId: row.id, note: '가상 전송 모드라 실제로는 보내지 않고 기록만 했다' }
  }

  try {
    await api.saveAnswer(input.challengeId, input.questionId, finalBody)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (!open) await insertReply(db, { ...base, body, status: 'failed', error, note: '렛츠 API 호출 실패' }, now())
    return fail(`전송 실패: ${error}`)
  }
  const row = open
    ? await updateReply(db, open.id, { status: 'sent', body: finalBody, note: `자동 전송, 템플릿 #${input.templateId}` }, now())
    : await insertReply(db, { ...base, body: finalBody, status: 'sent', note: `자동 전송, 템플릿 #${input.templateId}` }, now())
  return { ok: true, status: 'sent', replyId: row.id }
}

// 대시보드에서 사람이 초안이나 가상 전송 기록을 실제로 보낼 때.
// 자동 전송 조건은 보지 않지만 읽기 전용과 이미 답변된 문의는 막는다.
export async function sendDraft(deps: Deps, replyId: number): Promise<ReplyResult> {
  const { db, api, now } = deps
  const settings = await getSettings(db)
  if (settings.readOnly) return fail('읽기 전용 모드라 보낼 수 없다')

  const reply = await getReply(db, replyId)
  if (!reply || (reply.status !== 'draft' && reply.status !== 'simulated')) return fail('보낼 수 있는 기록이 아니다')

  const question = await api.getQuestion(reply.challengeId, reply.questionId)
  if (isAnswered(question)) return fail('그 사이 답변이 달렸다. 기록을 버려야 한다')

  // 가상 전송 기록은 푸터가 이미 붙어 있다.
  const payload = reply.status === 'simulated' ? reply.body : withFooter(reply.body, settings.answerFooter)
  try {
    await api.saveAnswer(reply.challengeId, reply.questionId, payload)
  } catch (e) {
    return fail(`전송 실패: ${e instanceof Error ? e.message : String(e)}`)
  }
  const row = await updateReply(db, reply.id, { status: 'sent', body: payload, note: '대시보드에서 사람이 전송' }, now())
  return { ok: true, status: 'sent', replyId: row.id }
}

export async function discardDraft(deps: Deps, replyId: number): Promise<boolean> {
  const reply = await getReply(deps.db, replyId)
  if (!reply || (reply.status !== 'draft' && reply.status !== 'simulated')) return false
  await updateReply(deps.db, reply.id, { status: 'discarded' }, deps.now())
  return true
}
