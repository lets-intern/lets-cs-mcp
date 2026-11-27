import { describe, expect, it } from 'vitest'
import { discardDraft, sendDraft, submitReply } from './reply.js'
import { createTemplate, getReply, getSettings, saveSettings, type TemplateFields } from './store.js'
import { NOW, question, setup } from './test-helpers.js'

const tpl = (over: Partial<TemplateFields> = {}): TemplateFields => ({
  title: '환불',
  situation: '환불 문의',
  body: '환불 가능 범위를 안내한다',
  challengeId: null,
  validFrom: null,
  validUntil: null,
  autoSend: true,
  priority: 0,
  ...over,
})

const input = { challengeId: 10, questionId: 1, body: '홍길동님, 부분 환불만 가능합니다', mode: 'send' as const }

// 실제 전송 경로를 시험할 때: 읽기 전용과 디버깅 모드를 끈다.
const live = { readOnly: false, debugMode: false }

describe('기본 상태', () => {
  it('처음에는 읽기 전용이고 디버깅 모드가 켜져 있다', async () => {
    const { deps, saved } = await setup()
    expect(await getSettings(deps.db)).toMatchObject({ readOnly: true, debugMode: true, autoSendEnabled: false })
    expect(await submitReply(deps, input)).toEqual({ ok: false, reason: '읽기 전용 모드라 답변을 쓸 수 없다' })
    expect(saved).toHaveLength(0)
  })
})

