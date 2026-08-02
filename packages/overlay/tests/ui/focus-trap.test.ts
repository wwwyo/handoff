import { afterEach, describe, expect, it } from 'vitest'
import { trapFocus } from '../../src/ui/focus-trap'

describe('trapFocus', () => {
  let container: HTMLDivElement
  let release: (() => void) | undefined

  afterEach(() => {
    release?.()
    release = undefined
    container.remove()
  })

  function setup(): { first: HTMLButtonElement; second: HTMLButtonElement; last: HTMLButtonElement } {
    container = document.createElement('div')
    const first = document.createElement('button')
    first.textContent = 'first'
    const second = document.createElement('button')
    second.textContent = 'second'
    const last = document.createElement('button')
    last.textContent = 'last'
    container.append(first, second, last)
    document.body.appendChild(container)
    const handle = trapFocus(container)
    release = handle.release
    return { first, second, last }
  }

  it('末尾で Tab すると先頭へループする', () => {
    const { first, last } = setup()
    last.focus()
    expect(document.activeElement).toBe(last)

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.activeElement?.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)
  })

  it('先頭で Shift+Tab すると末尾へループする', () => {
    const { first, last } = setup()
    first.focus()
    expect(document.activeElement).toBe(first)

    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    document.activeElement?.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)
  })

  it('中間要素での Tab はラップしない(デフォルト動作のまま)', () => {
    const { second } = setup()
    second.focus()

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.activeElement?.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('release() 後は Tab を横取りしない', () => {
    const { first, last } = setup()
    release?.()
    release = undefined
    last.focus()

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.activeElement?.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).not.toBe(first)
  })

  it('container の外にフォーカスがある状態で Tab すると container 内へ引き戻す', () => {
    const { first } = setup()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    expect(document.activeElement).toBe(outside)

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.activeElement?.dispatchEvent(event)

    expect(document.activeElement).toBe(first)
    outside.remove()
  })
})

describe('trapFocus のスタック(複数の trap が同時に生きている場合)', () => {
  let outer: HTMLDivElement
  let inner: HTMLDivElement
  let releaseOuter: (() => void) | undefined
  let releaseInner: (() => void) | undefined

  function makeModal(label: string): { el: HTMLDivElement; first: HTMLButtonElement; second: HTMLButtonElement } {
    const el = document.createElement('div')
    const first = document.createElement('button')
    first.textContent = `${label}-first`
    const second = document.createElement('button')
    second.textContent = `${label}-second`
    el.append(first, second)
    document.body.appendChild(el)
    return { el, first, second }
  }

  afterEach(() => {
    releaseInner?.()
    releaseOuter?.()
    releaseInner = undefined
    releaseOuter = undefined
    outer?.remove()
    inner?.remove()
  })

  it('review モードの sidebar + popover の2枚が同時に生きていると、popover の先頭から Tab しても2番目へ進めず先頭に固定される(修正前の再現)', () => {
    // 再現手順: 1枚目(sidebar 相当) を先に開き、2枚目(popover 相当)を後から開く。
    const outerModal = makeModal('sidebar')
    outer = outerModal.el
    releaseOuter = trapFocus(outer).release

    const innerModal = makeModal('popover')
    inner = innerModal.el
    releaseInner = trapFocus(inner).release

    // popover 内の先頭ボタンにフォーカスがある状態(show() 直後相当)で Tab を押す。
    // 先頭 → 2番目へ普通に進むはずの操作。
    innerModal.first.focus()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    innerModal.first.dispatchEvent(event)

    // 最前面(popover)の trap だけが働くべきなので、先頭ボタンからの通常 Tab は
    // ラップ処理の対象外(preventDefault しない = ブラウザの既定移動に任せる)。
    // 修正前は sidebar の trap が「active が sidebar の外にある」と誤判定して
    // 割り込み、popover 側も追随して自分の先頭へ focus() し直すため、
    // 何度 Tab を押しても先頭ボタンに固定されて2番目以降へ進めなかった。
    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(innerModal.first)
  })

  it('最前面の trap を release すると、1つ前の trap が有効に戻る', () => {
    const outerModal = makeModal('sidebar')
    outer = outerModal.el
    releaseOuter = trapFocus(outer).release

    const innerModal = makeModal('popover')
    inner = innerModal.el
    const innerHandle = trapFocus(inner)
    releaseInner = innerHandle.release

    // popover(inner)を閉じる — sidebar(outer)だけが残る。
    innerHandle.release()
    releaseInner = undefined

    outerModal.second.focus()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    outerModal.second.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(outer.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(outerModal.first)
  })
})
