import { describe, expect, it } from 'vitest'
import { openDb } from './db.js'
import { createTemplate, listActiveTemplates, setTemplateEnabled, type TemplateFields } from './store.js'
import { NOW } from './test-helpers.js'

const fields = (over: Partial<TemplateFields> = {}): TemplateFields => ({
  title: 't',
  situation: 's',
  body: 'b',
  challengeId: null,
  validFrom: null,
  validUntil: null,
  autoSend: false,
  priority: 0,
  ...over,
})

describe('템플릿 유효기간', () => {
  it('기간이 없으면 계속 유효하고 기간이 지나거나 아직이거나 꺼진 것은 빠진다', async () => {
    const db = await openDb(':memory:')
    const today = '2026-11-27'
    await createTemplate(db, fields({ title: '계속' }), NOW)
    await createTemplate(db, fields({ title: '오늘까지', validUntil: '2026-11-27' }), NOW)
    await createTemplate(db, fields({ title: '어제 만료', validUntil: '2026-11-26' }), NOW)
    await createTemplate(db, fields({ title: '내일 시작', validFrom: '2026-11-28' }), NOW)
    const off = await createTemplate(db, fields({ title: '꺼짐' }), NOW)
    await setTemplateEnabled(db, off.id, false, NOW)

    const titles = (await listActiveTemplates(db, today)).map((t) => t.title).sort()
    expect(titles).toEqual(['계속', '오늘까지'])
  })

  it('챌린지를 주면 그 챌린지용과 전체용만 나온다', async () => {
    const db = await openDb(':memory:')
    await createTemplate(db, fields({ title: '전체' }), NOW)
    await createTemplate(db, fields({ title: '10번', challengeId: 10 }), NOW)
    await createTemplate(db, fields({ title: '11번', challengeId: 11 }), NOW)
    const titles = (await listActiveTemplates(db, '2026-11-27', 10)).map((t) => t.title).sort()
    expect(titles).toEqual(['10번', '전체'])
  })
})
