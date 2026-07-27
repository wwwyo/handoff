import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../../src/ui/sidebar'

describe('Sidebar', () => {
  let parent: HTMLDivElement
  let sidebar: Sidebar | undefined
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
  })

  afterEach(() => {
    sidebar?.destroy()
    sidebar = undefined
    parent.remove()
    window.matchMedia = originalMatchMedia
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
  })

  function mockViewport(width: number, coarsePointer: boolean): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    // jsdom は matchMedia を実装していないため、テスト用にモックを差し込む。
    window.matchMedia = vi.fn().mockReturnValue({ matches: coarsePointer }) as unknown as typeof window.matchMedia
  }

  it('デスクトップ幅では handoff-sidebar-sheet クラスが付かない', () => {
    mockViewport(1280, false)
    sidebar = new Sidebar(parent, { onCommentClick: vi.fn() })
    sidebar.setVisible(true)

    const el = parent.querySelector('.handoff-sidebar')
    expect(el?.classList.contains('handoff-sidebar-sheet')).toBe(false)
  })

  it('モバイル幅(390px 相当)で review モードに入ると handoff-sidebar-sheet クラスが付く', () => {
    mockViewport(390, true)
    sidebar = new Sidebar(parent, { onCommentClick: vi.fn() })
    sidebar.setVisible(true)

    const el = parent.querySelector('.handoff-sidebar')
    expect(el?.classList.contains('handoff-sidebar-sheet')).toBe(true)
    // スワイプで閉じるためのハンドルも実際に生成されていること。
    expect(el?.querySelector('.handoff-sidebar-sheet-handle')).not.toBeNull()
    // scrim も出ていること(タップで閉じられるように)。
    expect(parent.querySelector('.handoff-sheet-scrim')).not.toBeNull()
  })

  it('setVisible(false) で sheet クラスと scrim が片付く', () => {
    mockViewport(390, true)
    sidebar = new Sidebar(parent, { onCommentClick: vi.fn() })
    sidebar.setVisible(true)
    sidebar.setVisible(false)

    const el = parent.querySelector('.handoff-sidebar')
    expect(el?.classList.contains('handoff-sidebar-sheet')).toBe(false)
    expect(parent.querySelector('.handoff-sheet-scrim')).toBeNull()
  })

  it('review 表示中は Tab で外へ抜けない(focus trap がかかっている)', () => {
    mockViewport(1280, false)
    const onCommentClick = vi.fn()
    sidebar = new Sidebar(parent, { onCommentClick })
    sidebar.update([
      {
        id: 'c1',
        anchor: { selector: '#a', offsetX: 0, offsetY: 0, viewportX: 0, viewportY: 0 },
        author: 'Alice',
        text: 'hi',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        resolved: false,
        unread: false,
        replies: [],
      },
    ])
    sidebar.setVisible(true)

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    expect(document.activeElement).toBe(outside)

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    outside.dispatchEvent(event)

    // container 内(closeBtn など)へ引き戻される。
    expect(parent.querySelector('.handoff-sidebar')?.contains(document.activeElement)).toBe(true)
    outside.remove()
  })
})

describe('Sidebar のリサイズ追従', () => {
  const originalMatchMedia = window.matchMedia
  let parent: HTMLDivElement
  let sidebar: Sidebar | undefined

  beforeEach(() => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
  })

  afterEach(() => {
    sidebar?.destroy()
    sidebar = undefined
    parent.remove()
    window.matchMedia = originalMatchMedia
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
  })

  function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
  }

  it('表示中に幅が変わったら右ドックと bottom sheet を切り替える', () => {
    setWidth(1280)
    sidebar = new Sidebar(parent, { onCommentClick: () => {} })
    sidebar.setVisible(true)

    const el = parent.querySelector('.handoff-sidebar')!
    expect(el.classList.contains('handoff-sidebar-sheet')).toBe(false)

    // 端末の回転を模す。開いたまま幅だけが変わる
    setWidth(390)
    window.dispatchEvent(new Event('resize'))
    expect(el.classList.contains('handoff-sidebar-sheet')).toBe(true)

    setWidth(1280)
    window.dispatchEvent(new Event('resize'))
    expect(el.classList.contains('handoff-sidebar-sheet')).toBe(false)
  })
})
