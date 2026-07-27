import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Comment } from '../../src/core/types'
import { BottomSheet } from '../../src/ui/bottom-sheet'
import type { PopoverCallbacks } from '../../src/ui/popover'

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

describe('BottomSheet', () => {
  let parent: HTMLDivElement
  let sheet: BottomSheet

  afterEach(() => {
    sheet.destroy()
    parent.remove()
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
  })

  it('スワイプのハンドルだけでなく明示的な close ボタンも表示する', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    sheet = new BottomSheet(parent, makeCallbacks())
    sheet.show(makeComment())

    const closeBtn = parent.querySelector('.handoff-popover-titlebar-btn[aria-label="Close comment"]')
    expect(closeBtn).not.toBeNull()
  })

  it('close ボタンをクリックすると閉じる', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    sheet = new BottomSheet(parent, makeCallbacks())
    sheet.show(makeComment())
    expect(sheet.isVisible()).toBe(true)

    const closeBtn = parent.querySelector<HTMLButtonElement>('.handoff-popover-titlebar-btn[aria-label="Close comment"]')
    closeBtn?.click()

    expect(sheet.isVisible()).toBe(false)
  })

  it('モバイル幅でシートを開いたまま destroy() すると、ホストページの overflow ロックが解除される', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    sheet = new BottomSheet(parent, makeCallbacks())
    sheet.show(makeComment())

    // show() が body/documentElement の overflow を hidden にする(モバイルのスクロールロック)。
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.documentElement.style.overflow).toBe('hidden')

    // hide() 経由の 220ms タイマーを待たず、destroy() 単体で即座に復元されるべき
    // (修正前は destroy() が復元処理を一切呼ばず、ホストのスクロールがロックされたまま残った)。
    sheet.destroy()

    expect(document.body.style.overflow).toBe('')
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('show() 中は Tab で外へ抜けない(focus trap がかかる)', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    sheet = new BottomSheet(parent, makeCallbacks())
    sheet.show(makeComment())

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    outside.dispatchEvent(event)

    expect(parent.querySelector('.handoff-sheet')?.contains(document.activeElement)).toBe(true)
    outside.remove()
  })

  it('別のコメントに切り替えるための show() は onClose を発火しない(ハイライトが消えない)', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    const callbacks = makeCallbacks()
    sheet = new BottomSheet(parent, callbacks)

    sheet.show(makeComment({ id: 'a' }))
    expect(callbacks.onClose).not.toHaveBeenCalled()

    // ピン A → ピン B と続けてタップした場面(モバイルの BottomSheet 版)。
    sheet.show(makeComment({ id: 'b' }))
    expect(callbacks.onClose).not.toHaveBeenCalled()
    expect(sheet.getCurrentCommentId()).toBe('b')
  })

  it('ユーザーが close ボタンで明示的に閉じたときは onClose が発火する', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    const callbacks = makeCallbacks()
    sheet = new BottomSheet(parent, callbacks)
    sheet.show(makeComment())

    const closeBtn = parent.querySelector<HTMLButtonElement>('.handoff-popover-titlebar-btn[aria-label="Close comment"]')
    closeBtn?.click()

    expect(callbacks.onClose).toHaveBeenCalledTimes(1)
  })
})
