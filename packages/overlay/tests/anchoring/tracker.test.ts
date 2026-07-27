import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from '../../src/core/events'
import { AnchorTracker } from '../../src/anchoring/tracker'
import type { Comment } from '../../src/core/types'

function makeComment(id: string): Comment {
  return {
    id,
    anchor: { selector: `#${id}`, offsetX: 0, offsetY: 0, viewportX: 0.5, viewportY: 0.5 },
    author: 'tester',
    text: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    resolved: false,
    unread: false,
    replies: [],
  }
}

describe('AnchorTracker', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="a">x</div>'
  })

  it('update() は各コメントの位置を1回の onUpdate にまとめて渡す', () => {
    const comments = [makeComment('a')]
    const onUpdate = vi.fn()
    const tracker = new AnchorTracker({ getComments: () => comments }, new EventEmitter(), onUpdate)

    tracker.update()

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const positions = onUpdate.mock.calls[0]?.[0]
    expect(positions).toHaveLength(1)
    expect(positions[0].id).toBe('a')
  })

  it('要素が消えて viewport にフォールバックしたら anchor:degraded を emit する', () => {
    const comments = [makeComment('a')]
    const events = new EventEmitter()
    const degraded = vi.fn()
    events.on('anchor:degraded', degraded)
    const tracker = new AnchorTracker({ getComments: () => comments }, events, () => {})

    tracker.update() // 1回目: selector で解決、まだ previous が無いので emit されない
    expect(degraded).not.toHaveBeenCalled()

    document.body.innerHTML = '' // 要素を消す
    tracker.update() // 2回目: selector 解決に失敗 → viewport に degrade

    expect(degraded).toHaveBeenCalledTimes(1)
  })

  it('要素が復帰したら anchor:recovered を emit する', () => {
    const comments = [makeComment('a')]
    const events = new EventEmitter()
    const recovered = vi.fn()
    events.on('anchor:recovered', recovered)
    const tracker = new AnchorTracker({ getComments: () => comments }, events, () => {})

    document.body.innerHTML = ''
    tracker.update() // 1回目: viewport（previous 未定義なので emit されない）
    document.body.innerHTML = '<div id="a">x</div>'
    tracker.update() // 2回目: selector に復帰

    expect(recovered).toHaveBeenCalledTimes(1)
  })

  it('selector から text-quote への後退も degrade として報告する', () => {
    document.body.innerHTML = '<div id="a">unique text here</div>'
    const comments = [makeComment('a')]
    comments[0]!.anchor.textQuote = { exact: 'unique text here' }
    const events = new EventEmitter()
    const degraded = vi.fn()
    events.on('anchor:degraded', degraded)
    const tracker = new AnchorTracker({ getComments: () => comments }, events, () => {})

    tracker.update() // selector で解決

    // id を持たない別ノードに差し替える。selector は引けないがテキストは残る
    document.body.innerHTML = '<div>unique text here</div>'
    tracker.update()

    expect(degraded).toHaveBeenCalledTimes(1)
    expect(degraded.mock.calls[0]?.[0].resolution).toBe('text-quote')
  })
})
