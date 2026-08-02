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

  it('revalidate なしの update() はキャッシュ済み要素をそのまま使い、DOM を再クエリしない', () => {
    const comments = [makeComment('a')]
    const tracker = new AnchorTracker({ getComments: () => comments }, new EventEmitter(), () => {})

    tracker.update() // 1回目: selector で解決してキャッシュする
    const spy = vi.spyOn(document, 'querySelectorAll')

    tracker.update() // 2回目: revalidate=false なのでキャッシュを使い、再クエリしない

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('revalidate=true で SPA が同じノードを使い回して中身だけ差し替えたケースを検出し、解決し直す', () => {
    document.body.innerHTML = '<div id="a">unique original text</div>'
    const comments = [makeComment('a')]
    comments[0]!.anchor.textQuote = { exact: 'unique original text' }
    const tracker = new AnchorTracker({ getComments: () => comments }, new EventEmitter(), () => {})

    tracker.update() // 1回目: selector で解決してキャッシュする

    // 同じノード（#a）を使い回したまま中身だけ差し替える。isConnected は真のまま
    const el = document.getElementById('a')!
    el.textContent = 'completely different content now'

    const querySpy = vi.spyOn(document, 'querySelectorAll')
    tracker.update(true) // revalidate=true: キャッシュ要素が textQuote と合わなくなったので解決し直す

    // 再解決は resolveAnchorWithElement 経由で anchor.selector を document.querySelectorAll に
    // 渡す（position.ts の queryBestElement）。ここが呼ばれていれば、キャッシュを使い回さず
    // 解決し直したことの直接的な証拠になる。
    expect(querySpy).toHaveBeenCalledWith(comments[0]!.anchor.selector)
    querySpy.mockRestore()
  })

  it('viewport フォールバックしたコメントを削除しても lastResolution に残骸を残さない（同じ id の再投入で誤った degrade/recover を emit しない）', () => {
    document.body.innerHTML = '' // 要素が無いので resolveOne は viewport にフォールバックする
    let comments: Comment[] = [makeComment('a')]
    const events = new EventEmitter()
    const degraded = vi.fn()
    const recovered = vi.fn()
    events.on('anchor:degraded', degraded)
    events.on('anchor:recovered', recovered)
    const tracker = new AnchorTracker({ getComments: () => comments }, events, () => {})

    // 1回目: viewport に解決。resolvedElements には入らないが lastResolution には 'viewport' が残る
    tracker.update()
    expect(degraded).not.toHaveBeenCalled()

    // コメントを削除する（resolvedElements には元々居ないので、forgetStaleComments が
    // lastResolution 側も見ないと 'a' の 'viewport' が残骸として残ってしまう）
    comments = []
    tracker.update()

    // 同じ id 'a' のコメントを import 等で復活させ、今度は要素が存在する状態にする
    document.body.innerHTML = '<div id="a">x</div>'
    comments = [makeComment('a')]
    tracker.update()

    // 残骸が無ければ「新規解決」として previous=undefined 扱いになり、degrade/recover は emit されない。
    // 残骸がある実装だと previous='viewport' として比較され、誤って anchor:recovered が飛ぶ。
    expect(degraded).not.toHaveBeenCalled()
    expect(recovered).not.toHaveBeenCalled()
  })

  it('revalidate=true でもキャッシュ要素が selector/textQuote に合致し続ける限りは解決し直さない', () => {
    document.body.innerHTML = '<div id="a">unique original text</div>'
    const comments = [makeComment('a')]
    comments[0]!.anchor.textQuote = { exact: 'unique original text' }
    const tracker = new AnchorTracker({ getComments: () => comments }, new EventEmitter(), () => {})

    tracker.update() // 1回目: selector で解決してキャッシュする

    const querySpy = vi.spyOn(document, 'querySelectorAll')
    tracker.update(true) // 内容は変わっていないので再検証は通り、キャッシュ要素をそのまま使う

    // textQuoteMatches は textContent の文字列比較のみで済ませており、DOM の再クエリを
    // 発生させない。もし解決し直していれば anchor.selector で querySelectorAll が呼ばれるはず。
    expect(querySpy).not.toHaveBeenCalledWith(comments[0]!.anchor.selector)
    querySpy.mockRestore()
  })
})
