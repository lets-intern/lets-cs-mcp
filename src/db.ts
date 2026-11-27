import type { Client } from '@libsql/client'

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
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
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
  const have = new Set((await db.execute('PRAGMA table_info(replies)')).rows.map((r) => String(r.name)))
  for (const col of ['note', 'question_content', 'challenge_title', 'template_title', 'intended']) {
    if (!have.has(col)) await db.execute(`ALTER TABLE replies ADD COLUMN ${col} TEXT`)
  }
  return db
}
