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
