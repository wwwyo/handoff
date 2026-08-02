import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeyboardHandler, type KeyboardCallbacks } from '../../src/ui/keyboard'

describe('KeyboardHandler', () => {
  let handler: KeyboardHandler
  let callbacks: KeyboardCallbacks

  beforeEach(() => {
    callbacks = {
      onSetMode: vi.fn(),
      onEscape: vi.fn(),
      onNextPin: vi.fn(),
      onPrevPin: vi.fn(),
    }
    handler = new KeyboardHandler(callbacks)
    handler.attach()
  })

  afterEach(() => {
    handler.detach()
    document.body.innerHTML = ''
  })

  it('通常時は c でコメントモードに切り替わる', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }))
    expect(callbacks.onSetMode).toHaveBeenCalledWith('comment')
  })

  it('input にフォーカスがあるときはショートカットが発火しない', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true, composed: true }))
    expect(callbacks.onSetMode).not.toHaveBeenCalled()
  })

  it('textarea にフォーカスがあるときはショートカットが発火しない', () => {
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true, composed: true }))
    expect(callbacks.onSetMode).not.toHaveBeenCalled()
  })

  it('detach 後はイベントを拾わない', () => {
    handler.detach()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))
    expect(callbacks.onSetMode).not.toHaveBeenCalled()
  })

  it('setEnabled(false) で全ショートカットが無効になる', () => {
    handler.setEnabled(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }))
    expect(callbacks.onSetMode).not.toHaveBeenCalled()
  })
})
