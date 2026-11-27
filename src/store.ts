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
  createdAt: string
  updatedAt: string
}

export type TemplateFields = Omit<Template, 'id' | 'enabled' | 'createdAt' | 'updatedAt'>

export type TemplateStatus = 'active' | 'disabled' | 'upcoming' | 'expired'

const num = (v: unknown) => (v == null ? null : Number(v))
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
    sql: `INSERT INTO templates (title, situation, body, challenge_id, valid_from, valid_until, enabled, auto_send, priority, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?) RETURNING *`,
    args: [f.title, f.situation, f.body, f.challengeId, f.validFrom, f.validUntil, f.autoSend ? 1 : 0, f.priority, at, at],
  })
  return toTemplate(res.rows[0]!)
}

export async function updateTemplate(db: Db, id: number, f: TemplateFields, now: Date): Promise<Template | null> {
  const res = await db.execute({
    sql: `UPDATE templates SET title=?, situation=?, body=?, challenge_id=?, valid_from=?, valid_until=?, auto_send=?, priority=?, updated_at=?
          WHERE id=? RETURNING *`,
    args: [f.title, f.situation, f.body, f.challengeId, f.validFrom, f.validUntil, f.autoSend ? 1 : 0, f.priority, kstNow(now), id],
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
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
})

export type NewReply = Omit<Reply, 'id' | 'createdAt' | 'updatedAt'>

export async function insertReply(db: Db, r: NewReply, now: Date): Promise<Reply> {
  const at = kstNow(now)
  const res = await db.execute({
    sql: `INSERT INTO replies (question_id, challenge_id, template_id, status, body, error, user_name, question_title, note,
                                 question_content, challenge_title, template_title, intended, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    args: [
      r.questionId, r.challengeId, r.templateId, r.status, r.body, r.error, r.userName, r.questionTitle, r.note,
      r.questionContent, r.challengeTitle, r.templateTitle, r.intended, at, at,
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
  },
  now: Date,
): Promise<Reply> {
  const res = await db.execute({
    sql: `UPDATE replies SET status = ?, body = COALESCE(?, body), template_id = COALESCE(?, template_id), error = ?, note = ?,
              template_title = COALESCE(?, template_title), intended = COALESCE(?, intended), updated_at = ?
          WHERE id = ? RETURNING *`,
    args: [
      patch.status, patch.body ?? null, patch.templateId ?? null, patch.error ?? null, patch.note ?? null,
      patch.templateTitle ?? null, patch.intended ?? null, kstNow(now), id,
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

export async function listReplies(db: Db, limit = 100): Promise<Reply[]> {
  const res = await db.execute({ sql: 'SELECT * FROM replies ORDER BY id DESC LIMIT ?', args: [limit] })
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

export async function countDrafts(db: Db): Promise<number> {
  const res = await db.execute("SELECT COUNT(*) AS c FROM replies WHERE status = 'draft'")
  return Number(res.rows[0]?.c ?? 0)
}

export { todayKst }
