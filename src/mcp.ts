import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { sinceKst, todayKst } from './dates.js'
import type { Question } from './lets-api.js'
import { submitReply, type Deps } from './reply.js'
import {
  countDrafts,
  countRepliesToday,
  createPolicyDoc,
  createTemplate,
  deleteTemplate,
  existingPolicyIds,
  getPolicyDoc,
  getSettings,
  getTemplate,
  listActiveTemplates,
  listDebugRecords,
  listPolicyDocs,
  listPolicyRevisions,
  listReplies,
  listTemplates,
  policyUsage,
  searchPolicyDocs,
  setPolicyEnabled,
  setTemplateEnabled,
  summarizeDebug,
  templateStatus,
  updateTemplate,
  updatePolicyDoc,
  type PolicyDoc,
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
    policyIds: t.policyIds,
  }
}

const describePolicy = (p: PolicyDoc, withBody = false) => ({
  id: p.id,
  title: p.title,
  summary: p.summary,
  appliesWhen: p.appliesWhen,
  tags: p.tags,
  owner: p.owner,
  sourceUrl: p.sourceUrl,
  enabled: p.enabled,
  lastEditor: p.lastEditor,
  updatedAt: p.updatedAt,
  bodyChars: p.body.length,
  ...(withBody ? { body: p.body } : {}),
})

