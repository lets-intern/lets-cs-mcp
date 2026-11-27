import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { todayKst } from './dates.js'
import type { Question } from './lets-api.js'
import { submitReply, type Deps } from './reply.js'
import {
  createTemplate,
  deleteTemplate,
  getSettings,
  getTemplate,
  listActiveTemplates,
  listReplies,
  listTemplates,
  setTemplateEnabled,
  templateStatus,
  updateTemplate,
  type Template,
} from './store.js'

const asText = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
})

// 이메일, 전화번호, 희망 직무 같은 개인정보는 Claude 로 내보내지 않는다. 답변에 필요한 값만 남긴다.
export function pickQuestion(q: Question) {
  return {
    id: q.id,
    answerStatus: q.answerStatus,
    title: q.title,
    content: q.content,
    answer: q.answer,
    challengeId: q.challengeId,
    challengeTitle: q.challengeTitle,
    userName: q.userName,
    challengePricePlanType: q.challengePricePlanType,
    imageUrls: q.imageUrls,
    createDate: q.createDate,
  }
}

function describeTemplate(t: Template, today: string) {
  return {
    id: t.id,
    title: t.title,
    situation: t.situation,
    body: t.body,
    challengeId: t.challengeId,
    validFrom: t.validFrom,
    validUntil: t.validUntil,
    status: templateStatus(t, today),
    autoSend: t.autoSend,
    priority: t.priority,
  }
}

