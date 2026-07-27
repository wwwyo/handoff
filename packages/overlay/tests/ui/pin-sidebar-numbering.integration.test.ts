import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createTextQuote } from '../../src/anchoring/text-quote'
import type { Comment, StorageAdapter } from '../../src/core/types'
import { Handoff, type HandoffInstance } from '../../src/index'

/**
 * jsdom は ResizeObserver を実装していない(AnchorTracker.start() が使う)ため、
 * このファイルでだけ最小限のスタブを差し込む。他のテストへ漏らさないよう
 * beforeAll/afterAll で範囲を絞る。
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let originalResizeObserver: typeof ResizeObserver | undefined

beforeAll(() => {
  originalResizeObserver = globalThis.ResizeObserver
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
})

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver as typeof ResizeObserver
})

/**
 * バグ5の再現条件を実 DOM で作る:
 * - selector がどの要素にもマッチしない(0件) → getCommentVisibility は
 *   anchorVisible = true として扱う(visibleComments() に含まれる)
 * - しかし textQuote は visibility:hidden な要素にマッチする →
 *   AnchorTracker の解決自体はできるが isElementVisible が false になり、
 *   pinPositions() では除外される
 *
 * この状態の可視コメントを挟むと、ピン番号(positions に載っている物だけを数える)と
 * サイドバー番号(可視コメント全体の中の通し番号)がズレる、というのが今回のバグ。
 */
function makeHiddenMatchAnchor(hiddenEl: Element) {
  return {
    selector: '#does-not-exist-anywhere',
    offsetX: 0.5,
    offsetY: 0.5,
    viewportX: 0.5,
    viewportY: 0.5,
    textQuote: createTextQuote(hiddenEl),
  }
}

function makeComment(id: string, createdAt: string, anchor: Comment['anchor']): Comment {
  return {
    id,
    anchor,
    author: 'Alice',
    text: `comment ${id}`,
    createdAt,
    updatedAt: createdAt,
    resolved: false,
    unread: false,
    replies: [],
  }
}

describe('ピン番号とサイドバー番号の整合性(バグ5)', () => {
  let handoff: HandoffInstance | undefined
  let visibleA: HTMLDivElement
  let hiddenTarget: HTMLDivElement
  let visibleB: HTMLDivElement

  afterEach(() => {
    handoff?.destroy()
    handoff = undefined
    visibleA?.remove()
    hiddenTarget?.remove()
    visibleB?.remove()
    document.getElementById('handoff-root')?.remove()
    document.getElementById('handoff-pins')?.remove()
    document.getElementById('handoff-overlay')?.remove()
  })

  it('positions に載らない可視コメントを挟んでも、後続のピン番号とサイドバー番号は一致する', async () => {
    // jsdom はレイアウトを持たず getBoundingClientRect() は常に 0 矩形を返すため、
    // isElementVisible() の rect.width/height チェックに引っかかって「見えている」
    // 要素すら invisible 扱いになってしまう。テスト対象の分岐(selector 一致あり/なし)
    // だけを効かせたいので、可視要素側は非ゼロの矩形を返すよう明示的にスタブする。
    const stubVisibleRect = (el: HTMLElement): void => {
      el.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0, toJSON() {} }) as DOMRect
      el.getClientRects = () => [el.getBoundingClientRect()] as unknown as DOMRectList
    }

    visibleA = document.createElement('div')
    visibleA.id = 'pin-a'
    visibleA.textContent = 'anchor A'
    document.body.appendChild(visibleA)
    stubVisibleRect(visibleA)

    hiddenTarget = document.createElement('div')
    hiddenTarget.id = 'pin-hidden'
    hiddenTarget.style.visibility = 'hidden'
    hiddenTarget.textContent = 'HIDDEN_TARGET_TEXT_UNIQUE_STRING'
    document.body.appendChild(hiddenTarget)
    // visibility:hidden で isElementVisible() が先に false を返すので矩形のスタブは不要。

    visibleB = document.createElement('div')
    visibleB.id = 'pin-b'
    visibleB.textContent = 'anchor B'
    document.body.appendChild(visibleB)
    stubVisibleRect(visibleB)

    const commentA = makeComment('a', '2024-01-01T00:00:00.000Z', {
      selector: '#pin-a',
      offsetX: 0.5,
      offsetY: 0.5,
      viewportX: 0.5,
      viewportY: 0.5,
    })
    // 位置解決はできる(text-quote 経由)が isElementVisible が false になり、
    // pinPositions() から除外されるコメント。
    const commentGap = makeComment('gap', '2024-01-02T00:00:00.000Z', makeHiddenMatchAnchor(hiddenTarget))
    const commentB = makeComment('b', '2024-01-03T00:00:00.000Z', {
      selector: '#pin-b',
      offsetX: 0.5,
      offsetY: 0.5,
      viewportX: 0.5,
      viewportY: 0.5,
    })

    const seeded: Comment[] = [commentA, commentGap, commentB]
    const adapter: StorageAdapter = {
      load: () => Promise.resolve(seeded),
      save: () => {},
    }

    handoff = Handoff.init({ adapter, storageKey: 'bug5-test' })
    // store.load() は非同期。読み込み完了後の refresh() まで待つ。
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    handoff.setMode('review')

    const shadowRoot = document.getElementById('handoff-root')?.shadowRoot
    const sidebarRows = shadowRoot?.querySelectorAll('.handoff-sidebar-row')
    expect(sidebarRows?.length).toBe(3)

    const sidebarBForRow = Array.from(sidebarRows ?? []).find(
      (row) => (row as HTMLElement).dataset.commentId === 'b',
    ) as HTMLElement
    const sidebarBNumber = sidebarBForRow.querySelector('.handoff-sidebar-num')?.textContent
    // サイドバーは可視コメント全体(A, gap, B)の中で B が3番目として振られる。
    expect(sidebarBNumber).toBe('3')

    const pinContainer = document.getElementById('handoff-pins')
    // gap は位置は解決できても isElementVisible=false のため、ピンとしては描かれない。
    expect(pinContainer?.querySelectorAll('[data-comment-id]').length).toBe(2)

    const pinB = pinContainer?.querySelector('[data-comment-id="b"]') as HTMLElement
    // 修正前は「positions に載っているコメントの中で何番目か」で採番していたため
    // B は2番目(pinPositions() に gap が無いので A の次)= "2" になり、
    // サイドバーの "3" とズレていた。ここでは一致することを確認する。
    expect(pinB.textContent).toBe('3')
    expect(sidebarBNumber).toBe(pinB.textContent)
  })
})
