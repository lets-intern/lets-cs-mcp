import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { todayKst } from './dates.js'
import type { Question } from './lets-api.js'
import { submitReply, type Deps } from './reply.js'
import { getSettings, listActiveTemplates, listReplies } from './store.js'

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
        page: z.number().int().min(0).default(0),
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
        '오늘 유효한 답변 템플릿을 읽는다. 기간이 지났거나 꺼진 템플릿은 나오지 않는다. 응답의 readOnly 가 true 면 답변을 쓸 수 없다.',
      inputSchema: { challengeId: z.number().int().optional().describe('주면 그 챌린지용과 전체용만') },
    },
    async ({ challengeId }) => {
      const today = todayKst(now())
      const templates = await listActiveTemplates(db, today, challengeId)
      return asText({
        today,
        readOnly: settings.readOnly,
        dryRun: settings.dryRun,
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
    'list_replies',
    {
      description: '최근 답변 기록(초안, 전송됨, 실패)을 읽는다.',
      inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
    },
    async ({ limit }) => asText(await listReplies(db, limit)),
  )

  // 읽기 전용이면 쓰기 도구를 아예 등록하지 않는다.
  if (!settings.readOnly) {
    server.registerTool(
      'reply_question',
      {
        description:
          '문의에 답변한다. body 는 템플릿의 {{변수}} 를 모두 치환한 최종 문구여야 한다. ' +
          "mode 'send' 는 전역 자동 전송이 켜져 있고 템플릿이 autoSend 이고 유효할 때만 실제로 전송되고, 아니면 초안으로 저장된다. " +
          '가상 전송 모드(dryRun)가 켜져 있으면 조건을 통과해도 실제로 보내지 않고 status 가 simulated 인 기록만 남는다. ' +
          '이미 답변이 달린 문의나 이미 전송한 문의는 거부된다.',
        inputSchema: {
          challengeId: z.number().int(),
          questionId: z.number().int(),
          body: z.string().min(1),
          templateId: z.number().int().optional().describe('근거로 쓴 템플릿. send 에는 필요하다'),
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