describe('디버깅 모드', () => {
  it('어떤 mode 로 불러도 유저에게 보내지 않고, 문의와 템플릿과 답변을 기록한다', async () => {
    const { deps, saved } = await setup()
    await saveSettings(deps.db, { readOnly: false, autoSendEnabled: true, answerFooter: '렛츠커리어 드림' })
    const t = await createTemplate(deps.db, tpl(), NOW)

    const r = await submitReply(deps, { ...input, templateId: t.id })
    expect(r).toMatchObject({ ok: true, status: 'simulated' })
    expect(saved).toHaveLength(0)

    const row = await getReply(deps.db, (r as { replyId: number }).replyId)
    expect(row).toMatchObject({
      status: 'simulated',
      intended: 'send',
      templateId: t.id,
      templateTitle: '환불',
      questionContent: '환불하고 싶어요',
      challengeTitle: '11월 챌린지',
      userName: '홍길동',
      body: '홍길동님, 부분 환불만 가능합니다\n\n렛츠커리어 드림',
    })
    expect(row?.note).toContain('운영이었다면 자동 전송')
  })

  it('draft 로 불러도 디버깅 기록이 되고, 운영이었다면 초안이었다고 남는다', async () => {
    const { deps, saved } = await setup()
    await saveSettings(deps.db, { readOnly: false })
    const r = await submitReply(deps, { ...input, mode: 'draft' })
    expect(r).toMatchObject({ ok: true, status: 'simulated' })
    const row = await getReply(deps.db, (r as { replyId: number }).replyId)
    expect(row).toMatchObject({ intended: 'draft', body: '홍길동님, 부분 환불만 가능합니다' })
    expect(row?.note).toBe('운영이었다면 초안: mode=draft 로 요청됨')
    expect(saved).toHaveLength(0)
  })

  it('전역 자동 전송이 꺼져 있어도 켜졌다고 가정하고 템플릿 단위로 판단한다', async () => {
    const { deps } = await setup([question({ id: 1 }), question({ id: 2 })])
    await saveSettings(deps.db, { readOnly: false })
    expect((await getSettings(deps.db)).autoSendEnabled).toBe(false)
    const auto = await createTemplate(deps.db, tpl({ autoSend: true }), NOW)
    const manual = await createTemplate(deps.db, tpl({ title: '수동', autoSend: false }), NOW)

    const a = await submitReply(deps, { ...input, questionId: 1, templateId: auto.id })
    const b = await submitReply(deps, { ...input, questionId: 2, templateId: manual.id })
    expect((await getReply(deps.db, (a as { replyId: number }).replyId))?.intended).toBe('send')
    const rowB = await getReply(deps.db, (b as { replyId: number }).replyId)
    expect(rowB?.intended).toBe('draft')
    expect(rowB?.note).toContain('자동 전송이 허용되지 않는다')
  })

  it('템플릿 없이 써도 기록되고, 같은 문의는 한 건으로 갱신된다', async () => {
    const { deps } = await setup()
    await saveSettings(deps.db, { readOnly: false })
    const a = await submitReply(deps, { ...input, mode: 'draft' })
    const b = await submitReply(deps, { ...input, body: '고친 답변', mode: 'draft' })
    expect(a.ok && b.ok && a.replyId === b.replyId).toBe(true)
    const row = await getReply(deps.db, (b as { replyId: number }).replyId)
    expect(row).toMatchObject({ body: '고친 답변', templateTitle: null })
  })

  it('운영이었다면 자동 전송이었을 건수에도 하루 상한을 적용한다', async () => {
    const { deps } = await setup([question({ id: 1 }), question({ id: 2 })])
    await saveSettings(deps.db, { readOnly: false, maxSendPerDay: 1 })
    const t = await createTemplate(deps.db, tpl(), NOW)
    const a = await submitReply(deps, { ...input, questionId: 1, templateId: t.id })
    const b = await submitReply(deps, { ...input, questionId: 2, templateId: t.id })
    expect((await getReply(deps.db, (a as { replyId: number }).replyId))?.intended).toBe('send')
    const rowB = await getReply(deps.db, (b as { replyId: number }).replyId)
    expect(rowB?.intended).toBe('draft')
    expect(rowB?.note).toContain('상한')
  })

  it('운영에서 만든 초안도 디버깅 모드를 켜면 보낼 수 없다', async () => {
    const { deps, saved } = await setup()
    await saveSettings(deps.db, { ...live })
    const draft = await submitReply(deps, { ...input, mode: 'draft' })
    if (!draft.ok) throw new Error('draft failed')

    await saveSettings(deps.db, { debugMode: true })
    expect(await sendDraft(deps, draft.replyId)).toEqual({ ok: false, reason: '디버깅 모드라 유저에게 보낼 수 없다' })
    expect(saved).toHaveLength(0)
  })

  it('디버깅 기록은 보내거나 버릴 수 없다', async () => {
    const { deps, saved } = await setup()
    await saveSettings(deps.db, { readOnly: false })
    const r = await submitReply(deps, { ...input, mode: 'draft' })
    if (!r.ok) throw new Error('record failed')
    await saveSettings(deps.db, { debugMode: false })
    expect((await sendDraft(deps, r.replyId)).ok).toBe(false)
    expect(await discardDraft(deps, r.replyId)).toBe(false)
    expect(saved).toHaveLength(0)
  })

  it('이미 답변이 달린 문의는 디버깅 중에도 기록하지 않는다', async () => {
    const { deps } = await setup([question({ answerStatus: 'COMPLETED', answer: '사람이 먼저 답함' })])
    await saveSettings(deps.db, { readOnly: false })
    expect(await submitReply(deps, input)).toEqual({ ok: false, reason: '이미 답변이 달린 문의다' })
  })
})

