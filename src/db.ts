import type { Client } from '@libsql/client'
import { kstNow } from './dates.js'

export type Db = Client

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    situation TEXT NOT NULL,
    body TEXT NOT NULL,
    challenge_id INTEGER,
    valid_from TEXT,
    valid_until TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    auto_send INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    policy_ids TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    challenge_id INTEGER NOT NULL,
    template_id INTEGER,
    status TEXT NOT NULL,
    body TEXT NOT NULL,
    error TEXT,
    user_name TEXT,
    question_title TEXT,
    note TEXT,
    question_content TEXT,
    challenge_title TEXT,
    template_title TEXT,
    intended TEXT,
    policy_ids TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS policy_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    applies_when TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_editor TEXT NOT NULL DEFAULT '사람',
    imported_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  // 고치기 전 내용을 남긴다. AI 가 정리해도 되돌릴 수 있게 한다.
  `CREATE TABLE IF NOT EXISTS policy_doc_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    applies_when TEXT NOT NULL,
    tags TEXT NOT NULL,
    body TEXT NOT NULL,
    replaced_by TEXT NOT NULL,
    edit_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  // 한 문의에는 초안이나 전송 기록이 하나만 살아 있을 수 있다. 중복 전송을 DB 가 막는다.
  `CREATE UNIQUE INDEX IF NOT EXISTS replies_one_live ON replies(question_id) WHERE status IN ('draft','sent')`,
]

// 원격 Turso 는 웹 클라이언트, 로컬 파일과 메모리는 네이티브 클라이언트를 쓴다. 서버리스 번들에 네이티브 모듈이 섞이지 않게 나눈다.
export async function openDb(url: string, authToken?: string): Promise<Db> {
  const remote = /^(libsql|https?|wss?):/.test(url)
  const mod = remote ? await import('@libsql/client/web') : await import('@libsql/client')
  const db = mod.createClient({ url, authToken })
  await db.batch(SCHEMA, 'write')
  // 컬럼이 늘기 전에 만든 DB 를 위해 없는 컬럼만 덧붙인다.
  await ensureColumns(db, 'replies', ['note', 'question_content', 'challenge_title', 'template_title', 'intended', 'policy_ids'])
  await ensureColumns(db, 'templates', ['policy_ids'])
  // 이 DB 가 처음 열린 시각. 배포마다 DB 가 비워지는지 확인하려고 남긴다.
  await db.execute({ sql: "INSERT OR IGNORE INTO settings (key, value) VALUES ('db_created_at', ?)", args: [kstNow()] })
  return db
}

async function ensureColumns(db: Db, table: string, columns: string[]): Promise<void> {
  const have = new Set((await db.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name)))
  for (const col of columns) {
    if (!have.has(col)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`)
  }
}
