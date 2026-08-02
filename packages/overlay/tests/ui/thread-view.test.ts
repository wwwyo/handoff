import { describe, expect, it, vi } from 'vitest'
import { ThreadView } from '../../src/ui/thread-view'

describe('ThreadView', () => {
  it('createRow は author を最初の1文字ぶんの avatar に反映する', () => {
    const parent = document.createElement('div')
    const view = new ThreadView(parent)
    const row = view.createRow('Alice', new Date().toISOString(), 'hello')

    expect(row.querySelector('.handoff-popover-avatar')?.textContent).toBe('A')
    expect(row.querySelector('strong')?.textContent).toBe('Alice')
  })

  it('返信は時系列(渡した順)で並ぶ', () => {
    const parent = document.createElement('div')
    const view = new ThreadView(parent)
    const threads = document.createElement('div')

    const base = new Date('2026-01-01T00:00:00.000Z').getTime()
    const replies = [
      { author: 'Bob', createdAt: new Date(base + 1000).toISOString(), text: 'first reply' },
      { author: 'Carol', createdAt: new Date(base + 2000).toISOString(), text: 'second reply' },
      { author: 'Dave', createdAt: new Date(base + 3000).toISOString(), text: 'third reply' },
    ]

    for (const reply of replies) {
      threads.appendChild(
        view.createRow(reply.author, reply.createdAt, reply.text, {
          isOwn: false,
          canDelete: true,
          onEdit: vi.fn(),
        }),
      )
    }

    const bodies = Array.from(threads.querySelectorAll('.handoff-popover-body')).map((el) => el.textContent)
    expect(bodies).toEqual(['first reply', 'second reply', 'third reply'])
  })

  it('agent 由来のコメントには Agent バッジが付く', () => {
    const parent = document.createElement('div')
    const view = new ThreadView(parent)
    const row = view.createRow('agent-bot', new Date().toISOString(), 'done', undefined, true)

    expect(row.querySelector('.handoff-agent-badge')).not.toBeNull()
  })

  it('resolved 行には resolvedBy 名が表示される', () => {
    const parent = document.createElement('div')
    const view = new ThreadView(parent)
    const row = view.createResolvedRow('Alice')

    expect(row.textContent).toContain('Alice')
  })

  describe('createReplyArea の送信キー(composer.ts と統一: Cmd/Ctrl+Enter で送信、素の Enter は改行)', () => {
    it('素の Enter では送信されない', () => {
      const parent = document.createElement('div')
      const view = new ThreadView(parent)
      const onReply = vi.fn()
      const area = view.createReplyArea('Alice', onReply)
      const textarea = area.querySelector('textarea') as HTMLTextAreaElement
      textarea.value = 'line one'

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

      expect(onReply).not.toHaveBeenCalled()
    })

    it('Cmd+Enter で送信される', () => {
      const parent = document.createElement('div')
      const view = new ThreadView(parent)
      const onReply = vi.fn()
      const area = view.createReplyArea('Alice', onReply)
      const textarea = area.querySelector('textarea') as HTMLTextAreaElement
      textarea.value = 'reply text'

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))

      expect(onReply).toHaveBeenCalledWith('reply text')
    })

    it('IME 変換中(isComposing)の Cmd+Enter では送信しない', () => {
      const parent = document.createElement('div')
      const view = new ThreadView(parent)
      const onReply = vi.fn()
      const area = view.createReplyArea('Alice', onReply)
      const textarea = area.querySelector('textarea') as HTMLTextAreaElement
      textarea.value = '変換中の文章'

      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, isComposing: true, bubbles: true }),
      )

      expect(onReply).not.toHaveBeenCalled()
    })

    it('Escape で onCancel が呼ばれる(返信欄にフォーカスがあっても閉じられる)', () => {
      const parent = document.createElement('div')
      const view = new ThreadView(parent)
      const onCancel = vi.fn()
      const area = view.createReplyArea('Alice', vi.fn(), undefined, onCancel)
      const textarea = area.querySelector('textarea') as HTMLTextAreaElement

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

      expect(onCancel).toHaveBeenCalled()
    })
  })
})
