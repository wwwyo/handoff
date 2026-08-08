import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAnchor, resolveAnchor } from '../../src/anchoring/position'
import type { Anchor } from '../../src/core/types'

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

  it('selector・textQuote・a11y の3証拠すべてが同じ要素を指すとき confident を返す', () => {
    document.body.innerHTML = '<button id="target">送信する</button>'
    const el = document.getElementById('target')!
    mockRect(el, { left: 10, top: 20, width: 100, height: 50 })

    const anchor = createAnchor(el, 60, 45)
    expect(anchor.selector).toBe('#target')
    expect(anchor.a11y).toEqual({ role: 'button', name: '送信する' })

    const resolved = resolveAnchor(anchor)
    expect(resolved.resolution).toBe('confident')
    expect(resolved.x).toBeCloseTo(10 + 100 * anchor.offsetX)
    expect(resolved.y).toBeCloseTo(20 + 50 * anchor.offsetY)
  })

  it('selector が壊れて証拠が textQuote 単独になったときは uncertain として解決する', () => {
    document.body.innerHTML = '<div id="target">壊れる前のセレクタ用テキスト</div>'
    const el = document.getElementById('target')!
    mockRect(el, { left: 0, top: 0, width: 100, height: 40 })
    const anchor = createAnchor(el, 10, 10)

    // id を変えて selector を壊すが、textContent とその他の要素構造は保つ
    document.body.innerHTML = '<div id="renamed">壊れる前のセレクタ用テキスト</div>'
    const renamed = document.getElementById('renamed')!
    mockRect(renamed, { left: 5, top: 5, width: 80, height: 30 })

    const resolved = resolveAnchor(anchor)
    expect(resolved.resolution).toBe('uncertain')
    expect(resolved.visible).toBe(true)
  })

  it('証拠が1つだけ一致するときは uncertain を返す', () => {
    document.body.innerHTML = '<div id="target">テキスト</div>'
    mockRect(document.getElementById('target')!, { left: 0, top: 0, width: 100, height: 40 })
    // textQuote・a11y を持たない、selector だけのアンカー
    const anchor: Anchor = { selector: '#target', offsetX: 0.5, offsetY: 0.5, viewportX: 0.5, viewportY: 0.5 }

    const resolved = resolveAnchor(anchor)
    expect(resolved.resolution).toBe('uncertain')
  })

  it('selector も textQuote も解決できなければ viewport 相対座標へ落ち resolution は lost になる', () => {
    document.body.innerHTML = '<div id="target">テキスト</div>'
    const el = document.getElementById('target')!
    mockRect(el, { left: 0, top: 0, width: 100, height: 40 })
    // 画面中央付近を指すアンカー。端の clamp に巻き込まれない位置を選ぶ
    const anchor = createAnchor(el, window.innerWidth / 2, window.innerHeight / 2)

    // 要素ごと消す + テキストも変えて textQuote 解決を封じる
    document.body.innerHTML = '<div>まったく別の内容</div>'

    const resolved = resolveAnchor(anchor)
    expect(resolved.resolution).toBe('lost')
    expect(resolved.visible).toBe(true)
    expect(resolved.x).toBeCloseTo(window.innerWidth * anchor.viewportX + window.scrollX)
    expect(resolved.y).toBeCloseTo(window.innerHeight * anchor.viewportY + window.scrollY)
  })

  it('viewport フォールバックの座標は画面内に収める', () => {
    document.body.innerHTML = '<div id="target">テキスト</div>'
    const el = document.getElementById('target')!
    mockRect(el, { left: 0, top: 0, width: 100, height: 40 })
    // 画面の左上隅ちょうどを指すアンカー。clamp が無ければピンが画面外に出る
    const anchor = createAnchor(el, 0, 0)

    document.body.innerHTML = '<div>まったく別の内容</div>'

    const resolved = resolveAnchor(anchor)
    expect(resolved.resolution).toBe('lost')
    expect(resolved.x).toBeGreaterThan(0)
    expect(resolved.y).toBeGreaterThan(0)
    expect(resolved.x).toBeLessThan(window.innerWidth)
    expect(resolved.y).toBeLessThan(window.innerHeight)
  })

  it('selector が複数一致しても textQuote まで一致する候補が1つだけなら confident になる', () => {
    document.body.innerHTML = `
      <p class="item">誤った段落</p>
      <p class="item">正しい段落</p>
    `
    const items = document.querySelectorAll('.item')
    mockRect(items[0] as Element, { left: 0, top: 0, width: 100, height: 20 })
    mockRect(items[1] as Element, { left: 0, top: 50, width: 100, height: 20 })

    // selector 単独では2件に一致するが、textQuote(exact + tagName) は items[1] にしか
    // 一致しないため items[1] だけが2証拠一致(selector+textQuote)で最高得点になる。
    const anchor: Anchor = {
      selector: '.item',
      offsetX: 0.5,
      offsetY: 0.5,
      viewportX: 0.5,
      viewportY: 0.5,
      textQuote: { exact: '正しい段落', tagName: 'p' },
    }

    const resolved = resolveAnchor(anchor)
    expect(resolved.resolution).toBe('confident')
    // 誤った段落（top:0）ではなく正しい段落（top:50）を指しているはず
    expect(resolved.y).toBeCloseTo(50 + 20 * 0.5)
  })

  it('selector も textQuote も同点で複数候補が残るときは lost として降格する', () => {
    document.body.innerHTML = `
      <div><p class="item">同じ文言</p></div>
      <div><p class="item">同じ文言</p></div>
    `
    const items = document.querySelectorAll('.item')
    mockRect(items[0] as Element, { left: 0, top: 0, width: 100, height: 20 })
    mockRect(items[1] as Element, { left: 0, top: 50, width: 100, height: 20 })

    // 2件とも selector + textQuote(exact + tagName) の両方に一致してしまい、得点が同点で
    // 1件に決まらない（prefix/suffix も未指定）
    const anchor: Anchor = {
      selector: '.item',
      offsetX: 0.5,
      offsetY: 0.5,
      viewportX: 0.5,
      viewportY: 0.5,
      textQuote: { exact: '同じ文言', tagName: 'p' },
    }

    const resolved = resolveAnchor(anchor)
    // 「ここだ」と自信ありげに間違った要素（または不確かな要素）を選ぶくらいなら、
    // viewport フォールバックへ降格すべき。
    expect(resolved.resolution).toBe('lost')
  })

  it('1証拠ずつ別要素を支持し同点になるときも lost として降格する', () => {
    document.body.innerHTML = `
      <div id="a">要素A</div>
      <button aria-label="要素B">ボタン</button>
    `
    const a = document.getElementById('a')!
    const b = document.querySelector('button')!
    mockRect(a, { left: 0, top: 0, width: 100, height: 20 })
    mockRect(b, { left: 0, top: 50, width: 100, height: 20 })

    // selector は a だけを、a11y は b だけを支持する。互いに他方の証拠には一致しないため
    // どちらも得点1で並び、1つに決められない。
    const anchor: Anchor = {
      selector: '#a',
      offsetX: 0.5,
      offsetY: 0.5,
      viewportX: 0.5,
      viewportY: 0.5,
      a11y: { role: 'button', name: '要素B' },
    }

    const resolved = resolveAnchor(anchor)
    expect(resolved.resolution).toBe('lost')
  })

  it('ボタンの aria-label が変わっても selector + textQuote が残っていれば confident のまま', () => {
    document.body.innerHTML = '<button id="target" aria-label="送信する">Submit</button>'
    const el = document.getElementById('target')!
    mockRect(el, { left: 0, top: 0, width: 100, height: 40 })
    const anchor = createAnchor(el, 50, 20)
    expect(anchor.a11y).toEqual({ role: 'button', name: '送信する' })

    // aria-label(a11y の name) だけを書き換える。selector(id) と textQuote(textContent
    // 'Submit') は変わらないので、その2証拠だけで confident を維持できるはず。
    el.setAttribute('aria-label', '別のラベルに変わった')

    const resolved = resolveAnchor(anchor)
    expect(resolved.resolution).toBe('confident')
  })

  it('id を消して selector が壊れても a11y + textQuote が残っていれば confident のまま', () => {
    document.body.innerHTML = '<button id="target" aria-label="送信する">Submit</button>'
    const el = document.getElementById('target')!
    mockRect(el, { left: 0, top: 0, width: 100, height: 40 })
    const anchor = createAnchor(el, 50, 20)

    // id を剥がして selector('#target') を壊す。a11y(aria-label) と textQuote
    // (textContent 'Submit') は変わらないので、その2証拠だけで confident を維持できるはず。
    el.removeAttribute('id')

    const resolved = resolveAnchor(anchor)
    expect(resolved.resolution).toBe('confident')
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
