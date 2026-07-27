import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAnchor, resolveAnchor } from '../../src/anchoring/position'

/**
 * jsdom は layout を計算しないため、テスト対象の要素の getBoundingClientRect /
 * getClientRects を差し替える（後者は isElementVisible の可視判定に使われるが、
 * jsdom は常に空配列を返すため放置すると常に非表示扱いになってしまう）。
 */
function mockRect(el: Element, rect: Partial<DOMRect>) {
  const domRect = {
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    top: rect.top ?? 0,
    left: rect.left ?? 0,
    right: (rect.left ?? 0) + (rect.width ?? 0),
    bottom: (rect.top ?? 0) + (rect.height ?? 0),
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    toJSON() {
      return this
    },
  } as DOMRect

  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(domRect)
  vi.spyOn(el, 'getClientRects').mockReturnValue({
    length: domRect.width > 0 && domRect.height > 0 ? 1 : 0,
    item: () => domRect,
    [Symbol.iterator]: function* () {
      if (domRect.width > 0 && domRect.height > 0) yield domRect
    },
  } as unknown as DOMRectList)
}

describe('createAnchor / resolveAnchor', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('selector で解決できるときは selector 層を返す', () => {
    document.body.innerHTML = '<div id="target">見出しテキスト</div>'
    const el = document.getElementById('target')!
    mockRect(el, { left: 10, top: 20, width: 100, height: 50 })

    const anchor = createAnchor(el, 60, 45)
    expect(anchor.selector).toBe('#target')

    const resolved = resolveAnchor(anchor)
    expect(resolved.resolution).toBe('selector')
    expect(resolved.x).toBeCloseTo(10 + 100 * anchor.offsetX)
    expect(resolved.y).toBeCloseTo(20 + 50 * anchor.offsetY)
  })

  it('selector が壊れても textQuote で解決できる', () => {
    document.body.innerHTML = '<div id="target">壊れる前のセレクタ用テキスト</div>'
    const el = document.getElementById('target')!
    mockRect(el, { left: 0, top: 0, width: 100, height: 40 })
    const anchor = createAnchor(el, 10, 10)

    // id を変えて selector を壊すが、textContent とその他の要素構造は保つ
    document.body.innerHTML = '<div id="renamed">壊れる前のセレクタ用テキスト</div>'
    const renamed = document.getElementById('renamed')!
    mockRect(renamed, { left: 5, top: 5, width: 80, height: 30 })

    const resolved = resolveAnchor(anchor)
    expect(resolved.resolution).toBe('text-quote')
    expect(resolved.visible).toBe(true)
  })

  it('selector も textQuote も解決できなければ viewport 相対座標へフォールバックする', () => {
    document.body.innerHTML = '<div id="target">テキスト</div>'
    const el = document.getElementById('target')!
    mockRect(el, { left: 0, top: 0, width: 100, height: 40 })
    const anchor = createAnchor(el, 10, 10)

    // 要素ごと消す + テキストも変えて textQuote 解決を封じる
    document.body.innerHTML = '<div>まったく別の内容</div>'

    const resolved = resolveAnchor(anchor)
    expect(resolved.resolution).toBe('viewport')
    expect(resolved.visible).toBe(true)
    expect(resolved.x).toBeCloseTo(window.innerWidth * anchor.viewportX + window.scrollX)
    expect(resolved.y).toBeCloseTo(window.innerHeight * anchor.viewportY + window.scrollY)
  })

  it('座標は page 座標系（scrollX/Y 込み）で返す', () => {
    document.body.innerHTML = '<div id="target">テキスト</div>'
    const el = document.getElementById('target')!
    mockRect(el, { left: 10, top: 10, width: 50, height: 50 })
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(100)
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(200)

    const anchor = createAnchor(el, 35, 35)
    const resolved = resolveAnchor(anchor)
    expect(resolved.x).toBeCloseTo(10 + 100 + 50 * anchor.offsetX)
    expect(resolved.y).toBeCloseTo(10 + 200 + 50 * anchor.offsetY)
  })
})
