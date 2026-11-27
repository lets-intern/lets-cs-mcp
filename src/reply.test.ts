import { describe, expect, it } from 'vitest'
import { discardDraft, sendDraft, submitReply } from './reply.js'
import { createTemplate, getReply, getSettings, saveSettings, type TemplateFields } from './store.js'
import { NOW, question, setup } from './test-helpers.js'

const tpl = (over: Partial<TemplateFields> = {}): TemplateFields => ({
  title: '환불',
  situation: '환불 문의',
  body: '{{userName}}님 안내드립니다',
  challengeId: null,
  validFrom: null,
  validUntil: null,
  autoSend: true,
  priority: 0,
  ...over,
})

const input = { challengeId: 10, questionId: 1, body: '홍길동님 안내드립니다' }

describe('답변 쓰기', () => {
  it('처음에는 읽기 전용이라 아무것도 쓰지 않는다', async () => {
    const { deps, saved } = await setup()
    expect((await getSettings(deps.db)).readOnly).toBe(true)
    const r = await submitReply(deps, { ...input, mode: 'draft' })
    expect(r).toEqual({ ok: false, reason: '읽기 전용 모드라 답변을 쓸 수 없다' })
    expect(saved).toHaveLength(0)
  })

  it('치환되지 않은 변수가 남으면 거부한다', async () => {
    const { deps } = await setup()
    await saveSettings(deps.db, { readOnly: false })
    const r = await submitReply(deps, { ...input, body: '{{userName}}님', mode: 'draft' })
    expect(r.ok).toBe(false)
  })

  it('draft 는 저장만 하고 서버로 보내지 않으며 다시 부르면 같은 초안을 갱신한다', async () => {
    const { deps, saved } = await setup()
    await saveSettings(deps.db, { readOnly: false })
    const a = await submitReply(deps, { ...input, mode: 'draft' })
    const b = await submitReply(deps, { ...input, body: '고친 본문', mode: 'draft' })
    expect(a.ok && b.ok && a.replyId === b.replyId).toBe(true)
    expect(saved).toHaveLength(0)
  })

  it('send 라도 자동 전송이 꺼져 있으면 초안이 된다', async () => {
    const { deps, saved } = await setup()
    await saveSettings(deps.db, { readOnly: false })
    const t = await createTemplate(deps.db, tpl(), NOW)
    const r = await submitReply(deps, { ...input, templateId: t.id, mode: 'send' })
    expect(r).toMatchObject({ ok: true, status: 'draft' })
    expect(saved).toHaveLength(0)
  })

  it('자동 전송이 켜져 있고 템플릿이 허용하면 푸터를 붙여 전송하고, 같은 문의에 다시 보내지 않는다', async () => {
    const { deps, saved } = await setup()
    await saveSettings(deps.db, { readOnly: false, dryRun: false, autoSendEnabled: true, answerFooter: '렛츠커리어 드림' })
    const t = await createTemplate(deps.db, tpl(), NOW)
    const r = await submitReply(deps, { ...input, templateId: t.id, mode: 'send' })
    expect(r).toMatchObject({ ok: true, status: 'sent' })
    expect(saved).toEqual([{ challengeId: 10, questionId: 1, answer: '홍길동님 안내드립니다\n\n렛츠커리어 드림' }])
    const again = await submitReply(deps, { ...input, templateId: t.id, mode: 'send' })
    expect(again).toEqual({ ok: false, reason: '이미 전송한 문의다' })
    expect(saved).toHaveLength(1)
  })

  it('autoSend 가 아닌 템플릿, 기간이 지난 템플릿, 다른 챌린지 템플릿은 초안이 된다', async () => {
    const { deps, saved } = await setup()
    await saveSettings(deps.db, { readOnly: false, autoSendEnabled: true })
    const manual = await createTemplate(deps.db, tpl({ autoSend: false }), NOW)
    const expired = await createTemplate(deps.db, tpl({ validUntil: '2026-11-01' }), NOW)
    const other = await createTemplate(deps.db, tpl({ challengeId: 99 }), NOW)
    for (const [i, id] of [manual.id, expired.id, other.id].entries()) {
      const r = await submitReply(deps, { ...input, questionId: 1, templateId: id, mode: 'send' })
      expect(r, `case ${i}`).toMatchObject({ ok: true, status: 'draft' })
    }
    expect(saved).toHaveLength(0)
  })

  it('이미 답변이 달린 문의는 거부한다', async () => {
    const { deps, saved } = await setup([question({ answerStatus: 'COMPLETED', answer: '사람이 먼저 답함' })])
    await saveSettings(deps.db, { readOnly: false })
    const r = await submitReply(deps, { ...input, mode: 'draft' })
    expect(r).toEqual({ ok: false, reason: '이미 답변이 달린 문의다' })
    expect(saved).toHaveLength(0)
  })

  it('하루 전송 상한을 넘으면 초안이 된다', async () => {
    const { deps, saved } = await setup([question({ id: 1 }), question({ id: 2 })])
    await saveSettings(deps.db, { readOnly: false, dryRun: false, autoSendEnabled: true, maxSendPerDay: 1 })
    const t = await createTemplate(deps.db, tpl(), NOW)
    const a = await submitReply(deps, { ...input, questionId: 1, templateId: t.id, mode: 'send' })
    const b = await submitReply(deps, { ...input, questionId: 2, templateId: t.id, mode: 'send' })
    expect(a).toMatchObject({ status: 'sent' })
    expect(b).toMatchObject({ status: 'draft' })
    expect(saved).toHaveLength(1)
  })
})

