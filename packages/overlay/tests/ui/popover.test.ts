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
    onClose: vi.fn(),
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

  it('別のコメントに切り替えるための show() は onClose を発火しない(ハイライトが消えない)', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    const callbacks = makeCallbacks()
    popover = new Popover(parent, callbacks)

    popover.show(makeComment({ id: 'a' }), { x: 100, y: 100 })
    expect(callbacks.onClose).not.toHaveBeenCalled()

    // A が開いた状態で B をクリックした場面を再現。show() が内部で行う「前の popover を
    // 消す」ための hide は、ユーザーが明示的に閉じた操作ではないので onClose を呼んではいけない。
    // 呼んでしまうと呼び出し側(HandoffLayer.closeComment)が active を null に戻し、
    // 直後に設定し直した active を打ち消してピン/サイドバーのハイライトが消える。
    popover.show(makeComment({ id: 'b' }), { x: 200, y: 200 })
    expect(callbacks.onClose).not.toHaveBeenCalled()
    expect(popover.getCurrentCommentId()).toBe('b')
  })

  it('返信のたびに再描画で show() が呼ばれても(refreshOpenComment 相当)、ハイライトは消えない', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    const callbacks = makeCallbacks()
    popover = new Popover(parent, callbacks)

    popover.show(makeComment({ id: 'a' }), { x: 100, y: 100 })
    // 同じコメントを開き直す(返信後の再描画は同一 id で show() し直す)。
    popover.show(makeComment({ id: 'a', replies: [] }), { x: 100, y: 100 })

    expect(callbacks.onClose).not.toHaveBeenCalled()
    expect(popover.isVisible()).toBe(true)
  })

  it('ユーザーが close ボタンで明示的に閉じたときは onClose が発火する', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    const callbacks = makeCallbacks()
    popover = new Popover(parent, callbacks)
    popover.show(makeComment(), { x: 100, y: 100 })

    const closeBtn = parent.querySelector<HTMLButtonElement>('.handoff-popover-titlebar-btn[aria-label="Close comment"]')
    closeBtn?.click()

    expect(callbacks.onClose).toHaveBeenCalledTimes(1)
    expect(popover.isVisible()).toBe(false)
  })
})
