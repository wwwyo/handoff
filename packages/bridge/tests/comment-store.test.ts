/**
 * What: CommentStore#add の id-upsert セマンティクスと 'added' イベントの発火条件を検証する。
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
  it('同じ id で2回 add しても重複しない', () => {
    const store = new CommentStore()
    store.add(makeComment(), PAGE_URL)
    store.add(makeComment({ text: '直った' }), PAGE_URL)

    const comments = store.list()
    expect(comments).toHaveLength(1)
    expect(comments[0]?.text).toBe('直った')
  })

  it('新規 id では added イベントが発火する', () => {
    const store = new CommentStore()
    const listener = vi.fn()
    store.on('added', listener)

    store.add(makeComment(), PAGE_URL)

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('既存 id の更新では added イベントが発火しない（既読変更・編集などのノイズを channel に流さないため）', () => {
    const store = new CommentStore()
    const listener = vi.fn()
    store.add(makeComment(), PAGE_URL)
    store.on('added', listener)

    store.add(makeComment({ unread: false }), PAGE_URL)
    store.add(makeComment({ text: '編集した' }), PAGE_URL)

    expect(listener).not.toHaveBeenCalled()
  })
})
