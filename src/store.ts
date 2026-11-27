import { createHash } from 'node:crypto'
import type { Row } from '@libsql/client'
import type { Db } from './db.js'
import { kstNow, todayKst } from './dates.js'

// ---------- 템플릿 ----------

export type Template = {
  id: number
  title: string
  situation: string
  body: string
  challengeId: number | null
  validFrom: string | null
  validUntil: string | null
  enabled: boolean
  autoSend: boolean
  priority: number
  // 이 가이드가 근거로 삼는 정책 문서 번호
  policyIds: number[]
  createdAt: string
  updatedAt: string
}

export type TemplateFields = Omit<Template, 'id' | 'enabled' | 'createdAt' | 'updatedAt' | 'policyIds'> & { policyIds?: number[] }

export type TemplateStatus = 'active' | 'disabled' | 'upcoming' | 'expired'

const num = (v: unknown) => (v == null ? null : Number(v))

// 정책 번호 목록은 '1,3' 처럼 한 칸에 쉼표로 저장한다.
const parseIds = (v: unknown): number[] =>
  v == null || v === '' ? [] : String(v).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0)
export const formatIds = (ids: number[]): string => [...new Set(ids)].join(',')
const str = (v: unknown) => (v == null ? null : String(v))

const toTemplate = (r: Row): Template => ({
  id: Number(r.id),
  title: String(r.title),
  situation: String(r.situation),
  body: String(r.body),
  challengeId: num(r.challenge_id),
  validFrom: str(r.valid_from),
  validUntil: str(r.valid_until),
  enabled: Number(r.enabled) === 1,
  autoSend: Number(r.auto_send) === 1,
  priority: Number(r.priority),
  policyIds: parseIds(r.policy_ids),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
})

// 유효 여부는 이 함수 하나가 정한다. valid_until 은 그날 끝까지 유효하다.
export function templateStatus(t: Template, today: string): TemplateStatus {
  if (!t.enabled) return 'disabled'
  if (t.validFrom && t.validFrom > today) return 'upcoming'
  if (t.validUntil && t.validUntil < today) return 'expired'
  return 'active'
}

export async function listTemplates(db: Db): Promise<Template[]> {
  const res = await db.execute('SELECT * FROM templates ORDER BY priority DESC, id DESC')
  return res.rows.map(toTemplate)
}

export async function listActiveTemplates(db: Db, today: string, challengeId?: number): Promise<Template[]> {
  const all = await listTemplates(db)
  return all.filter(
    (t) =>
      templateStatus(t, today) === 'active' &&
      (challengeId === undefined || t.challengeId === null || t.challengeId === challengeId),
  )
}

export async function getTemplate(db: Db, id: number): Promise<Template | null> {
  const res = await db.execute({ sql: 'SELECT * FROM templates WHERE id = ?', args: [id] })
  return res.rows[0] ? toTemplate(res.rows[0]) : null
}

export async function createTemplate(db: Db, f: TemplateFields, now: Date): Promise<Template> {
  const at = kstNow(now)
  const res = await db.execute({
    sql: `INSERT INTO templates (title, situation, body, challenge_id, valid_from, valid_until, enabled, auto_send, priority, policy_ids, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?) RETURNING *`,
    args: [f.title, f.situation, f.body, f.challengeId, f.validFrom, f.validUntil, f.autoSend ? 1 : 0, f.priority, formatIds(f.policyIds ?? []), at, at],
  })
  return toTemplate(res.rows[0]!)
}

export async function updateTemplate(db: Db, id: number, f: TemplateFields, now: Date): Promise<Template | null> {
  const res = await db.execute({
    sql: `UPDATE templates SET title=?, situation=?, body=?, challenge_id=?, valid_from=?, valid_until=?, auto_send=?, priority=?,
              policy_ids=COALESCE(?, policy_ids), updated_at=?
          WHERE id=? RETURNING *`,
    args: [
      f.title, f.situation, f.body, f.challengeId, f.validFrom, f.validUntil, f.autoSend ? 1 : 0, f.priority,
      f.policyIds === undefined ? null : formatIds(f.policyIds), kstNow(now), id,
    ],
  })
  return res.rows[0] ? toTemplate(res.rows[0]) : null
}

export async function setTemplateEnabled(db: Db, id: number, enabled: boolean, now: Date): Promise<Template | null> {
  const res = await db.execute({
    sql: 'UPDATE templates SET enabled=?, updated_at=? WHERE id=? RETURNING *',
    args: [enabled ? 1 : 0, kstNow(now), id],
  })
  return res.rows[0] ? toTemplate(res.rows[0]) : null
}