describe('가상 전송', () => {
  it('처음에는 가상 전송이 켜져 있다', async () => {
    const { deps } = await setup()
    expect((await getSettings(deps.db)).dryRun).toBe(true)
  })

  it('조건을 통과해도 보내지 않고 푸터가 붙은 최종 문구와 사유를 기록한다', async () => {
    const { deps, saved } = await setup()
    await saveSettings(deps.db, { readOnly: false, autoSendEnabled: true, answerFooter: '렛츠커리어 드림' })
    const t = await createTemplate(deps.db, tpl(), NOW)
    const r = await submitReply(deps, { ...input, templateId: t.id, mode: 'send' })
    expect(r).toMatchObject({ ok: true, status: 'simulated' })
    expect(saved).toHaveLength(0)
    const row = await getReply(deps.db, (r as { replyId: number }).replyId)
    expect(row).toMatchObject({ status: 'simulated', body: '홍길동님 안내드립니다\n\n렛츠커리어 드림' })
    expect(row?.note).toContain(`템플릿 #${t.id}`)
  })

  it('조건을 통과하지 못하면 가상 전송이 아니라 초안이 되고 사유가 남는다', async () => {
    const { deps } = await setup()
    await saveSettings(deps.db, { readOnly: false })
    const r = await submitReply(deps, { ...input, mode: 'send' })
    expect(r).toMatchObject({ ok: true, status: 'draft' })
    const row = await getReply(deps.db, (r as { replyId: number }).replyId)
    expect(row?.note).toBe('자동 전송이 꺼져 있어 초안으로 저장했다')
  })

  it('가상 전송 기록은 같은 문의에서 하나만 유지되고, 실제로 전송할 때 푸터가 두 번 붙지 않는다', async () => {
    const { deps, saved } = await setup()
    await saveSettings(deps.db, { readOnly: false, autoSendEnabled: true, answerFooter: '드림' })
    const t = await createTemplate(deps.db, tpl(), NOW)
    const a = await submitReply(deps, { ...input, templateId: t.id, mode: 'send' })
    const b = await submitReply(deps, { ...input, templateId: t.id, mode: 'send' })
    expect(a.ok && b.ok && a.replyId === b.replyId).toBe(true)

    const sent = await sendDraft(deps, (a as { replyId: number }).replyId)
    expect(sent).toMatchObject({ ok: true, status: 'sent' })
    expect(saved).toEqual([{ challengeId: 10, questionId: 1, answer: '홍길동님 안내드립니다\n\n드림' }])
  })

  it('가상 전송 건수도 하루 상한에 센다', async () => {
    const { deps } = await setup([question({ id: 1 }), question({ id: 2 })])
    await saveSettings(deps.db, { readOnly: false, autoSendEnabled: true, maxSendPerDay: 1 })
    const t = await createTemplate(deps.db, tpl(), NOW)
    const a = await submitReply(deps, { ...input, questionId: 1, templateId: t.id, mode: 'send' })
    const b = await submitReply(deps, { ...input, questionId: 2, templateId: t.id, mode: 'send' })
    expect(a).toMatchObject({ status: 'simulated' })
    expect(b).toMatchObject({ status: 'draft' })
  })

  it('가상 전송 기록을 버릴 수 있다', async () => {
    const { deps } = await setup()
    await saveSettings(deps.db, { readOnly: false, autoSendEnabled: true })
    const t = await createTemplate(deps.db, tpl(), NOW)
    const r = await submitReply(deps, { ...input, templateId: t.id, mode: 'send' })
    expect(await discardDraft(deps, (r as { replyId: number }).replyId)).toBe(true)
  })
})

describe('초안 처리', () => {
  it('읽기 전용이면 초안도 보낼 수 없고, 꺼지면 보낼 수 있다', async () => {
    const { deps, saved } = await setup()
    await saveSettings(deps.db, { readOnly: false })
    const draft = await submitReply(deps, { ...input, mode: 'draft' })
    if (!draft.ok) throw new Error('draft failed')

    await saveSettings(deps.db, { readOnly: true })
    expect((await sendDraft(deps, draft.replyId)).ok).toBe(false)
    expect(saved).toHaveLength(0)

    await saveSettings(deps.db, { readOnly: false })
    expect(await sendDraft(deps, draft.replyId)).toMatchObject({ ok: true, status: 'sent' })
    expect(saved).toHaveLength(1)
  })

  it('그 사이 답변이 달리면 초안 전송을 막고, 버린 초안은 다시 쓸 수 있다', async () => {
    const { deps, saved, questions } = await setup()
    await saveSettings(deps.db, { readOnly: false })
    const draft = await submitReply(deps, { ...input, mode: 'draft' })
    if (!draft.ok) throw new Error('draft failed')
    questions.set(1, question({ answerStatus: 'COMPLETED', answer: '사람이 답함' }))
    expect((await sendDraft(deps, draft.replyId)).ok).toBe(false)
    expect(saved).toHaveLength(0)

    expect(await discardDraft(deps, draft.replyId)).toBe(true)
    questions.set(1, question())
    expect(await submitReply(deps, { ...input, mode: 'draft' })).toMatchObject({ ok: true })
  })
})