describe('운영 모드 (디버깅 모드 꺼짐)', () => {
  it('치환되지 않은 변수가 남으면 거부한다', async () => {
    const { deps } = await setup()
    await saveSettings(deps.db, live)
    expect((await submitReply(deps, { ...input, body: '{{userName}}님' })).ok).toBe(false)
  })

  it('draft 는 저장만 하고 보내지 않으며 다시 부르면 같은 초안을 갱신한다', async () => {
    const { deps, saved } = await setup()
    await saveSettings(deps.db, live)
    const a = await submitReply(deps, { ...input, mode: 'draft' })
    const b = await submitReply(deps, { ...input, body: '고친 본문', mode: 'draft' })
    expect(a.ok && b.ok && a.replyId === b.replyId).toBe(true)
    expect(a).toMatchObject({ status: 'draft' })
    expect(saved).toHaveLength(0)
  })

  it('send 라도 자동 전송이 꺼져 있으면 초안이 된다', async () => {
    const { deps, saved } = await setup()
    await saveSettings(deps.db, live)
    const t = await createTemplate(deps.db, tpl(), NOW)
    const r = await submitReply(deps, { ...input, templateId: t.id })
    expect(r).toMatchObject({ ok: true, status: 'draft' })
    expect(saved).toHaveLength(0)
  })

  it('조건을 모두 통과하면 푸터를 붙여 전송하고, 같은 문의에 다시 보내지 않는다', async () => {
    const { deps, saved } = await setup()
    await saveSettings(deps.db, { ...live, autoSendEnabled: true, answerFooter: '렛츠커리어 드림' })
    const t = await createTemplate(deps.db, tpl(), NOW)
    const r = await submitReply(deps, { ...input, templateId: t.id })
    expect(r).toMatchObject({ ok: true, status: 'sent' })
    expect(saved).toEqual([{ challengeId: 10, questionId: 1, answer: '홍길동님, 부분 환불만 가능합니다\n\n렛츠커리어 드림' }])
    expect(await submitReply(deps, { ...input, templateId: t.id })).toEqual({ ok: false, reason: '이미 전송한 문의다' })
    expect(saved).toHaveLength(1)
  })

  it('autoSend 가 아닌 템플릿, 기간이 지난 템플릿, 다른 챌린지 템플릿은 초안이 된다', async () => {
    const { deps, saved } = await setup()
    await saveSettings(deps.db, { ...live, autoSendEnabled: true })
    const manual = await createTemplate(deps.db, tpl({ autoSend: false }), NOW)
    const expired = await createTemplate(deps.db, tpl({ validUntil: '2026-11-01' }), NOW)
    const other = await createTemplate(deps.db, tpl({ challengeId: 99 }), NOW)
    for (const id of [manual.id, expired.id, other.id]) {
      expect(await submitReply(deps, { ...input, templateId: id })).toMatchObject({ ok: true, status: 'draft' })
    }
    expect(saved).toHaveLength(0)
  })

  it('이미 답변이 달린 문의는 거부한다', async () => {
    const { deps, saved } = await setup([question({ answerStatus: 'COMPLETED', answer: '사람이 먼저 답함' })])
    await saveSettings(deps.db, live)
    expect(await submitReply(deps, input)).toEqual({ ok: false, reason: '이미 답변이 달린 문의다' })
    expect(saved).toHaveLength(0)
  })

  it('하루 전송 상한을 넘으면 초안이 된다', async () => {
    const { deps, saved } = await setup([question({ id: 1 }), question({ id: 2 })])
    await saveSettings(deps.db, { ...live, autoSendEnabled: true, maxSendPerDay: 1 })
    const t = await createTemplate(deps.db, tpl(), NOW)
    expect(await submitReply(deps, { ...input, questionId: 1, templateId: t.id })).toMatchObject({ status: 'sent' })
    expect(await submitReply(deps, { ...input, questionId: 2, templateId: t.id })).toMatchObject({ status: 'draft' })
    expect(saved).toHaveLength(1)
  })

  it('초안은 읽기 전용이 아닐 때만 보내고, 그 사이 답변이 달리면 막고, 버릴 수 있다', async () => {
    const { deps, saved, questions } = await setup()
    await saveSettings(deps.db, live)
    const draft = await submitReply(deps, { ...input, mode: 'draft' })
    if (!draft.ok) throw new Error('draft failed')

    await saveSettings(deps.db, { readOnly: true })
    expect((await sendDraft(deps, draft.replyId)).ok).toBe(false)
    await saveSettings(deps.db, { readOnly: false })

    questions.set(1, question({ answerStatus: 'COMPLETED', answer: '사람이 답함' }))
    expect((await sendDraft(deps, draft.replyId)).ok).toBe(false)
    expect(saved).toHaveLength(0)

    expect(await discardDraft(deps, draft.replyId)).toBe(true)
    questions.set(1, question())
    expect(await sendDraft(deps, draft.replyId)).toMatchObject({ ok: false })
  })

  it('조건이 맞으면 초안을 실제로 전송한다', async () => {
    const { deps, saved } = await setup()
    await saveSettings(deps.db, { ...live, answerFooter: '드림' })
    const draft = await submitReply(deps, { ...input, mode: 'draft' })
    if (!draft.ok) throw new Error('draft failed')
    expect(await sendDraft(deps, draft.replyId)).toMatchObject({ ok: true, status: 'sent' })
    expect(saved).toEqual([{ challengeId: 10, questionId: 1, answer: '홍길동님, 부분 환불만 가능합니다\n\n드림' }])
  })
})
