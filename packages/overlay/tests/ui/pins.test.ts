import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Comment } from '../../src/core/types'
import { PinRenderer, type PinPosition } from '../../src/ui/pins'

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    anchor: {
      selector: '#target',
      offsetX: 0.5,
      offsetY: 0.5,
      viewportX: 0.5,
      viewportY: 0.5,
    },
    author: 'Alice',
    text: 'looks off',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resolved: false,
    unread: false,
    replies: [],
    ...overrides,
  }
}

describe('PinRenderer', () => {
  let container: HTMLDivElement
  let renderer: PinRenderer

  afterEach(() => {
    renderer.destroy()
    container.remove()
  })

  it('渡された位置にピンを描画する(自分では位置解決しない)', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    renderer = new PinRenderer(container, { zIndex: 1000, onPinClick: vi.fn(), onPinMove: vi.fn() })

    const comment = makeComment()
    const positions = new Map<string, PinPosition>([[comment.id, { x: 100, y: 200, resolution: 'selector' }]])
    renderer.renderAll([comment], positions)

    const pin = container.querySelector('div')
    expect(pin?.style.left).toBe('100px')
    expect(pin?.style.top).toBe('200px')
  })

  it('resolution が viewport のとき見た目が変わる(黙って通常表示にしない)', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    renderer = new PinRenderer(container, { zIndex: 1000, onPinClick: vi.fn(), onPinMove: vi.fn() })

    const comment = makeComment()
    const selectorPositions = new Map<string, PinPosition>([[comment.id, { x: 10, y: 10, resolution: 'selector' }]])
    renderer.renderAll([comment], selectorPositions)
    const normalPin = container.querySelector('div') as HTMLDivElement
    expect(normalPin.style.outline).toBe('')

    const viewportPositions = new Map<string, PinPosition>([[comment.id, { x: 10, y: 10, resolution: 'viewport' }]])
    renderer.renderAll([comment], viewportPositions)
    const lostPin = container.querySelector('div') as HTMLDivElement
    expect(lostPin.style.outline).toContain('dashed')
    expect(lostPin.querySelector('[data-handoff-anchor-lost-badge]')).not.toBeNull()
  })

  it('positions に載らない可視コメントがあっても、後続ピンの番号はサイドバーと同じ基準(全体での通し番号)でずれない', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    renderer = new PinRenderer(container, { zIndex: 1000, onPinClick: vi.fn(), onPinMove: vi.fn() })

    // 3件の可視コメント。2件目は selector が0件ヒット(anchorVisible=true として
    // visibleComments() には入る)だが、textQuote が visibility:hidden な要素に
    // マッチしていて位置解決だけ失敗し、positions に載らない、という状況を再現する。
    const c1 = makeComment({ id: 'c1' })
    const c2 = makeComment({ id: 'c2' })
    const c3 = makeComment({ id: 'c3' })
    const visibleComments = [c1, c2, c3]

    const positions = new Map<string, PinPosition>([
      [c1.id, { x: 10, y: 10, resolution: 'selector' }],
      // c2 は位置解決に失敗しているため positions に無い。
      [c3.id, { x: 30, y: 30, resolution: 'selector' }],
    ])

    // renderAll には(positions で事前 filter せず)可視コメント全体をそのまま渡す。
    // filter 済みの配列を渡すと、renderAll 内の `index + 1` が
    // 「positions に載っているコメントの中で何番目か」になってしまい、
    // サイドバー側の「可視コメント全体の中で何番目か」(indexOf ベース)とズレる。
    renderer.renderAll(visibleComments, positions)

    const c3Pin = container.querySelector(`[data-comment-id="${c3.id}"]`) as HTMLDivElement
    // サイドバーでは c3 は visibleComments.indexOf(c3) + 1 = 3 番目として表示される。
    // ピン側もこの「3」と一致していなければならない(修正前は positions に載る
    // コメントだけを数えて「2」になり、番号がずれていた)。
    expect(c3Pin.textContent).toBe('3')
  })

  it('destroy でピンをすべて取り除く', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    renderer = new PinRenderer(container, { zIndex: 1000, onPinClick: vi.fn(), onPinMove: vi.fn() })

    const comment = makeComment()
    renderer.renderAll([comment], new Map([[comment.id, { x: 0, y: 0, resolution: 'selector' as const }]]))
    expect(container.children.length).toBe(1)

    renderer.destroy()
    expect(container.children.length).toBe(0)
  })
})