export async function createMcpServer(deps: Deps) {
  const { db, api, now } = deps
  const settings = await getSettings(db)
  const server = new McpServer({ name: 'lets-cs-mcp', version: '0.2.0' })

  server.registerTool(
    'list_pending_questions',
    {
      description: '챌린지 1:1 문의 목록을 읽는다. 기본은 아직 답변이 없는 문의(WAITING)이다.',
      inputSchema: {
        challengeId: z.number().int().optional().describe('비우면 모든 챌린지'),
        answerStatus: z.enum(['WAITING', 'COMPLETED']).default('WAITING'),
        page: z.number().int().min(1).default(1).describe('1부터 시작한다. 서버가 1-based 라서 0 과 1 은 같은 첫 페이지다'),
        size: z.number().int().min(1).max(50).default(20),
      },
    },
    async (args) => {
      const list = await api.listQuestions(args)
      return asText({ questionList: list.questionList.map(pickQuestion), pageInfo: list.pageInfo })
    },
  )

  server.registerTool(
    'get_question',
    {
      description: '챌린지 문의 한 건을 읽는다. 이미 답변이 달렸는지 확인할 때도 쓴다.',
      inputSchema: { challengeId: z.number().int(), questionId: z.number().int() },
    },
    async ({ challengeId, questionId }) => asText(pickQuestion(await api.getQuestion(challengeId, questionId))),
  )

  server.registerTool(
    'list_active_templates',
    {
      description:
        '오늘 유효한 답변 템플릿(가이드)을 읽는다. 기간이 지났거나 꺼진 템플릿은 나오지 않는다. ' +
        '템플릿 body 는 유저에게 그대로 보내는 문구가 아니라, 문의 내용에 맞춰 답변을 직접 쓸 때 참고하는 가이드다. ' +
        '응답의 readOnly 가 true 면 답변을 쓸 수 없고, debugMode 가 true 면 답변이 유저에게 가지 않고 기록만 된다.',
      inputSchema: { challengeId: z.number().int().optional().describe('주면 그 챌린지용과 전체용만') },
    },
    async ({ challengeId }) => {
      const today = todayKst(now())
      const templates = await listActiveTemplates(db, today, challengeId)
      return asText({
        today,
        readOnly: settings.readOnly,
        debugMode: settings.debugMode,
        autoSendEnabled: settings.autoSendEnabled,
        templates: templates.map((t) => ({
          id: t.id,
          title: t.title,
          situation: t.situation,
          body: t.body,
          challengeId: t.challengeId,
          validFrom: t.validFrom,
          validUntil: t.validUntil,
          autoSend: t.autoSend,
          priority: t.priority,
        })),
      })
    },
  )

  server.registerTool(
    'list_templates',
    {
      description:
        '등록된 모든 템플릿을 읽는다. 만료됐거나 꺼진 것도 포함하고 status(active, disabled, upcoming, expired)로 구분한다. 템플릿을 관리할 때 쓴다. 답변을 쓸 때는 list_active_templates 를 쓴다.',
      inputSchema: {},
    },
    async () => {
      const today = todayKst(now())
      return asText((await listTemplates(db)).map((t) => describeTemplate(t, today)))
    },
  )

  server.registerTool(
    'list_replies',
    {
      description: '최근 답변 기록(초안, 전송됨, 실패)을 읽는다.',
      inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
    },
    async ({ limit }) => asText(await listReplies(db, limit)),
  )

  // 읽기 전용이면 쓰기 도구를 아예 등록하지 않는다.
  if (!settings.readOnly) {
    const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 한다')
    const templateNote =
      '템플릿 body 는 유저에게 그대로 보내는 문구가 아니라 답변을 쓸 때 참고하는 가이드다. ' +
      '자동 전송 허용(autoSend)은 여기서 켜거나 바꿀 수 없다. 사람이 대시보드에서만 정한다. ' +
      '기간을 비우면 계속 유효하고, 종료일은 그날 끝까지 유효하다.'

    server.registerTool(
      'save_template',
      {
        description: `새 답변 템플릿을 만든다. ${templateNote} 만든 템플릿은 autoSend 가 꺼진 상태다.`,
        inputSchema: {
          title: z.string().min(1).describe('상황 이름. 예: 환불 문의'),
          situation: z.string().min(1).describe('이 가이드를 쓸 상황 설명. 답변할 때 이 설명을 보고 고른다'),
          body: z.string().min(1).describe('답변 가이드'),
          challengeId: z.number().int().optional().describe('비우면 모든 챌린지'),
          validFrom: dateField.optional().describe('시작일. 비우면 처음부터'),
          validUntil: dateField.optional().describe('종료일. 비우면 계속'),
          priority: z.number().int().default(0).describe('클수록 먼저 보인다'),
        },
      },
      async (a) => {
        if (a.validFrom && a.validUntil && a.validFrom > a.validUntil) return asText({ ok: false, reason: '시작일이 종료일보다 늦다' }, true)
        const t = await createTemplate(
          db,
          {
            title: a.title.trim(),
            situation: a.situation.trim(),
            body: a.body.trim(),
            challengeId: a.challengeId ?? null,
            validFrom: a.validFrom ?? null,
            validUntil: a.validUntil ?? null,
            autoSend: false,
            priority: a.priority,
          },
          now(),
        )
        return asText({ ok: true, template: describeTemplate(t, todayKst(now())) })
      },
    )

    server.registerTool(
      'update_template',
      {
        description: `템플릿을 고친다. 준 항목만 바뀐다. challengeId, validFrom, validUntil 은 null 을 주면 비운다. ${templateNote}`,
        inputSchema: {
          id: z.number().int(),
          title: z.string().min(1).optional(),
          situation: z.string().min(1).optional(),
          body: z.string().min(1).optional(),
          challengeId: z.number().int().nullable().optional(),
          validFrom: dateField.nullable().optional(),
          validUntil: dateField.nullable().optional(),
          priority: z.number().int().optional(),
          enabled: z.boolean().optional().describe('false 면 끈다. 켜 두면 기간 안에서만 쓰인다'),
        },
      },
      async (a) => {
        const cur = await getTemplate(db, a.id)
        if (!cur) return asText({ ok: false, reason: '그 id 의 템플릿이 없다' }, true)
        const next = {
          title: a.title?.trim() ?? cur.title,
          situation: a.situation?.trim() ?? cur.situation,
          body: a.body?.trim() ?? cur.body,
          challengeId: a.challengeId === undefined ? cur.challengeId : a.challengeId,
          validFrom: a.validFrom === undefined ? cur.validFrom : a.validFrom,
          validUntil: a.validUntil === undefined ? cur.validUntil : a.validUntil,
          autoSend: cur.autoSend, // 자동 전송 여부는 사람만 바꾼다
          priority: a.priority ?? cur.priority,
        }
        if (next.validFrom && next.validUntil && next.validFrom > next.validUntil) {
          return asText({ ok: false, reason: '시작일이 종료일보다 늦다' }, true)
        }
        let t = (await updateTemplate(db, a.id, next, now()))!
        if (a.enabled !== undefined) t = (await setTemplateEnabled(db, a.id, a.enabled, now()))!
        return asText({ ok: true, template: describeTemplate(t, todayKst(now())) })
      },
    )

    server.registerTool(
      'delete_template',
      {
        description: '템플릿을 지운다. 지운 템플릿은 되돌릴 수 없다. 잠시 쓰지 않으려면 update_template 로 enabled=false 를 준다.',
        inputSchema: { id: z.number().int() },
      },
      async ({ id }) => {
        if (!(await getTemplate(db, id))) return asText({ ok: false, reason: '그 id 의 템플릿이 없다' }, true)
        await deleteTemplate(db, id)
        return asText({ ok: true })
      },
    )

    server.registerTool(
      'reply_question',
      {
        description:
          '문의에 답변한다. body 는 문의 내용에 맞춰 직접 쓴 최종 답변이다. 템플릿 문구를 그대로 복사하지 말고 ' +
          '가이드를 참고해 그 문의에 맞게 쓴다. 참고한 템플릿의 id 를 templateId 로 넣는다. ' +
          "mode 'send' 는 전역 자동 전송이 켜져 있고 템플릿이 autoSend 이고 유효할 때만 실제로 전송되고, 아니면 초안으로 저장된다. " +
          '디버깅 모드(debugMode)가 켜져 있으면 어떤 경우에도 유저에게 보내지 않고, 문의와 템플릿과 답변을 status 가 simulated 인 기록으로 남긴다. ' +
          '이미 답변이 달린 문의나 이미 전송한 문의는 거부된다.',
        inputSchema: {
          challengeId: z.number().int(),
          questionId: z.number().int(),
          body: z.string().min(1),
          templateId: z.number().int().optional().describe('참고한 템플릿. 디버깅 기록과 send 판단에 쓴다'),
          mode: z.enum(['draft', 'send']).default('draft'),
        },
      },
      async (args) => {
        const result = await submitReply(deps, args)
        return asText(result, !result.ok)
      },
    )
  }

  return server
}
