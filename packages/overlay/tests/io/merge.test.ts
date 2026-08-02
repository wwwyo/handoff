import { describe, expect, it } from 'vitest'
import { mergeComments } from '../../src/io/merge'
import type { Comment, Reply } from '../../src/core/types'

function makeComment(id: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    anchor: { selector: `#${id}`, offsetX: 0, offsetY: 0, viewportX: 0, viewportY: 0 },
    author: 'tester',
    text: `text-${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    resolved: false,
    unread: false,
    replies: [],
    ...overrides,
  }
}

function makeReply(id: string, overrides: Partial<Reply> = {}): Reply {
  return {
    id,
    author: 'tester',
    text: `reply-${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('mergeComments', () => {
  it('ローカルに無い incoming は新規追加され未読になる', () => {
    const result = mergeComments([], [makeComment('a', { unread: false })])
    expect(result.added).toBe(1)
    expect(result.merged).toBe(0)
    expect(result.comments[0]?.unread).toBe(true)
  })

  it('LWW: updatedAt が新しい方の本文が勝つ', () => {
    const local = makeComment('a', { text: 'local text', updatedAt: '2026-01-01T00:00:00.000Z', unread: false })
    const incoming = makeComment('a', { text: 'incoming text', updatedAt: '2026-01-02T00:00:00.000Z' })

    const result = mergeComments([local], [incoming])
    const merged = result.comments.find((c) => c.id === 'a')
    expect(merged?.text).toBe('incoming text')
  })

  it('incoming の updatedAt が古ければローカルの本文を保つ', () => {
    const local = makeComment('a', { text: 'local text', updatedAt: '2026-01-02T00:00:00.000Z', unread: false })
    const incoming = makeComment('a', { text: 'incoming text', updatedAt: '2026-01-01T00:00:00.000Z' })

    const result = mergeComments([local], [incoming])
    const merged = result.comments.find((c) => c.id === 'a')
    expect(merged?.text).toBe('local text')
  })

  it('返信は id で union し createdAt 順に並ぶ', () => {
    const local = makeComment('a', {
      unread: false,
      replies: [makeReply('r1', { createdAt: '2026-01-01T00:00:00.000Z' })],
    })
    const incoming = makeComment('a', {
      replies: [
        makeReply('r1', { createdAt: '2026-01-01T00:00:00.000Z' }),
        makeReply('r2', { createdAt: '2026-01-02T00:00:00.000Z' }),
      ],
    })

    const result = mergeComments([local], [incoming])
    const merged = result.comments.find((c) => c.id === 'a')
    expect(merged?.replies.map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('本文が更新されたら既読を未読に戻す', () => {
    const local = makeComment('a', { text: 'old', updatedAt: '2026-01-01T00:00:00.000Z', unread: false })
    const incoming = makeComment('a', { text: 'new', updatedAt: '2026-01-02T00:00:00.000Z' })

    const result = mergeComments([local], [incoming])
    expect(result.comments.find((c) => c.id === 'a')?.unread).toBe(true)
  })

  it('新しい返信が来たら既読を未読に戻す', () => {
    const local = makeComment('a', { unread: false, replies: [makeReply('r1')] })
    const incoming = makeComment('a', {
      updatedAt: '2026-01-01T00:00:00.000Z', // 本文は変わらない
      replies: [makeReply('r1'), makeReply('r2', { createdAt: '2026-01-02T00:00:00.000Z' })],
    })

    const result = mergeComments([local], [incoming])
    expect(result.comments.find((c) => c.id === 'a')?.unread).toBe(true)
  })

  it('本文も返信も変わらなければローカルの既読状態を保つ', () => {
    const local = makeComment('a', { unread: false, replies: [makeReply('r1')] })
    const incoming = makeComment('a', {
      updatedAt: '2026-01-01T00:00:00.000Z',
      replies: [makeReply('r1')],
    })

    const result = mergeComments([local], [incoming])
    expect(result.comments.find((c) => c.id === 'a')?.unread).toBe(false)
  })
})
