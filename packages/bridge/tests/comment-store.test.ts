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

describe('CommentStore#replaceAll', () => {
  /**
   * What: ブラウザ由来の PUT（`all` = ブラウザが知っている範囲）が、bridge の
   * reply tool だけが積んだ返信を巻き添えで消さないことを検証する（バグ2 再現手順）。
   */
  it('ブラウザが把握していない bridge 側の返信を、PUT による置換後も保持する', () => {
    const store = new CommentStore()
    store.add(makeComment({ id: 'a' }), PAGE_URL)
    store.add(makeComment({ id: 'b' }), PAGE_URL)

    // Claude が reply tool で A に返信 → bridge 側にしか無い返信ができる
    const claudeReply = {
      id: 'r1',
      author: 'claude',
      text: '直しました',
      createdAt: '2026-07-28T01:00:00.000Z',
      updatedAt: '2026-07-28T01:00:00.000Z',
    }
    store.addReply('a', claudeReply)

    // ブラウザが B を削除して、自分が知っている範囲（返信なしの A のみ）を PUT する
    store.replaceAll(PAGE_URL, [makeComment({ id: 'a', replies: [] })])

    const comments = store.list()
    expect(comments.map((c) => c.id)).toEqual(['a'])
    expect(comments[0]?.replies).toHaveLength(1)
    expect(comments[0]?.replies[0]?.id).toBe('r1')
  })

  it('ブラウザが返信を認識している場合はブラウザ側の内容をそのまま使う（重複させない）', () => {
    const store = new CommentStore()
    store.add(makeComment({ id: 'a' }), PAGE_URL)
    const reply = {
      id: 'r1',
      author: 'claude',
      text: '直しました',
      createdAt: '2026-07-28T01:00:00.000Z',
      updatedAt: '2026-07-28T01:00:00.000Z',
    }
    store.addReply('a', reply)

    // ブラウザ側が既にこの返信を認識した状態で PUT してきたケース
    store.replaceAll(PAGE_URL, [makeComment({ id: 'a', replies: [reply] })])

    const comments = store.list()
    expect(comments[0]?.replies).toHaveLength(1)
  })

  it('他ページのコメントは巻き添えにしない', () => {
    const store = new CommentStore()
    store.add(makeComment({ id: 'a' }), PAGE_URL)
    store.add(makeComment({ id: 'other' }), 'http://localhost:5173/other-page')

    store.replaceAll(PAGE_URL, [])

    expect(store.list().map((c) => c.id)).toEqual(['other'])
  })
})
