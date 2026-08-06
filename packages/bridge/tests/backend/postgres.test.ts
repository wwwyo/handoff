/**
 * What: `PostgresBackend` の SQL 組み立て・行 <-> Comment/Reply 変換・cursor 符号化を
 * DB 無しで検証し（unit）、`HANDOFF_TEST_DATABASE_URL` があるときだけ実 DB に
 * つないで `CommentBackend` 契約（`./contract.ts`）を検証する（integration）。
 *
 * Why skip: CI に Postgres が無い。`pnpm test` が DB 無しの環境で必ず green に
 * なるよう、integration 側は describe.skip で丸ごと落とす。
 */
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Comment } from '@wwwyo/handoff/types'
import type { CommentBackend } from '../../src/backend/types.js'
import {
  assertSafeIdentifier,
  buildInsertCommentQuery,
  buildListCommentsQuery,
  buildRepliesQuery,
  buildUpdateCommentQuery,
  createPostgresBackend,
  decodeCursor,
  encodeCursor,
  replyRowToReply,
  rowToComment,
} from '../../src/backend/postgres.js'
import { runCommentBackendContractTests } from './contract.js'

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    anchor: { selector: 'body > div', offsetX: 0.5, offsetY: 0.5, viewportX: 0.1, viewportY: 0.1 },
    author: 'yuito',
    text: 'ここ直して',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    resolved: false,
    unread: true,
    replies: [],
    ...overrides,
  }
}

describe('assertSafeIdentifier', () => {
  it('英数字とアンダースコアだけの識別子はそのまま返す', () => {
    expect(assertSafeIdentifier('handoff_')).toBe('handoff_')
    expect(assertSafeIdentifier('a1_B2')).toBe('a1_B2')
  })

  it.each([
    ['空文字', ''],
    ['先頭が数字', '1abc'],
    ['セミコロンを含む (SQL injection の典型)', "handoff_; drop table x; --"],
    ['スペースを含む', 'handoff comments'],
    ['ドットを含む', 'handoff.comments'],
    ['長すぎる', 'a'.repeat(41)],
  ])('%s は拒否する: %s', (_label, input) => {
    expect(() => assertSafeIdentifier(input)).toThrow()
  })
})

describe('cursor の符号化', () => {
  it('encode/decode は往復する', () => {
    expect(decodeCursor(encodeCursor('42'))).toBe('42')
  })

  it('数字以外の cursor は拒否する', () => {
    expect(() => decodeCursor('42; drop table handoff_comments')).toThrow()
    expect(() => decodeCursor('abc')).toThrow()
    expect(() => decodeCursor('')).toThrow()
  })
})

describe('buildListCommentsQuery', () => {
  it('条件が無ければ where 句を作らず、limit+1件を要求する', () => {
    const { text, values, limit } = buildListCommentsQuery('handoff_comments', {})
    expect(limit).toBe(50)
    expect(text).not.toContain('where')
    expect(text).toContain('order by seq asc')
    expect(values).toEqual([51])
  })

  it('pageUrl と cursor を両方指定すると and で繋いだ where 句になる', () => {
    const { text, values, limit } = buildListCommentsQuery('handoff_comments', {
      pageUrl: 'http://x/1',
      cursor: '10',
      limit: 5,
    })
    expect(limit).toBe(5)
    expect(text).toContain('page_url = $1')
    expect(text).toContain('seq > $2::bigint')
    expect(text).toContain('and')
    expect(values).toEqual(['http://x/1', '10', 6])
  })

  it('cursor が不正な文字列なら例外を投げる（呼び出し前に弾く）', () => {
    expect(() => buildListCommentsQuery('handoff_comments', { cursor: 'not-a-number' })).toThrow()
  })
})

describe('buildRepliesQuery', () => {
  it('comment_id の配列をパラメータ化する', () => {
    const { text, values } = buildRepliesQuery('handoff_replies', ['a', 'b'])
    expect(text).toContain('= any($1::text[])')
    expect(values).toEqual([['a', 'b']])
  })
})

describe('buildInsertCommentQuery', () => {
  it('anchor/scope/meta を JSON 文字列化し、未指定は null にする', () => {
    const { text, values } = buildInsertCommentQuery('handoff_comments', makeComment(), 'http://x/1')
    expect(text).toContain('on conflict (id) do nothing')
    expect(values[0]).toBe('c1')
    expect(values[1]).toBe('http://x/1')
    expect(values[4]).toBe(JSON.stringify(makeComment().anchor))
    expect(values[5]).toBeNull() // scope 未指定
    expect(values[6]).toBeNull() // meta 未指定
  })

  it('scope/meta が指定されていれば JSON 文字列化して積む', () => {
    const comment = makeComment({ scope: { tab: 'settings' }, meta: { source: 'agent' } })
    const { values } = buildInsertCommentQuery('handoff_comments', comment, 'http://x/1')
    expect(values[5]).toBe(JSON.stringify({ tab: 'settings' }))
    expect(values[6]).toBe(JSON.stringify({ source: 'agent' }))
  })
})

