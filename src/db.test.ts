import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { afterAll, describe, expect, it } from 'vitest'
import { openDb } from './db.js'

const dir = mkdtempSync(join(tmpdir(), 'lets-cs-db-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('DB 열기', () => {
  it('컬럼이 모자란 옛 DB 에도 없는 컬럼만 붙이고, 다시 열어도 에러가 없다', async () => {
    const url = `file:${join(dir, 'old.db')}`
    const old = createClient({ url })
    await old.execute(
      'CREATE TABLE replies (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, challenge_id INTEGER NOT NULL, template_id INTEGER, status TEXT NOT NULL, body TEXT NOT NULL, error TEXT, user_name TEXT, question_title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
    )
    old.close()

    const db = await openDb(url)
    const cols = (await db.execute('PRAGMA table_info(replies)')).rows.map((r) => r.name)
    for (const c of ['note', 'question_content', 'challenge_title', 'template_title', 'intended', 'policy_ids', 'question_created_at']) expect(cols).toContain(c)
    await expect(openDb(url)).resolves.toBeDefined()
  })
})
