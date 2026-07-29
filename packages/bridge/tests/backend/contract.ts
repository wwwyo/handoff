/**
 * `CommentBackend`（`../../src/backend/types.ts`、凍結済み）の契約を検証する共有テスト。
 *
 * What: create の conflict / update の null / delete の false / addReply の null /
 * list の cursor 継続、という「どの実装も満たすべき」振る舞いだけを見る。
 * backend 固有の詳細（GitHub の issue 化・Postgres のトランザクション有無など）は
 * それぞれの実装のテストファイル側で個別に検証すること。
 *
 * Why shared: github/postgres の実装も同じテストを流用できるようにするため
 * （decision.log 参照）。`describe.each` 等で個別ファイルから
 * `runCommentBackendContractTests(() => backend)` を呼ぶ想定。
 */
import { describe, expect, it } from 'vitest'
import type { Comment, Reply } from '@wwwyo/handoff/types'
import type { CommentBackend } from '../../src/backend/types.js'

const PAGE_URL = 'http://localhost:5173/page-a'

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    anchor: {
      selector: 'body > div',
      offsetX: 0.5,
      offsetY: 0.5,
      viewportX: 0.1,
      viewportY: 0.1,
    },
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

/**
 * `createBackend` は各テストケースの前にまっさらな backend を用意して返すこと
 * （テスト間で状態を共有すると、conflict/cursor のテストが順序に依存してしまう）。
 */
export function runCommentBackendContractTests(createBackend: () => CommentBackend | Promise<CommentBackend>): void {
  describe('CommentBackend contract', () => {
    it('create: 新規 id は作成できる', async () => {
      const backend = await createBackend()
      const result = await backend.create({ comment: makeComment(), pageUrl: PAGE_URL })
      expect(result.created).toBe(true)
    })

    it('create: 既存 id は conflict になり、既存の内容は変わらない', async () => {
      const backend = await createBackend()
      await backend.create({ comment: makeComment(), pageUrl: PAGE_URL })
      const result = await backend.create({ comment: makeComment({ text: '別内容' }), pageUrl: PAGE_URL })

      expect(result.created).toBe(false)
      if (!result.created) expect(result.reason).toBe('conflict')

      const stored = await backend.get('c1')
      expect(stored?.comment.text).toBe('ここ直して')
    })

    it('update: 存在しない id は null を返す', async () => {
      const backend = await createBackend()
      const result = await backend.update('missing', { text: 'x' })
      expect(result).toBeNull()
    })

    it('update: 許可されたフィールドを部分更新できる', async () => {
      const backend = await createBackend()
      await backend.create({ comment: makeComment(), pageUrl: PAGE_URL })
      const updated = await backend.update('c1', { resolved: true, resolvedBy: 'yuito' })
      expect(updated?.comment.resolved).toBe(true)
      expect(updated?.comment.resolvedBy).toBe('yuito')
      expect(updated?.comment.text).toBe('ここ直して')
    })

    it('delete: 存在しない id は false を返す', async () => {
      const backend = await createBackend()
      const result = await backend.delete('missing')
      expect(result).toBe(false)
    })

    it('delete: 存在する id を削除でき、以降 get で見えなくなる', async () => {
      const backend = await createBackend()
      await backend.create({ comment: makeComment(), pageUrl: PAGE_URL })
      const result = await backend.delete('c1')
      expect(result).toBe(true)
      expect(await backend.get('c1')).toBeNull()
    })

    it('addReply: 存在しない comment_id は null を返す', async () => {
      const backend = await createBackend()
      const result = await backend.addReply('missing', makeReply())
      expect(result).toBeNull()
    })

    it('addReply: 返信が積まれ、その後の update でも保たれる', async () => {
      const backend = await createBackend()
      await backend.create({ comment: makeComment(), pageUrl: PAGE_URL })
      await backend.addReply('c1', makeReply())
      const updated = await backend.update('c1', { resolved: true })
      expect(updated?.comment.replies).toHaveLength(1)
      expect(updated?.comment.replies[0]?.id).toBe('r1')
    })

    it('list: pageUrl を指定するとそのページの分だけに絞られる', async () => {
      const backend = await createBackend()
      await backend.create({ comment: makeComment({ id: 'a' }), pageUrl: 'http://x/1' })
      await backend.create({ comment: makeComment({ id: 'b' }), pageUrl: 'http://x/2' })

      const result = await backend.list({ pageUrl: 'http://x/1' })
      expect(result.items.map((i) => i.comment.id)).toEqual(['a'])
    })

    it('list: 返される各要素の pageUrl が create 時に渡した値と一致する', async () => {
      const backend = await createBackend()
      await backend.create({ comment: makeComment({ id: 'a' }), pageUrl: 'http://x/1' })
      await backend.create({ comment: makeComment({ id: 'b' }), pageUrl: 'http://x/2' })

      const all = await backend.list({})
      const pageUrlById = new Map(all.items.map((i) => [i.comment.id, i.pageUrl]))
      expect(pageUrlById.get('a')).toBe('http://x/1')
      expect(pageUrlById.get('b')).toBe('http://x/2')
    })

    it('list: cursor と limit で続きから取得でき、末尾では nextCursor が undefined になる', async () => {
      const backend = await createBackend()
      await backend.create({ comment: makeComment({ id: 'a' }), pageUrl: PAGE_URL })
      await backend.create({ comment: makeComment({ id: 'b' }), pageUrl: PAGE_URL })
      await backend.create({ comment: makeComment({ id: 'c' }), pageUrl: PAGE_URL })

      const first = await backend.list({ pageUrl: PAGE_URL, limit: 2 })
      expect(first.items).toHaveLength(2)
      expect(first.nextCursor).toBeDefined()

      const second = await backend.list({ pageUrl: PAGE_URL, cursor: first.nextCursor, limit: 2 })
      expect(second.items.length).toBeGreaterThanOrEqual(1)
      expect(second.nextCursor).toBeUndefined()

      // 2回に分けて取得した id の集合が、全件取得した id の集合と一致する
      const all = await backend.list({ pageUrl: PAGE_URL })
      const paginatedIds = [...first.items, ...second.items].map((i) => i.comment.id).sort()
      expect(paginatedIds).toEqual(all.items.map((i) => i.comment.id).sort())
    })
  })
}
