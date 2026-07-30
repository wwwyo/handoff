/**
 * What: `PostgresBackend.create()` が単一トランザクション（begin → insert comment →
 * insert reply(ies) → commit、失敗時は rollback）で書き込むことを検証する（fix 4）。
 *
 * Why a separate file from `postgres.test.ts`: このファイルは `pg` の `Pool` を
 * まるごとモックに差し替える（`vi.mock('pg', ...)` はファイル単位で効く）。
 * `postgres.test.ts` は `HANDOFF_TEST_DATABASE_URL` があるときに実 Postgres へ
 * 接続する integration describe を持っており、同じファイルで `pg` をモックすると
 * その integration 経路まで巻き込んで壊れる。モックの影響範囲をこのファイルだけに
 * 閉じるために分けた。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Comment, Reply } from '@wwwyo/handoff/types'
import { createPostgresBackend } from '../../src/backend/postgres.js'

// vi.mock はファイル先頭へ hoist されるため、参照する変数は vi.hoisted で先に用意する。
const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }))

// アロー関数は `new` で呼べない（constructor にできない）ため、`function` 宣言で
// モックする。`postgres.ts` は `new Pool(...)` と new 式で呼ぶ。
vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function FakePool() {
    return { connect: connectMock, query: vi.fn(), end: vi.fn() }
  }),
}))

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

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: 'r1',
    author: 'claude',
    text: '直しました',
    createdAt: '2026-07-28T01:00:00.000Z',
    updatedAt: '2026-07-28T01:00:00.000Z',
    ...overrides,
  }
}

const INSERTED_COMMENT_ROW = {
  id: 'c1',
  page_url: 'http://x/1',
  author: 'yuito',
  text: 'ここ直して',
  anchor: { selector: 'body > div' },
  scope: null,
  meta: null,
  resolved: false,
  resolved_by: null,
  resolved_at: null,
  unread: true,
  created_at: '2026-07-28T00:00:00.000Z',
  updated_at: '2026-07-28T00:00:00.000Z',
  seq: '1',
}

/** `client.query` の呼び出しを記録しつつ、クエリの種類ごとに妥当な結果を返すフェイク。 */
function makeFakeClient(options: { insertCommentReturnsRow: boolean; failReplyInsert?: boolean }) {
  const calls: string[] = []
  const query = vi.fn(async (text: string) => {
    calls.push(text)
    if (text === 'begin' || text === 'commit' || text === 'rollback') return { rows: [] }
    if (text.includes('insert into handoff_comments')) {
      return { rows: options.insertCommentReturnsRow ? [INSERTED_COMMENT_ROW] : [] }
    }
    if (text.includes('insert into handoff_replies')) {
      if (options.failReplyInsert) throw new Error('reply insert failed')
      return { rows: [] }
    }
    return { rows: [] }
  })
  const release = vi.fn()
  return { calls, client: { query, release } }
}

describe('createPostgresBackend().create() のトランザクション', () => {
  beforeEach(() => {
    connectMock.mockReset()
  })

  it('begin -> insert comment -> insert reply(ies) -> commit の順でクエリを発行する', async () => {
    const { calls, client } = makeFakeClient({ insertCommentReturnsRow: true })
    connectMock.mockResolvedValue(client)

    const backend = createPostgresBackend({ connectionString: 'postgres://fake' })
    const comment = makeComment({ replies: [makeReply()] })
    const result = await backend.create({ comment, pageUrl: 'http://x/1' })

    expect(result.created).toBe(true)
    expect(calls[0]).toBe('begin')
    expect(calls[1]).toContain('insert into handoff_comments')
    expect(calls[2]).toContain('insert into handoff_replies')
    expect(calls[3]).toBe('commit')
    expect(calls).not.toContain('rollback')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('複数 replies があれば insert comment の後、insert reply が複数回続いてから commit する', async () => {
    const { calls, client } = makeFakeClient({ insertCommentReturnsRow: true })
    connectMock.mockResolvedValue(client)

    const backend = createPostgresBackend({ connectionString: 'postgres://fake' })
    const comment = makeComment({ replies: [makeReply({ id: 'r1' }), makeReply({ id: 'r2' })] })
    await backend.create({ comment, pageUrl: 'http://x/1' })

    expect(calls).toEqual([
      'begin',
      expect.stringContaining('insert into handoff_comments'),
      expect.stringContaining('insert into handoff_replies'),
      expect.stringContaining('insert into handoff_replies'),
      'commit',
    ])
  })

  it('reply insert が失敗したら rollback してから例外を投げる（コメントだけ残って返信が消える事故を防ぐ）', async () => {
    const { calls, client } = makeFakeClient({ insertCommentReturnsRow: true, failReplyInsert: true })
    connectMock.mockResolvedValue(client)

    const backend = createPostgresBackend({ connectionString: 'postgres://fake' })
    const comment = makeComment({ replies: [makeReply()] })

    await expect(backend.create({ comment, pageUrl: 'http://x/1' })).rejects.toThrow('reply insert failed')
    expect(calls).toContain('rollback')
    expect(calls).not.toContain('commit')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('id 衝突（insert が行を返さない）のときは commit せず rollback して conflict を返す', async () => {
    const { calls, client } = makeFakeClient({ insertCommentReturnsRow: false })
    connectMock.mockResolvedValue(client)

    const backend = createPostgresBackend({ connectionString: 'postgres://fake' })
    const result = await backend.create({ comment: makeComment(), pageUrl: 'http://x/1' })

    expect(result).toEqual({ created: false, reason: 'conflict' })
    expect(calls).toEqual(['begin', expect.stringContaining('insert into handoff_comments'), 'rollback'])
    expect(calls).not.toContain('commit')
    expect(client.release).toHaveBeenCalledOnce()
  })
})
