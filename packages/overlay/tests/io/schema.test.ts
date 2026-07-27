import { describe, expect, it } from 'vitest'
import { validateHandoffData } from '../../src/io/schema'

function validData() {
  return {
    version: 1,
    url: 'https://example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    comments: [
      {
        id: 'c1',
        anchor: { selector: '#target', offsetX: 0.5, offsetY: 0.5, viewportX: 0.1, viewportY: 0.1 },
        author: 'yuito',
        text: 'hello',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        resolved: false,
        unread: true,
        replies: [],
      },
    ],
  }
}

describe('validateHandoffData', () => {
  it('正常なデータをそのまま受け付ける', () => {
    const result = validateHandoffData(validData())
    expect(result.comments).toHaveLength(1)
    expect(result.comments[0]?.id).toBe('c1')
  })

  it('version 欠落は 1 とみなす', () => {
    const data = validData() as { version?: number }
    delete data.version
    expect(() => validateHandoffData(data)).not.toThrow()
  })

  it('未対応バージョンは拒否する', () => {
    const data = { ...validData(), version: 99 }
    expect(() => validateHandoffData(data)).toThrow(/Unsupported schema version/)
  })

  it('オブジェクトでないデータを拒否する', () => {
    expect(() => validateHandoffData(null)).toThrow()
    expect(() => validateHandoffData('not an object')).toThrow()
  })

  it('comments が配列でなければ拒否する', () => {
    const data = { ...validData(), comments: 'not-an-array' }
    expect(() => validateHandoffData(data)).toThrow(/missing comments array/)
  })

  it('id の無いコメントを拒否する', () => {
    const data = validData()
    // @ts-expect-error 壊れた入力を意図的に作る
    delete data.comments[0].id
    expect(() => validateHandoffData(data)).toThrow(/missing id/)
  })

  it('anchor.selector が無いコメントを拒否する', () => {
    const data = validData()
    // @ts-expect-error 壊れた入力を意図的に作る
    data.comments[0].anchor = { offsetX: 0 }
    expect(() => validateHandoffData(data)).toThrow(/anchor selector/)
  })

  it('text の無いコメントを拒否する', () => {
    const data = validData()
    // @ts-expect-error 壊れた入力を意図的に作る
    delete data.comments[0].text
    expect(() => validateHandoffData(data)).toThrow(/missing text/)
  })

  it('任意フィールド（author, replies, resolved 等）が欠けていれば安全な既定値で埋める', () => {
    const data = {
      version: 1,
      comments: [{ id: 'c2', anchor: { selector: '#x' }, text: 'hi' }],
    }
    const result = validateHandoffData(data)
    const comment = result.comments[0]!
    expect(comment.author).toBe('Unknown')
    expect(comment.replies).toEqual([])
    expect(comment.resolved).toBe(false)
    expect(comment.unread).toBe(false)
    expect(comment.anchor.offsetX).toBe(0)
  })

  it('replies がオブジェクトの配列でなければ拒否する', () => {
    const data = validData()
    // @ts-expect-error 壊れた入力を意図的に作る
    data.comments[0].replies = 'nope'
    expect(() => validateHandoffData(data)).toThrow(/replies must be an array/)
  })

  it('scope が壊れていれば拒否する', () => {
    const data = validData()
    // @ts-expect-error 壊れた入力を意図的に作る
    data.comments[0].scope = 'invalid'
    expect(() => validateHandoffData(data)).toThrow(/invalid scope/)
  })
})
