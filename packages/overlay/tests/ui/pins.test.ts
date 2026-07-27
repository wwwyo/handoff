import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Comment } from '../../src/core/types'
import { PinRenderer, type PinPosition } from '../../src/ui/pins'

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    anchor: {
      selector: '#target',
      offsetX: 0.5,
      offsetY: 0.5,
      viewportX: 0.5,
      viewportY: 0.5,
    },
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

describe('PinRenderer', () => {
  let container: HTMLDivElement
  let renderer: PinRenderer

  afterEach(() => {
    renderer.destroy()
    container.remove()
  })

  it('渡された位置にピンを描画する(自分では位置解決しない)', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    renderer = new PinRenderer(container, { zIndex: 1000, onPinClick: vi.fn(), onPinMove: vi.fn() })

    const comment = makeComment()
    const positions = new Map<string, PinPosition>([[comment.id, { x: 100, y: 200, resolution: 'selector' }]])
    renderer.renderAll([comment], positions)

    const pin = container.querySelector('div')
    expect(pin?.style.left).toBe('100px')
    expect(pin?.style.top).toBe('200px')
  })

  it('resolution が viewport のとき見た目が変わる(黙って通常表示にしない)', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    renderer = new PinRenderer(container, { zIndex: 1000, onPinClick: vi.fn(), onPinMove: vi.fn() })

    const comment = makeComment()
    const selectorPositions = new Map<string, PinPosition>([[comment.id, { x: 10, y: 10, resolution: 'selector' }]])
    renderer.renderAll([comment], selectorPositions)
    const normalPin = container.querySelector('div') as HTMLDivElement
    expect(normalPin.style.outline).toBe('')

    const viewportPositions = new Map<string, PinPosition>([[comment.id, { x: 10, y: 10, resolution: 'viewport' }]])
    renderer.renderAll([comment], viewportPositions)
    const lostPin = container.querySelector('div') as HTMLDivElement
    expect(lostPin.style.outline).toContain('dashed')
    expect(lostPin.querySelector('[data-handoff-anchor-lost-badge]')).not.toBeNull()
  })

  it('destroy でピンをすべて取り除く', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    renderer = new PinRenderer(container, { zIndex: 1000, onPinClick: vi.fn(), onPinMove: vi.fn() })

    const comment = makeComment()
    renderer.renderAll([comment], new Map([[comment.id, { x: 0, y: 0, resolution: 'selector' as const }]]))
    expect(container.children.length).toBe(1)

    renderer.destroy()
    expect(container.children.length).toBe(0)
  })
})
