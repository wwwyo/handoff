/**
 * What: CommentStore の作成専用 add / 部分更新 update / delete / addReply の契約を検証する。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Comment } from '@wwwyo/handoff/types'
import { CommentStore } from '../src/comment-store.js'

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

describe('CommentStore#add', () => {
  it('新規 id は作成に成功し、added イベントが発火する', () => {
    const store = new CommentStore()
    const listener = vi.fn()
    store.on('added', listener)

    const created = store.add(makeComment(), PAGE_URL)

    expect(created).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.list()).toHaveLength(1)
  })

  it('既存 id への add は失敗し、既存の内容は変わらない（作成専用・upsert ではない）', () => {
    const store = new CommentStore()
    const listener = vi.fn()
    store.add(makeComment(), PAGE_URL)
    store.on('added', listener)

    const created = store.add(makeComment({ text: '別の内容' }), PAGE_URL)

    expect(created).toBe(false)
    expect(listener).not.toHaveBeenCalled()
    expect(store.list()[0]?.text).toBe('ここ直して')
  })
})

describe('CommentStore#update', () => {
  it('許可されたフィールドを部分更新し、updatedAt をサーバ側の現在時刻で更新する', () => {
    const store = new CommentStore()
    store.add(makeComment(), PAGE_URL)

    const updated = store.update('c1', { resolved: true, resolvedBy: 'yuito' })

    expect(updated?.resolved).toBe(true)
    expect(updated?.resolvedBy).toBe('yuito')
    expect(updated?.text).toBe('ここ直して') // patch に無いフィールドは変わらない
    expect(updated?.updatedAt).not.toBe('2026-07-28T00:00:00.000Z')
  })

  it('既存の replies は update で変わらない（PATCH は replies を受け付けないため、そもそも patch に含まれない前提）', () => {
    const store = new CommentStore()
    store.add(makeComment(), PAGE_URL)
    store.addReply('c1', {
      id: 'r1',
      author: 'claude',
      text: '直しました',
      createdAt: '2026-07-28T01:00:00.000Z',
      updatedAt: '2026-07-28T01:00:00.000Z',
    })

    const updated = store.update('c1', { text: '編集後' })

    expect(updated?.replies).toHaveLength(1)
    expect(updated?.replies[0]?.id).toBe('r1')
  })

  it('存在しない id は null を返す', () => {
    const store = new CommentStore()
    expect(store.update('missing', { text: 'x' })).toBeNull()
  })
})

describe('CommentStore#delete', () => {
  it('存在する id を削除し true を返す', () => {
    const store = new CommentStore()
    store.add(makeComment({ id: 'a' }), PAGE_URL)
    store.add(makeComment({ id: 'b' }), PAGE_URL)

    const deleted = store.delete('a')

    expect(deleted).toBe(true)
    expect(store.list().map((c) => c.id)).toEqual(['b'])
  })

  it('存在しない id は false を返す', () => {
    const store = new CommentStore()
    expect(store.delete('missing')).toBe(false)
  })
})

describe('CommentStore#addReply', () => {
  /**
   * What: 回帰テスト。channel の reply tool が積んだ返信が、その後の update（PATCH 相当）で
   * 消えないことを検証する（バグ2 の再発防止。以前の replaceAll は消していた）。
   */
  it('reply tool が積んだ返信は、その後の update で保たれる', () => {
    const store = new CommentStore()
    store.add(makeComment({ id: 'a' }), PAGE_URL)

    const claudeReply = {
      id: 'r1',
      author: 'claude',
      text: '直しました',
      createdAt: '2026-07-28T01:00:00.000Z',
      updatedAt: '2026-07-28T01:00:00.000Z',
    }
    store.addReply('a', claudeReply)

    // ブラウザ側は「resolved を true にする」という部分更新だけを送る（replies には触れない）
    const updated = store.update('a', { resolved: true, resolvedBy: 'yuito' })

    expect(updated?.replies).toHaveLength(1)
    expect(updated?.replies[0]?.id).toBe('r1')
  })

  it('存在しない comment_id には null を返す', () => {
    const store = new CommentStore()
    const result = store.addReply('missing', {
      id: 'r1',
      author: 'claude',
      text: 'x',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
    })
    expect(result).toBeNull()
  })
})
