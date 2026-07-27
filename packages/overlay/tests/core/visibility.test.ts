import { beforeEach, describe, expect, it } from 'vitest'
import { getCommentVisibility, isElementVisible } from '../../src/core/visibility'
import type { Comment } from '../../src/core/types'

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    anchor: { selector: '#target', offsetX: 0, offsetY: 0, viewportX: 0, viewportY: 0 },
    author: 'tester',
    text: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    resolved: false,
    unread: false,
    replies: [],
    ...overrides,
  }
}

describe('isElementVisible / getCommentVisibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="target">x</div>'
  })

  it('hidden 属性がある要素は非表示', () => {
    const el = document.getElementById('target')!
    el.hidden = true
    expect(isElementVisible(el)).toBe(false)
  })

  it('display:none の要素は非表示', () => {
    const el = document.getElementById('target')!
    el.style.display = 'none'
    expect(isElementVisible(el)).toBe(false)
  })

  it('isScopeActive が例外を投げても表示側に倒す', () => {
    const comment = makeComment({ scope: { tab: 'x' } })
    const result = getCommentVisibility(comment, {
      isScopeActive: () => {
        throw new Error('boom')
      },
    })
    expect(result.scopeActive).toBe(true)
  })

  it('scope が非アクティブなら visible が false になる', () => {
    const comment = makeComment({ scope: { tab: 'x' } })
    const result = getCommentVisibility(comment, { isScopeActive: () => false })
    expect(result.visible).toBe(false)
  })

  it('selector に一致する要素が DOM から消えていれば anchorVisible は true のまま（viewport フォールバックに委ねる）', () => {
    document.body.innerHTML = ''
    const comment = makeComment()
    const result = getCommentVisibility(comment, {})
    expect(result.anchorVisible).toBe(true)
  })
})
