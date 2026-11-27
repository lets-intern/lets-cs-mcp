import type { Db } from './db.js'
import { todayKst } from './dates.js'
import type { LetsApi, Question } from './lets-api.js'
import {
  countIntendedSendToday,
  countRepliesToday,
  findOpenReply,
  getReply,
  getSettings,
  getTemplate,
  insertReply,
  templateStatus,
  updateReply,
  type Template,
} from './store.js'

export type Deps = { db: Db; api: LetsApi; now: () => Date }

export type ReplyResult =
  | { ok: true; status: 'draft' | 'simulated' | 'sent'; replyId: number; note?: string }
  | { ok: false; reason: string }

const fail = (reason: string): ReplyResult => ({ ok: false, reason })

const isAnswered = (q: Question) => q.answerStatus === 'COMPLETED' || Boolean(q.answer?.trim())

export const withFooter = (body: string, footer: string) => (footer.trim() ? `${body}\n\n${footer.trim()}` : body)

// 유저에게 답변이 나가는 유일한 통로다. 디버깅 모드에서는 어떤 호출도 여기서 막힌다.
// 설정을 보내기 직전에 다시 읽어서, 호출한 쪽이 들고 있던 값이 오래됐어도 막는다.
async function deliverAnswer(deps: Deps, challengeId: number, questionId: number, answer: string): Promise<void> {
  const { debugMode } = await getSettings(deps.db)
  if (debugMode) throw new Error('디버깅 모드에서는 유저에게 답변을 보낼 수 없다')
  await deps.api.saveAnswer(challengeId, questionId, answer)
}

export type SubmitInput = {
  challengeId: number
  questionId: number
  body: string
  templateId?: number
  mode: 'draft' | 'send'
}

type Decision = { intended: 'draft' | 'send'; reason?: string }

// 이 답변이 운영에서 어떻게 처리될지 정한다. 디버깅 모드에서도 같은 기준으로 판단해 기록에 남긴다.
async function decide(
  deps: Deps,
  input: SubmitInput,
  template: Template | null,
  settings: Awaited<ReturnType<typeof getSettings>>,
): Promise<Decision> {
  if (input.mode === 'draft') return { intended: 'draft', reason: 'mode=draft 로 요청됨' }
  const today = todayKst(deps.now())
  // 디버깅 중에는 전역 자동 전송 스위치가 꺼져 있어도 켜졌다고 가정하고 템플릿 단위 판단을 본다.
  if (!settings.autoSendEnabled && !settings.debugMode) return { intended: 'draft', reason: '자동 전송이 꺼져 있다' }
  if (!template) return { intended: 'draft', reason: 'templateId 가 없거나 템플릿을 찾지 못했다' }
  if (templateStatus(template, today) !== 'active') return { intended: 'draft', reason: '유효하지 않은 템플릿이다' }
  if (template.challengeId !== null && template.challengeId !== input.challengeId) {
    return { intended: 'draft', reason: '다른 챌린지용 템플릿이다' }
  }
  if (!template.autoSend) return { intended: 'draft', reason: '이 템플릿은 자동 전송이 허용되지 않는다' }
  const used = settings.debugMode
    ? await countIntendedSendToday(deps.db, today)
    : await countRepliesToday(deps.db, today, 'sent')
  if (used >= settings.maxSendPerDay) return { intended: 'draft', reason: '오늘 전송 상한에 도달했다' }
  return { intended: 'send' }
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

  const template = input.templateId ? await getTemplate(db, input.templateId) : null
  const { intended, reason } = await decide(deps, input, template, settings)

  const base = {
    questionId: input.questionId,
    challengeId: input.challengeId,
    templateId: input.templateId ?? null,
    error: null,
    userName: question.userName ?? null,
    questionTitle: question.title ?? null,
    questionContent: question.content ?? null,
    challengeTitle: question.challengeTitle ?? null,
    templateTitle: template?.title ?? null,
    intended,
  }
  const upsert = async (status: 'draft' | 'simulated' | 'sent', text: string, note: string) =>
    open
      ? updateReply(
          db,
          open.id,
          { status, body: text, templateId: input.templateId ?? null, templateTitle: template?.title ?? null, intended, note },
          now(),
        )
      : insertReply(db, { ...base, status, body: text, note }, now())

  const finalBody = intended === 'send' ? withFooter(body, settings.answerFooter) : body

  if (settings.debugMode) {
    // 유저에게는 보내지 않는다. 문의와 템플릿, 쓴 답변, 운영이었다면 어떻게 됐을지를 남긴다.
    const note =
      intended === 'send'
        ? `운영이었다면 자동 전송 (템플릿 #${input.templateId}). 디버깅 모드라 보내지 않음`
        : `운영이었다면 초안: ${reason}`
    const row = await upsert('simulated', finalBody, note)
    return { ok: true, status: 'simulated', replyId: row.id, note: '디버깅 모드라 유저에게 보내지 않고 기록만 했다' }
  }

  if (intended === 'draft') {
    const row = await upsert('draft', body, reason ?? '')
    return { ok: true, status: 'draft', replyId: row.id, note: reason ? `${reason}. 초안으로 저장했다` : undefined }
  }

  try {
    await deliverAnswer(deps, input.challengeId, input.questionId, finalBody)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (!open) await insertReply(db, { ...base, status: 'failed', body, error, note: '렛츠 API 호출 실패' }, now())
    return fail(`전송 실패: ${error}`)
  }
  const row = await upsert('sent', finalBody, `자동 전송, 템플릿 #${input.templateId}`)
  return { ok: true, status: 'sent', replyId: row.id }
}

// 대시보드에서 사람이 초안을 실제로 보낼 때. 자동 전송 조건은 보지 않지만
// 읽기 전용, 디버깅 모드, 이미 답변된 문의는 막는다. 디버깅 기록은 보낼 수 없다.
export async function sendDraft(deps: Deps, replyId: number): Promise<ReplyResult> {
  const { db, api, now } = deps
  const settings = await getSettings(db)
  if (settings.readOnly) return fail('읽기 전용 모드라 보낼 수 없다')
  if (settings.debugMode) return fail('디버깅 모드라 유저에게 보낼 수 없다')

  const reply = await getReply(db, replyId)
  if (!reply || reply.status !== 'draft') return fail('보낼 수 있는 초안이 아니다')

  const question = await api.getQuestion(reply.challengeId, reply.questionId)
  if (isAnswered(question)) return fail('그 사이 답변이 달렸다. 초안을 버려야 한다')

  const payload = withFooter(reply.body, settings.answerFooter)
  try {
    await deliverAnswer(deps, reply.challengeId, reply.questionId, payload)
  } catch (e) {
    return fail(`전송 실패: ${e instanceof Error ? e.message : String(e)}`)
  }
  const row = await updateReply(db, reply.id, { status: 'sent', body: payload, note: '대시보드에서 사람이 전송' }, now())
  return { ok: true, status: 'sent', replyId: row.id }
}

export async function discardDraft(deps: Deps, replyId: number): Promise<boolean> {
  const reply = await getReply(deps.db, replyId)
  if (!reply || reply.status !== 'draft') return false
  await updateReply(deps.db, reply.id, { status: 'discarded' }, deps.now())
  return true
}