export async function createMcpServer(deps: Deps) {
  const { db, api, now } = deps
  const settings = await getSettings(db)
  const server = new McpServer(
    { name: 'lets-cs-mcp', version: '0.3.0' },
    {
      instructions: [
        '렛츠커리어 챌린지 1:1 문의를 읽고 답하는 서버다. 스스로 개선하며 돌 수 있다.',
        '순서: get_overview 로 모드와 현황을 본다 -> get_debug_summary, list_debug_records 로 지난 디버깅 결과를 점검한다 -> 부족하거나 틀린 템플릿은 update_template, 없는 유형은 save_template 으로 고친다 -> list_pending_questions 로 문의를 읽고 템플릿을 참고해 reply_question 으로 답한다 -> 한 일을 보고한다.',
        '템플릿은 그대로 보내는 문구가 아니라 문의에 맞춰 직접 쓸 때 참고하는 가이드다.',
        '운영정책 문서는 호정님과 경지님이 정한 기준이다. 환불, 환급, 페이백, 일정처럼 정책이 걸린 문의는 list_policy_docs 로 목차를 보고 get_policy_doc 으로 전문을 읽은 뒤 쓴다. 키워드로 찾으려면 search_policy_docs 를 쓴다. 답변할 때 근거로 삼은 정책 번호를 reply_question 의 policyIds 에 넣는다.',
        '정책 문서는 update_policy_doc 으로 정리할 수 있다(요약, 적용 상황, 태그, 본문 구조 정리). 의미를 바꾸지 말고, 고칠 때마다 editNote 에 이유를 적는다. 이전 내용은 이력에 남고 사람이 되돌릴 수 있다. 담당자와 원문 주소는 바꿀 수 없고, 삭제는 사람만 한다.',
        '모드(읽기 전용, 디버깅, 자동 전송, 하루 상한, 답변 끝 문구)와 템플릿의 자동 전송 허용은 읽기만 되고 바꿀 수 없다. 사람이 대시보드 설정에서만 바꾼다.',
        'debugMode 가 true 면 답변은 유저에게 가지 않고 기록만 된다. 이 기록을 보고 스스로 템플릿을 다듬는다.',
        'page 는 모두 1부터 시작한다.',
      ].join('\n'),
    },
  )

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
    'list_policy_docs',
    {
      description:
        '운영정책 문서 목차를 읽는다. 제목, 한 줄 요약, 어떤 문의에 적용되는지, 태그, 담당자, Notion 원문 주소가 있다. 전문은 get_policy_doc 으로 읽는다. 정책이 걸린 문의에 답하기 전에 먼저 본다.',
      inputSchema: { tag: z.string().optional().describe('이 태그가 붙은 문서만'), includeDisabled: z.boolean().default(false) },
    },
    async ({ tag, includeDisabled }) => {
      const docs = (await listPolicyDocs(db, includeDisabled)).filter((p) => !tag || p.tags.includes(tag))
      return asText(docs.map((p) => describePolicy(p)))
    },
  )

  server.registerTool(
    'get_policy_doc',
    {
      description: '운영정책 문서 한 건의 전문을 읽는다. 조건과 예외가 본문 안에 같이 있으니 요약만 보고 답하지 말고 전문을 읽는다.',
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const p = await getPolicyDoc(db, id)
      return p ? asText(describePolicy(p, true)) : asText({ ok: false, reason: '그 id 의 정책 문서가 없다' }, true)
    },
  )

  server.registerTool(
    'search_policy_docs',
    {
      description:
        '운영정책 문서에서 키워드로 찾는다. 공백으로 나눈 단어 중 하나라도 맞으면 점수를 매겨 높은 순으로 돌려주고, 맞은 부분 앞뒤를 snippet 으로 보여준다. 제목, 태그, 적용 상황, 요약, 본문에서 찾는다.',
      inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(20).default(5) },
    },
    async ({ query, limit }) => asText(await searchPolicyDocs(db, query, limit)),
  )

  server.registerTool(
    'list_policy_revisions',
    {
      description: '정책 문서를 고치기 전의 이전 내용 이력을 읽는다. 누가(AI 또는 사람), 왜 고쳤는지 editNote 가 있다.',
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => asText((await listPolicyRevisions(db, id)).map((r) => ({ ...r, body: undefined, bodyChars: r.body.length }))),
  )

  server.registerTool(
    'get_overview',
    {
      description:
        '대시보드 현황을 읽는다. 유효 템플릿 수, 대기 중 초안, 오늘 전송과 디버깅 기록 수, 현재 모드(읽기 전용, 디버깅, 자동 전송)와 하루 상한. 모드는 읽기만 되고 바꿀 수 없다. 사람이 대시보드 설정에서만 바꾼다.',
      inputSchema: {},
    },
    async () => {
      const today = todayKst(now())
      return asText({
        today,
        modes: {
          readOnly: settings.readOnly,
          debugMode: settings.debugMode,
          autoSendEnabled: settings.autoSendEnabled,
          maxSendPerDay: settings.maxSendPerDay,
        },
        activeTemplates: (await listActiveTemplates(db, today)).length,
        policyDocs: (await listPolicyDocs(db)).length,
        pendingDrafts: await countDrafts(db),
        sentToday: await countRepliesToday(db, today, 'sent'),
        debugRecordsToday: await countRepliesToday(db, today, 'simulated'),
      })
    },
  )

  server.registerTool(
    'get_debug_summary',
    {
      description:
        '디버깅 경과 요약을 읽는다. 최근 며칠 동안 기록이 몇 건인지, 운영이었다면 자동 전송이었을지 초안이었을지, 어떤 템플릿을 많이 참고했는지, 날짜별 건수. 템플릿을 고치기 전에 경과를 확인할 때 쓴다.',
      inputSchema: { days: z.number().int().min(1).max(60).default(14) },
    },
    async ({ days }) => {
      const since = sinceKst(now(), days)
      const records = await listDebugRecords(db, since)
      return asText({ since, days, ...summarizeDebug(records), policies: policyUsage(records, await listPolicyDocs(db)) })
    },
  )

  server.registerTool(
    'list_debug_records',
    {
      description:
        '디버깅 기록 목록을 최신순으로 읽는다. 각 기록에는 문의가 들어온 시각(questionCreatedAt), 기록한 시각(recordedAt), 그때의 문의 내용, 참고한 템플릿, 쓴 답변, 운영이었다면 결과(intended)와 사유가 있다. 유저에게는 보내지 않은 기록이다. page 는 1부터 시작한다.',
      inputSchema: {
        days: z.number().int().min(1).max(60).default(14),
        templateId: z.number().int().optional().describe('이 템플릿을 참고한 기록만'),
        page: z.number().int().min(1).default(1),
        size: z.number().int().min(1).max(50).default(20),
      },
    },
    async ({ days, templateId, page, size }) => {
      const since = sinceKst(now(), days)
      const all = (await listDebugRecords(db, since)).filter((r) => templateId === undefined || r.templateId === templateId)
      const start = (page - 1) * size
      return asText({
        since,
        total: all.length,
        page,
        size,
        records: all.slice(start, start + size).map((r) => ({
          id: r.id,
          questionCreatedAt: r.questionCreatedAt,
          recordedAt: r.createdAt,
          updatedAt: r.updatedAt,
          questionId: r.questionId,
          challengeId: r.challengeId,
          challengeTitle: r.challengeTitle,
          userName: r.userName,
          questionTitle: r.questionTitle,
          questionContent: r.questionContent,
          templateId: r.templateId,
          templateTitle: r.templateTitle,
          intended: r.intended,
          policyIds: r.policyIds,
          answer: r.body,
          note: r.note,
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
          policyIds: z.array(z.number().int()).optional().describe('이 가이드가 근거로 삼는 정책 문서 번호'),
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
            policyIds: a.policyIds ? await existingPolicyIds(db, a.policyIds) : [],
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
          policyIds: z.array(z.number().int()).optional().describe('주면 이 목록으로 바꾼다'),
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
          policyIds: a.policyIds ? await existingPolicyIds(db, a.policyIds) : undefined,
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
      'save_policy_doc',
      {
        description:
          '새 정책 정리 문서를 만든다. 호정님과 경지님의 원문을 대신하는 것이 아니라 AI 가 정리한 문서로 표시되고, 담당자는 AI 정리, 원문 주소는 비어 있다. 원문을 합치거나 나눠 정리할 때 쓴다.',
        inputSchema: {
          title: z.string().min(1),
          summary: z.string().default('').describe('한 줄 요약'),
          appliesWhen: z.string().default('').describe('어떤 문의에 적용되는지'),
          tags: z.array(z.string()).default([]),
          body: z.string().min(1),
        },
      },
      async (a) => {
        const p = await createPolicyDoc(
          db,
          { title: a.title.trim(), summary: a.summary.trim(), appliesWhen: a.appliesWhen.trim(), tags: a.tags.map((t) => t.trim()).filter(Boolean), owner: 'AI 정리', sourceUrl: '', body: a.body.trim() },
          'AI',
          now(),
        )
        return asText({ ok: true, policy: describePolicy(p) })
      },
    )

    server.registerTool(
      'update_policy_doc',
      {
        description:
          '정책 문서를 정리한다. 준 항목만 바뀐다. 의미를 바꾸지 말고 요약, 적용 상황, 태그, 본문 구조를 다듬는 데 쓴다. editNote 에 무엇을 왜 고쳤는지 반드시 적는다. 이전 내용은 이력에 남고 사람이 되돌릴 수 있다. 담당자와 원문 주소는 바꿀 수 없고 삭제는 사람만 한다. 쓰지 않는 문서는 enabled=false 로 끈다.',
        inputSchema: {
          id: z.number().int(),
          editNote: z.string().min(1).describe('무엇을 왜 고쳤는지'),
          title: z.string().min(1).optional(),
          summary: z.string().optional(),
          appliesWhen: z.string().optional(),
          tags: z.array(z.string()).optional(),
          body: z.string().min(1).optional(),
          enabled: z.boolean().optional(),
        },
      },
      async (a) => {
        const cur = await getPolicyDoc(db, a.id)
        if (!cur) return asText({ ok: false, reason: '그 id 의 정책 문서가 없다' }, true)
        const patch = {
          title: a.title?.trim(),
          summary: a.summary?.trim(),
          appliesWhen: a.appliesWhen?.trim(),
          tags: a.tags?.map((t) => t.trim()).filter(Boolean),
          body: a.body?.trim(),
        }
        const changed = Object.values(patch).some((v) => v !== undefined)
        let p: PolicyDoc | null = cur
        if (changed) p = await updatePolicyDoc(db, a.id, patch, 'AI', a.editNote.trim(), now())
        if (a.enabled !== undefined) p = await setPolicyEnabled(db, a.id, a.enabled, 'AI', now())
        return asText({ ok: true, policy: describePolicy(p!) })
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
          policyIds: z.array(z.number().int()).optional().describe('근거로 삼은 정책 문서 번호. 디버깅 기록에 남는다'),
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
