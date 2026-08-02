import { afterEach, describe, expect, it, vi } from 'vitest'
import { Composer } from '../../src/ui/composer'

describe('Composer', () => {
  let parent: HTMLDivElement
  let composer: Composer

  afterEach(() => {
    composer.destroy()
    parent.remove()
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
  })

  it('空文字では onSubmit が呼ばれない', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    const onSubmit = vi.fn()
    composer = new Composer(parent, { onSubmit, onCancel: vi.fn() })
    composer.show({ x: 100, y: 100 })

    const textarea = parent.querySelector('textarea') as HTMLTextAreaElement
    textarea.value = '   '
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('Cmd+Enter で本文とともに onSubmit が呼ばれる', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    const onSubmit = vi.fn()
    composer = new Composer(parent, { onSubmit, onCancel: vi.fn() })
    composer.show({ x: 100, y: 100 })

    const textarea = parent.querySelector('textarea') as HTMLTextAreaElement
    textarea.value = 'here please'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))

    expect(onSubmit).toHaveBeenCalledWith('here please')
  })

  it('Ctrl+Enter でも送信できる', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    const onSubmit = vi.fn()
    composer = new Composer(parent, { onSubmit, onCancel: vi.fn() })
    composer.show({ x: 100, y: 100 })

    const textarea = parent.querySelector('textarea') as HTMLTextAreaElement
    textarea.value = 'ctrl variant'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))

    expect(onSubmit).toHaveBeenCalledWith('ctrl variant')
  })

  it('素の Enter では送信されない(改行に使うため)', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    const onSubmit = vi.fn()
    composer = new Composer(parent, { onSubmit, onCancel: vi.fn() })
    composer.show({ x: 100, y: 100 })

    const textarea = parent.querySelector('textarea') as HTMLTextAreaElement
    textarea.value = 'line one'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('IME 変換中(isComposing)の Cmd+Enter では送信しない', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    const onSubmit = vi.fn()
    composer = new Composer(parent, { onSubmit, onCancel: vi.fn() })
    composer.show({ x: 100, y: 100 })

    const textarea = parent.querySelector('textarea') as HTMLTextAreaElement
    textarea.value = '変換中'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, isComposing: true, bubbles: true }),
    )

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('Escape で onCancel が呼ばれる', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    const onCancel = vi.fn()
    composer = new Composer(parent, { onSubmit: vi.fn(), onCancel })
    composer.show({ x: 100, y: 100 })

    const textarea = parent.querySelector('textarea') as HTMLTextAreaElement
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(onCancel).toHaveBeenCalled()
  })

  it('本文に HTML を入れても要素として解釈されない(送信後、呼び出し側が再描画してもタグは textContent 扱い)', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    let submitted = ''
    composer = new Composer(parent, {
      onSubmit: (text) => {
        submitted = text
      },
      onCancel: vi.fn(),
    })
    composer.show({ x: 100, y: 100 })

    const payload = '<img src=x onerror=alert(1)>'
    const textarea = parent.querySelector('textarea') as HTMLTextAreaElement
    textarea.value = payload
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))

    expect(submitted).toBe(payload)
    // textarea.value として保持されるだけで、DOM 内に <img> 要素は生成されない。
    expect(parent.querySelector('img')).toBeNull()
  })

  it('モバイル幅では close ボタン付きの bottom sheet になる', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    const originalMatchMedia = window.matchMedia
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia

    composer = new Composer(parent, { onSubmit: vi.fn(), onCancel: vi.fn() })
    composer.show({ x: 100, y: 100 })

    expect(parent.querySelector('.handoff-sheet')).not.toBeNull()
    const closeBtn = parent.querySelector('.handoff-popover-titlebar-btn[aria-label="Cancel new comment"]')
    expect(closeBtn).not.toBeNull()

    window.matchMedia = originalMatchMedia
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
  })

  it('show() は仮ピンと入力欄を出し、hide() で両方消える', () => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
    composer = new Composer(parent, { onSubmit: vi.fn(), onCancel: vi.fn() })
    composer.show({ x: 50, y: 60 })

    expect(composer.isVisible()).toBe(true)
    expect(parent.querySelector('.handoff-new-pin')).not.toBeNull()
    expect(parent.querySelector('.handoff-new-comment-box')).not.toBeNull()

    composer.hide()

    expect(composer.isVisible()).toBe(false)
    expect(parent.querySelector('.handoff-new-pin')).toBeNull()
    expect(parent.querySelector('.handoff-new-comment-box')).toBeNull()
  })
})