describe('buildUpdateCommentQuery', () => {
  it('patch に含まれるフィールドだけを SET し、updated_at は常に含める', () => {
    const { text, values } = buildUpdateCommentQuery('handoff_comments', 'c1', { resolved: true }, '2026-07-30T00:00:00.000Z')
    expect(text).toContain('resolved = $1')
    expect(text).toContain('updated_at = $2')
    expect(text).not.toContain('text = ')
    expect(values).toEqual([true, '2026-07-30T00:00:00.000Z', 'c1'])
  })

  it('複数フィールドを同時に更新できる', () => {
    const { text, values } = buildUpdateCommentQuery(
      'handoff_comments',
      'c1',
      { text: '直った', resolved: true, resolvedBy: 'yuito' },
      '2026-07-30T00:00:00.000Z',
    )
    expect(text).toContain('text = $1')
    expect(text).toContain('resolved = $2')
    expect(text).toContain('resolved_by = $3')
    expect(text).toContain('updated_at = $4')
    expect(values).toEqual(['直った', true, 'yuito', '2026-07-30T00:00:00.000Z', 'c1'])
  })
})

describe('rowToComment / replyRowToReply', () => {
  it('必須フィールドのみの行を Comment へ変換する（optional は省く）', () => {
    const comment = rowToComment(
      {
        id: 'c1',
        page_url: 'http://x/1',
        author: 'yuito',
        text: 'hi',
        anchor: { selector: 'a' },
        scope: null,
        meta: null,
        resolved: false,
        resolved_by: null,
        resolved_at: null,
        unread: true,
        created_at: '2026-07-28T00:00:00.000Z',
        updated_at: '2026-07-28T00:00:00.000Z',
        seq: '1',
      },
      [],
    )
    expect(comment.scope).toBeUndefined()
    expect(comment.resolvedBy).toBeUndefined()
    expect(comment.resolvedAt).toBeUndefined()
    expect(comment.meta).toBeUndefined()
    expect(comment.replies).toEqual([])
  })

  it('Date 型のタイムスタンプも ISO 文字列へ正規化する', () => {
    const comment = rowToComment(
      {
        id: 'c1',
        page_url: 'http://x/1',
        author: 'yuito',
        text: 'hi',
        anchor: { selector: 'a' },
        scope: { tab: 'x' },
        meta: { source: 'human' },
        resolved: true,
        resolved_by: 'yuito',
        resolved_at: new Date('2026-07-29T00:00:00.000Z'),
        unread: false,
        created_at: new Date('2026-07-28T00:00:00.000Z'),
        updated_at: new Date('2026-07-28T01:00:00.000Z'),
        seq: '2',
      },
      [],
    )
    expect(comment.createdAt).toBe('2026-07-28T00:00:00.000Z')
    expect(comment.updatedAt).toBe('2026-07-28T01:00:00.000Z')
    expect(comment.resolvedAt).toBe('2026-07-29T00:00:00.000Z')
    expect(comment.scope).toEqual({ tab: 'x' })
    expect(comment.meta).toEqual({ source: 'human' })
  })

  it('reply の行を Reply へ変換する', () => {
    const reply = replyRowToReply({
      id: 'r1',
      comment_id: 'c1',
      author: 'claude',
      text: '直しました',
      created_at: '2026-07-28T01:00:00.000Z',
      updated_at: '2026-07-28T01:00:00.000Z',
    })
    expect(reply).toEqual({
      id: 'r1',
      author: 'claude',
      text: '直しました',
      createdAt: '2026-07-28T01:00:00.000Z',
      updatedAt: '2026-07-28T01:00:00.000Z',
    })
  })
})

const DATABASE_URL = process.env.HANDOFF_TEST_DATABASE_URL

// CI に Postgres は無い。env が無い環境では丸ごと skip し、pnpm test を green に保つ。
describe.skipIf(!DATABASE_URL)('PostgresBackend (integration)', () => {
  // 他のテスト実行やこのファイルの再実行とテーブル名が衝突しないよう、実行ごとに
  // ランダムな tablePrefix でテーブルを作る（migrations/0001_init.sql と同じスキーマ）。
  const tablePrefix = `handoff_test_${Date.now()}_`
  const commentsTable = `${tablePrefix}comments`
  const repliesTable = `${tablePrefix}replies`
  const setupPool = new Pool({ connectionString: DATABASE_URL })
  // createBackend() のたびに新しい Pool ができるので、テスト後に閉じ忘れない。
  const createdBackends: CommentBackend[] = []

  beforeAll(async () => {
    await setupPool.query(`
      create table ${commentsTable} (
        id text primary key,
        page_url text not null,
        author text not null,
        text text not null,
        anchor jsonb not null,
        scope jsonb,
        meta jsonb,
        resolved boolean not null default false,
        resolved_by text,
        resolved_at timestamptz,
        unread boolean not null default true,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        seq bigserial not null unique
      )
    `)
    await setupPool.query(`
      create table ${repliesTable} (
        id text primary key,
        comment_id text not null references ${commentsTable} (id) on delete cascade,
        author text not null,
        text text not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        seq bigserial not null unique
      )
    `)
  })

  afterAll(async () => {
    await setupPool.query(`drop table if exists ${repliesTable}`)
    await setupPool.query(`drop table if exists ${commentsTable}`)
    await setupPool.end()
  })

  // contract.ts は「各テストケースの前にまっさらな backend」を前提にしているため、
  // テストごとに中身を空にする。一つの truncate 文にまとめて FK 違反を避ける。
  beforeEach(async () => {
    await setupPool.query(`truncate table ${repliesTable}, ${commentsTable}`)
  })

  afterEach(async () => {
    await Promise.all(createdBackends.splice(0).map((backend) => backend.close?.()))
  })

  runCommentBackendContractTests(() => {
    const backend = createPostgresBackend({ connectionString: DATABASE_URL as string, tablePrefix })
    createdBackends.push(backend)
    return backend
  })
})
