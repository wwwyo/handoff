import { beforeEach, describe, expect, it } from 'vitest'
import { wrapWithReadJournal } from '../../src/core/read-journal'
import type { Comment, StorageAdapter } from '../../src/core/types'

function makeComment(id: string, unread: boolean): Comment {
  return {
    id,
    anchor: { selector: `#${id}`, offsetX: 0, offsetY: 0, viewportX: 0, viewportY: 0 },
    author: 'tester',
    text: `text-${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    resolved: false,
    unread,
    replies: [],
  }
}

describe('wrapWithReadJournal', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('save したコメントの unread を journal に記録し、load で反映する', async () => {
    let remote: Comment[] = []
    const baseAdapter: StorageAdapter = {
      load: () => remote,
      save: (_changes, all) => {
        remote = all
      },
    }
    const wrapped = wrapWithReadJournal(baseAdapter, 'test-key')

    await wrapped.save([{ op: 'upsert', comment: makeComment('a', false) }], [makeComment('a', false)])

    const loaded = await wrapped.load()
    expect(loaded[0]?.unread).toBe(false)
  })

  it('journal に無いコメントは load 時に unread として扱う', async () => {
    const baseAdapter: StorageAdapter = {
      load: () => [makeComment('new', false)],
      save: () => {},
    }
    const wrapped = wrapWithReadJournal(baseAdapter, 'test-key-2')
    const loaded = await wrapped.load()
    expect(loaded[0]?.unread).toBe(true)
  })

  it('リモートへは unread を送らない', async () => {
    let savedAll: Comment[] = []
    const baseAdapter: StorageAdapter = {
      load: () => [],
      save: (_changes, all) => {
        savedAll = all
      },
    }
    const wrapped = wrapWithReadJournal(baseAdapter, 'test-key-3')
    await wrapped.save([], [makeComment('a', true)])
    expect(savedAll[0]?.unread).toBe(false)
  })

  it('存在しなくなったコメントの id を journal から刈る', async () => {
    const baseAdapter: StorageAdapter = {
      load: () => [],
      save: () => {},
    }
    const wrapped = wrapWithReadJournal(baseAdapter, 'test-key-4')

    await wrapped.save([], [makeComment('a', false), makeComment('b', false)])
    let raw = localStorage.getItem('test-key-4-read-ids')
    expect(JSON.parse(raw!)).toEqual(expect.arrayContaining(['a', 'b']))

    // b が削除された後の save
    await wrapped.save([{ op: 'delete', id: 'b' }], [makeComment('a', false)])
    raw = localStorage.getItem('test-key-4-read-ids')
    expect(JSON.parse(raw!)).toEqual(['a'])
  })
})