export async function deleteTemplate(db: Db, id: number): Promise<void> {
  await db.execute({ sql: 'DELETE FROM templates WHERE id = ?', args: [id] })
}

// ---------- 정책 문서 ----------

export type PolicyDoc = {
  id: number
  title: string
  summary: string
  appliesWhen: string
  tags: string[]
  owner: string
  sourceUrl: string
  body: string
  contentHash: string
  enabled: boolean
  // 마지막으로 고친 쪽. 'AI' 또는 '사람'
  lastEditor: string
  importedAt: string
  updatedAt: string
}

export type PolicyFields = {
  title: string
  summary: string
  appliesWhen: string
  tags: string[]
  owner: string
  sourceUrl: string
  body: string
}

const parseTags = (v: unknown): string[] =>
  String(v ?? '').split(',').map((t) => t.trim()).filter(Boolean)

const hashBody = (body: string) => createHash('sha256').update(body).digest('hex').slice(0, 16)

const toPolicy = (r: Row): PolicyDoc => ({
  id: Number(r.id),
  title: String(r.title),
  summary: String(r.summary),
  appliesWhen: String(r.applies_when),
  tags: parseTags(r.tags),
  owner: String(r.owner),
  sourceUrl: String(r.source_url),
  body: String(r.body),
  contentHash: String(r.content_hash),
  enabled: Number(r.enabled) === 1,
  lastEditor: String(r.last_editor),
  importedAt: String(r.imported_at),
  updatedAt: String(r.updated_at),
})

export async function listPolicyDocs(db: Db, includeDisabled = false): Promise<PolicyDoc[]> {
  const res = await db.execute(
    includeDisabled ? 'SELECT * FROM policy_docs ORDER BY id' : 'SELECT * FROM policy_docs WHERE enabled = 1 ORDER BY id',
  )
  return res.rows.map(toPolicy)
}

export async function getPolicyDoc(db: Db, id: number): Promise<PolicyDoc | null> {
  const res = await db.execute({ sql: 'SELECT * FROM policy_docs WHERE id = ?', args: [id] })
  return res.rows[0] ? toPolicy(res.rows[0]) : null
}

export async function createPolicyDoc(db: Db, f: PolicyFields, editor: string, now: Date): Promise<PolicyDoc> {
  const at = kstNow(now)
  const res = await db.execute({
    sql: `INSERT INTO policy_docs (title, summary, applies_when, tags, owner, source_url, body, content_hash, enabled, last_editor, imported_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) RETURNING *`,
    args: [f.title, f.summary, f.appliesWhen, f.tags.join(','), f.owner, f.sourceUrl, f.body, hashBody(f.body), editor, at, at],
  })
  return toPolicy(res.rows[0]!)
}

