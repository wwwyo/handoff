import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from '../../src/core/events'

describe('EventEmitter', () => {
  it('on で登録したリスナに emit した payload が届く', () => {
    const events = new EventEmitter()
    const listener = vi.fn()
    events.on('mode:change', listener)
    events.emit('mode:change', { mode: 'comment' })
    expect(listener).toHaveBeenCalledWith({ mode: 'comment' })
  })

  it('off / on の返り値の解除関数でリスナを外せる', () => {
    const events = new EventEmitter()
    const listener = vi.fn()
    const unsubscribe = events.on('mode:change', listener)
    unsubscribe()
    events.emit('mode:change', { mode: 'view' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('リスナ内の例外は他のリスナへ伝播しない', () => {
    const events = new EventEmitter()
    const ok = vi.fn()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    events.on('mode:change', () => {
      throw new Error('boom')
    })
    events.on('mode:change', ok)

    expect(() => events.emit('mode:change', { mode: 'review' })).not.toThrow()
    expect(ok).toHaveBeenCalled()

    errorSpy.mockRestore()
  })
})
