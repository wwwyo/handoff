import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from '../../src/core/events'
import { Store } from '../../src/core/store'
import type { Comment, StorageAdapter, StoreChange } from '../../src/core/types'

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

/** save 呼び出しを記録するだけの adapter。load の解決タイミングはテスト側が resolveLoad で制御する。 */
function makeAdapter() {
  const saveCalls: { changes: StoreChange[]; all: Comment[] }[] = []
  let resolveLoad: ((comments: Comment[]) => void) | null = null
  const adapter: StorageAdapter = {
    load: () =>
      new Promise((resolve) => {
        resolveLoad = resolve
      }),
    save: (changes, all) => {
      saveCalls.push({ changes, all })
    },
  }
  return {
    adapter,
    saveCalls,
    resolveLoad: (comments: Comment[]) => resolveLoad?.(comments),
  }
}

describe('Store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounce 時間内の複数変更を 1 回の save にまとめる', async () => {
    const { adapter, saveCalls, resolveLoad } = makeAdapter()
    const store = new Store(new EventEmitter(), { adapter, persistDebounceMs: 300 })

    const loadDone = store.load()
    resolveLoad([])
    await loadDone

    store.addComment(makeComment('a'))
    store.addComment(makeComment('b'))
    store.editComment('a', 'edited')

    expect(saveCalls.length).toBe(0)

    await vi.advanceTimersByTimeAsync(300)

    expect(saveCalls.length).toBe(1)
    expect(saveCalls[0]?.changes.length).toBe(2) // a (upsert, 最新の edited 内容) と b (upsert)
    expect(saveCalls[0]?.all.map((c) => c.id).sort()).toEqual(['a', 'b'])
  })

  it('load 中の save は保留され、load 完了後に flush される', async () => {
    const { adapter, saveCalls, resolveLoad } = makeAdapter()
    const store = new Store(new EventEmitter(), { adapter, persistDebounceMs: 300 })

    const loadDone = store.load()
    // load が飛んでいる間にローカルで追加する
    store.addComment(makeComment('local'))
    expect(saveCalls.length).toBe(0)

    resolveLoad([makeComment('remote')])
    await loadDone

    // load 完了で即 flush されるはず（debounce タイマーを待たない）。
    // all にはロード済みの remote も含む（save は常に全件スナップショットを送るため）が、
    // changes（差分）に含まれるのは load 飛行中にローカルで加えた分だけ
    expect(saveCalls.length).toBe(1)
    expect(saveCalls[0]?.all.map((c) => c.id).sort()).toEqual(['local', 'remote'])
    expect(saveCalls[0]?.changes.map((c) => (c.op === 'upsert' ? c.comment.id : c.id))).toEqual(['local'])
  })

  it('destroy() で pending な debounce を必ず flush する', async () => {
    const { adapter, saveCalls, resolveLoad } = makeAdapter()
    const store = new Store(new EventEmitter(), { adapter, persistDebounceMs: 300 })

    const loadDone = store.load()
    resolveLoad([])
    await loadDone

    store.addComment(makeComment('a'))
    expect(saveCalls.length).toBe(0)

    store.destroy()
    expect(saveCalls.length).toBe(1)
  })

  it('storage:error イベントを握り潰さず emit する', async () => {
    const events = new EventEmitter()
    const errors: unknown[] = []
    events.on('storage:error', (payload) => errors.push(payload))

    const adapter: StorageAdapter = {
      load: () => Promise.reject(new Error('load failed')),
      save: () => Promise.reject(new Error('save failed')),
    }
    const store = new Store(events, { adapter, persistDebounceMs: 0 })

    await store.load()
    expect(errors).toEqual([{ phase: 'load', error: new Error('load failed') }])

    store.addComment(makeComment('a'))
    // debounceMs: 0 は同期的に flush() を呼ぶが、save() の reject は microtask なので待つ
    await vi.advanceTimersByTimeAsync(0)

    expect(errors.length).toBe(2)
    expect((errors[1] as { phase: string }).phase).toBe('save')
  })
})
