import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Comment } from '../../src/core/types'
import { Popover, type PopoverCallbacks } from '../../src/ui/popover'

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    anchor: { selector: '#a', offsetX: 0, offsetY: 0, viewportX: 0, viewportY: 0 },
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

function makeCallbacks(): PopoverCallbacks {
  return {
    onReply: vi.fn(),
    onResolve: vi.fn(),
    onReopen: vi.fn(),
    onDelete: vi.fn(),
    onMarkUnread: vi.fn(),
    onEditComment: vi.fn(),
    onEditReply: vi.fn(),
    onDeleteReply: vi.fn(),
  }
}

describe('Popover', () => {
  let parent: HTMLDivElement
  let popover: Popover

  afterEach(() => {
    popover.destroy()
    parent.remove()
  })

  it('show() 中は Tab で外へ抜けない(focus trap がかかる)', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    popover = new Popover(parent, makeCallbacks())
    popover.show(makeComment(), { x: 100, y: 100 })

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    expect(document.activeElement).toBe(outside)

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    outside.dispatchEvent(event)

    expect(parent.querySelector('.handoff-popover')?.contains(document.activeElement)).toBe(true)
    outside.remove()
  })

  it('hide() で focus trap が解除される(以後 Tab は素通りする)', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    popover = new Popover(parent, makeCallbacks())
    popover.show(makeComment(), { x: 100, y: 100 })
    popover.hide()

    const a = document.createElement('button')
    const b = document.createElement('button')
    document.body.append(a, b)
    a.focus()

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    a.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    a.remove()
    b.remove()
  })

  it('返信欄で Escape すると popover が閉じる', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    popover = new Popover(parent, makeCallbacks())
    popover.show(makeComment(), { x: 100, y: 100 })
    expect(popover.isVisible()).toBe(true)

    const textarea = parent.querySelector('.handoff-popover-reply-area textarea') as HTMLTextAreaElement
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(popover.isVisible()).toBe(false)
  })
})