// 고치기 전 내용을 이력에 남기고 바꾼다. 준 항목만 바뀐다.
export async function updatePolicyDoc(
  db: Db,
  id: number,
  patch: Partial<PolicyFields>,
  editor: string,
  editNote: string,
  now: Date,
): Promise<PolicyDoc | null> {
  const cur = await getPolicyDoc(db, id)
  if (!cur) return null
  const at = kstNow(now)
  const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as PolicyDoc
  await db.batch(
    [
      {
        sql: `INSERT INTO policy_doc_revisions (doc_id, title, summary, applies_when, tags, body, replaced_by, edit_note, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [cur.id, cur.title, cur.summary, cur.appliesWhen, cur.tags.join(','), cur.body, editor, editNote, at],
      },
      {
        sql: `UPDATE policy_docs SET title=?, summary=?, applies_when=?, tags=?, owner=?, source_url=?, body=?, content_hash=?,
                  last_editor=?, updated_at=? WHERE id=?`,
        args: [
          next.title, next.summary, next.appliesWhen, next.tags.join(','), next.owner, next.sourceUrl, next.body,
          hashBody(next.body), editor, at, id,
        ],
      },
    ],
    'write',
  )
  return getPolicyDoc(db, id)
}

export async function setPolicyEnabled(db: Db, id: number, enabled: boolean, editor: string, now: Date): Promise<PolicyDoc | null> {
  const res = await db.execute({
    sql: 'UPDATE policy_docs SET enabled=?, last_editor=?, updated_at=? WHERE id=? RETURNING *',
    args: [enabled ? 1 : 0, editor, kstNow(now), id],
  })
  return res.rows[0] ? toPolicy(res.rows[0]) : null
}

export async function deletePolicyDoc(db: Db, id: number): Promise<void> {
  await db.batch(
    [
      { sql: 'DELETE FROM policy_doc_revisions WHERE doc_id = ?', args: [id] },
      { sql: 'DELETE FROM policy_docs WHERE id = ?', args: [id] },
    ],
    'write',
  )
}

export type PolicyRevision = {
  id: number
  docId: number
  title: string
  summary: string
  appliesWhen: string
  tags: string[]
  body: string
  replacedBy: string
  editNote: string
  createdAt: string
}

const toRevision = (r: Row): PolicyRevision => ({
  id: Number(r.id),
  docId: Number(r.doc_id),
  title: String(r.title),
  summary: String(r.summary),
  appliesWhen: String(r.applies_when),
  tags: parseTags(r.tags),
  body: String(r.body),
  replacedBy: String(r.replaced_by),
  editNote: String(r.edit_note),
  createdAt: String(r.created_at),
})

export async function listPolicyRevisions(db: Db, docId: number): Promise<PolicyRevision[]> {
  const res = await db.execute({ sql: 'SELECT * FROM policy_doc_revisions WHERE doc_id = ? ORDER BY id DESC', args: [docId] })
  return res.rows.map(toRevision)
}

export async function getPolicyRevision(db: Db, id: number): Promise<PolicyRevision | null> {
  const res = await db.execute({ sql: 'SELECT * FROM policy_doc_revisions WHERE id = ?', args: [id] })
  return res.rows[0] ? toRevision(res.rows[0]) : null
}

// 존재하는 정책 번호만 남긴다. 없는 번호가 기록에 들어가지 않게 한다.
export async function existingPolicyIds(db: Db, ids: number[]): Promise<number[]> {
  if (ids.length === 0) return []
  const all = new Set((await listPolicyDocs(db, true)).map((p) => p.id))
  return [...new Set(ids)].filter((id) => all.has(id))
}

export type PolicyHit = { id: number; title: string; summary: string; score: number; snippet: string }

// 문서가 많지 않아서 DB 에서 가져와 메모리에서 센다. 한국어도 부분 일치로 찾는다.
// 점수: 제목 5, 태그 4, 적용 상황 3, 요약 2, 본문 등장 횟수(최대 5).
export async function searchPolicyDocs(db: Db, query: string, limit = 5): Promise<PolicyHit[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const hits: PolicyHit[] = []
  for (const p of await listPolicyDocs(db)) {
    const title = p.title.toLowerCase()
    const tags = p.tags.join(',').toLowerCase()
    const when = p.appliesWhen.toLowerCase()
    const summary = p.summary.toLowerCase()
    const body = p.body.toLowerCase()
    let score = 0
    let snippetAt = -1
    for (const w of words) {
      if (title.includes(w)) score += 5
      if (tags.includes(w)) score += 4
      if (when.includes(w)) score += 3
      if (summary.includes(w)) score += 2
      const count = body.split(w).length - 1
      if (count > 0) {
        score += Math.min(count, 5)
        if (snippetAt < 0) snippetAt = body.indexOf(w)
      }
    }
    if (score === 0) continue
    const at = Math.max(0, snippetAt - 70)
    const snippet = snippetAt < 0 ? p.summary : `${at > 0 ? '…' : ''}${p.body.slice(at, snippetAt + 140).replace(/\s+/g, ' ')}…`
    hits.push({ id: p.id, title: p.title, summary: p.summary, score, snippet })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

// ---------- 설정 ----------

export type Settings = {
  readOnly: boolean
  // 디버깅 모드. 켜져 있으면 유저에게는 어떤 경로로도 보내지 않고 기록만 한다.
  debugMode: boolean
  autoSendEnabled: boolean
  maxSendPerDay: number
  answerFooter: string
}

const SETTING_KEYS = {
  readOnly: 'read_only',
  debugMode: 'debug_mode',
  autoSendEnabled: 'auto_send_enabled',
  maxSendPerDay: 'max_send_per_day',
  answerFooter: 'answer_footer',
} as const

// 처음에는 읽기 전용이고 디버깅 모드가 켜져 있으며 자동 전송은 꺼져 있다.
export async function getSettings(db: Db): Promise<Settings> {
  const res = await db.execute('SELECT key, value FROM settings')
  const raw = new Map(res.rows.map((r) => [String(r.key), String(r.value)]))
  return {
    readOnly: (raw.get(SETTING_KEYS.readOnly) ?? '1') === '1',
    debugMode: (raw.get(SETTING_KEYS.debugMode) ?? '1') === '1',
    autoSendEnabled: (raw.get(SETTING_KEYS.autoSendEnabled) ?? '0') === '1',
    maxSendPerDay: Number(raw.get(SETTING_KEYS.maxSendPerDay) ?? '20'),
    answerFooter: raw.get(SETTING_KEYS.answerFooter) ?? '',
  }
}

export async function getDbCreatedAt(db: Db): Promise<string> {
  const res = await db.execute("SELECT value FROM settings WHERE key = 'db_created_at'")
  return res.rows[0] ? String(res.rows[0].value) : '알 수 없음'
}

export async function saveSettings(db: Db, patch: Partial<Settings>): Promise<void> {
  const entries: [string, string][] = []
  if (patch.readOnly !== undefined) entries.push([SETTING_KEYS.readOnly, patch.readOnly ? '1' : '0'])
  if (patch.debugMode !== undefined) entries.push([SETTING_KEYS.debugMode, patch.debugMode ? '1' : '0'])
  if (patch.autoSendEnabled !== undefined) entries.push([SETTING_KEYS.autoSendEnabled, patch.autoSendEnabled ? '1' : '0'])
  if (patch.maxSendPerDay !== undefined) entries.push([SETTING_KEYS.maxSendPerDay, String(patch.maxSendPerDay)])
  if (patch.answerFooter !== undefined) entries.push([SETTING_KEYS.answerFooter, patch.answerFooter])
  if (entries.length === 0) return
  await db.batch(
    entries.map(([key, value]) => ({
      sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      args: [key, value],
    })),
    'write',
  )
}

// ---------- 답변 기록 ----------

// simulated 는 디버깅 기록이다. 유저에게 보내지 않고 '이 문의에 이런 답변을 달았다' 만 남긴 기록이다.
export type ReplyStatus = 'draft' | 'simulated' | 'sent' | 'failed' | 'discarded'

export type Reply = {
  id: number
  questionId: number
  challengeId: number
  templateId: number | null
  status: ReplyStatus
  body: string
  error: string | null
  userName: string | null
  questionTitle: string | null
  // 왜 이 상태가 됐는지. 초안으로 내려간 이유나 근거 템플릿을 남겨 디버깅에 쓴다.
  note: string | null
  // 디버깅 기록을 나중에 읽으려고 그때의 문의와 템플릿을 같이 남긴다.
  questionContent: string | null
  challengeTitle: string | null
  templateTitle: string | null
  // 디버깅 모드가 아니었다면 어떻게 됐을지: 'send'(자동 전송) 또는 'draft'(초안)
  intended: 'send' | 'draft' | null
  // 답변을 쓸 때 근거로 삼은 정책 문서 번호
  policyIds: number[]
  createdAt: string
  updatedAt: string
}

const toReply = (r: Row): Reply => ({
  id: Number(r.id),
  questionId: Number(r.question_id),
  challengeId: Number(r.challenge_id),
  templateId: num(r.template_id),
  status: String(r.status) as ReplyStatus,
  body: String(r.body),
  error: str(r.error),
  userName: str(r.user_name),
  questionTitle: str(r.question_title),
  note: str(r.note),
  questionContent: str(r.question_content),
  challengeTitle: str(r.challenge_title),
  templateTitle: str(r.template_title),
  intended: str(r.intended) as Reply['intended'],
  policyIds: parseIds(r.policy_ids),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
})

export type NewReply = Omit<Reply, 'id' | 'createdAt' | 'updatedAt'>

export async function insertReply(db: Db, r: NewReply, now: Date): Promise<Reply> {
  const at = kstNow(now)
  const res = await db.execute({
    sql: `INSERT INTO replies (question_id, challenge_id, template_id, status, body, error, user_name, question_title, note,
                                 question_content, challenge_title, template_title, intended, policy_ids, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    args: [
      r.questionId, r.challengeId, r.templateId, r.status, r.body, r.error, r.userName, r.questionTitle, r.note,
      r.questionContent, r.challengeTitle, r.templateTitle, r.intended, formatIds(r.policyIds), at, at,
    ],
  })
  return toReply(res.rows[0]!)
}

export async function updateReply(
  db: Db,
  id: number,
  patch: {
    status: ReplyStatus
    body?: string
    templateId?: number | null
    error?: string | null
    note?: string | null
    templateTitle?: string | null
    intended?: 'send' | 'draft' | null
    policyIds?: number[]
  },
  now: Date,
): Promise<Reply> {
  const res = await db.execute({
    sql: `UPDATE replies SET status = ?, body = COALESCE(?, body), template_id = COALESCE(?, template_id), error = ?, note = ?,
              template_title = COALESCE(?, template_title), intended = COALESCE(?, intended),
              policy_ids = COALESCE(?, policy_ids), updated_at = ?
          WHERE id = ? RETURNING *`,
    args: [
      patch.status, patch.body ?? null, patch.templateId ?? null, patch.error ?? null, patch.note ?? null,
      patch.templateTitle ?? null, patch.intended ?? null,
      patch.policyIds === undefined ? null : formatIds(patch.policyIds), kstNow(now), id,
    ],
  })
  return toReply(res.rows[0]!)
}

export async function getReply(db: Db, id: number): Promise<Reply | null> {
  const res = await db.execute({ sql: 'SELECT * FROM replies WHERE id = ?', args: [id] })
  return res.rows[0] ? toReply(res.rows[0]) : null
}

// 한 문의에는 초안, 디버깅 기록, 전송됨 중 하나만 열려 있게 유지한다. 그래야 sent 가 초안과 겹치지 않는다.
export async function findOpenReply(db: Db, questionId: number): Promise<Reply | null> {
  const res = await db.execute({
    sql: "SELECT * FROM replies WHERE question_id = ? AND status IN ('draft','simulated','sent') ORDER BY id DESC LIMIT 1",
    args: [questionId],
  })
  return res.rows[0] ? toReply(res.rows[0]) : null
}

export async function listReplies(db: Db, limit = 100, status?: ReplyStatus): Promise<Reply[]> {
  const res = status
    ? await db.execute({ sql: 'SELECT * FROM replies WHERE status = ? ORDER BY id DESC LIMIT ?', args: [status, limit] })
    : await db.execute({ sql: 'SELECT * FROM replies ORDER BY id DESC LIMIT ?', args: [limit] })
  return res.rows.map(toReply)
}

export async function countRepliesToday(db: Db, today: string, status: ReplyStatus): Promise<number> {
  const res = await db.execute({
    sql: 'SELECT COUNT(*) AS c FROM replies WHERE status = ? AND substr(updated_at, 1, 10) = ?',
    args: [status, today],
  })
  return Number(res.rows[0]?.c ?? 0)
}

// 디버깅 모드에서 '운영이었다면 자동 전송이었을' 기록 수. 하루 상한을 디버깅 중에도 똑같이 적용해 본다.
export async function countIntendedSendToday(db: Db, today: string): Promise<number> {
  const res = await db.execute({
    sql: "SELECT COUNT(*) AS c FROM replies WHERE status = 'simulated' AND intended = 'send' AND substr(updated_at, 1, 10) = ?",
    args: [today],
  })
  return Number(res.rows[0]?.c ?? 0)
}

export async function listDebugRecords(db: Db, sinceDate: string, limit = 500): Promise<Reply[]> {
  const res = await db.execute({
    sql: "SELECT * FROM replies WHERE status = 'simulated' AND substr(updated_at, 1, 10) >= ? ORDER BY updated_at DESC, id DESC LIMIT ?",
    args: [sinceDate, limit],
  })
  return res.rows.map(toReply)
}

// 디버깅 기록에서 정책이 얼마나 쓰였는지. 한 번도 안 쓰인 정책도 같이 돌려준다.
export function policyUsage(records: Reply[], policies: PolicyDoc[]) {
  const counts = new Map<number, number>()
  for (const r of records) for (const id of r.policyIds) counts.set(id, (counts.get(id) ?? 0) + 1)
  return {
    used: policies.filter((p) => counts.has(p.id)).map((p) => ({ id: p.id, title: p.title, count: counts.get(p.id)! })).sort((a, b) => b.count - a.count),
    unused: policies.filter((p) => !counts.has(p.id)).map((p) => ({ id: p.id, title: p.title })),
    recordsWithoutPolicy: records.filter((r) => r.policyIds.length === 0).length,
  }
}

const tally = (items: string[]) => {
  const m = new Map<string, number>()
  for (const k of items) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

// 디버깅 기록을 운영이었다면의 결과, 참고한 템플릿, 날짜별로 센다.
export function summarizeDebug(records: Reply[]) {
  return {
    total: records.length,
    byIntended: Object.fromEntries(tally(records.map((r) => (r.intended === 'send' ? 'wouldAutoSend' : 'wouldBeDraft')))),
    byTemplate: tally(records.map((r) => (r.templateId ? `#${r.templateId} ${r.templateTitle ?? ''}`.trim() : '템플릿 없이 작성'))).map(
      ([template, count]) => ({ template, count }),
    ),
    byDay: tally(records.map((r) => r.updatedAt.slice(0, 10)))
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, count]) => ({ day, count })),
  }
}

export async function countDrafts(db: Db): Promise<number> {
  const res = await db.execute("SELECT COUNT(*) AS c FROM replies WHERE status = 'draft'")
  return Number(res.rows[0]?.c ?? 0)
}

export { todayKst }
