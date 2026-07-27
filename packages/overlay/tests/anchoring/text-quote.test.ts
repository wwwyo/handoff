import { beforeEach, describe, expect, it } from 'vitest'
import { createTextQuote, findByTextQuote } from '../../src/anchoring/text-quote'

describe('createTextQuote / findByTextQuote', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('テキストが空の要素には undefined を返す', () => {
    document.body.innerHTML = '<div id="empty"></div>'
    const el = document.getElementById('empty')!
    expect(createTextQuote(el)).toBeUndefined()
  })

  it('DOM 構造が変わっても exact 一致で要素を拾える', () => {
    document.body.innerHTML = '<div><p id="target">送信ボタンの色を変えてほしい</p></div>'
    const target = document.getElementById('target')!
    const quote = createTextQuote(target)!

    // 構造を変える: p を section > article でラップし直す（selector は壊れる想定）
    document.body.innerHTML = `<section><article><p id="target-2">送信ボタンの色を変えてほしい</p></article></section>`

    const found = findByTextQuote(quote)
    expect(found?.id).toBe('target-2')
  })

  it('同一 exact が複数あるとき prefix/suffix で絞り込める', () => {
    document.body.innerHTML = `
      <div>
        <span>見出しA</span>
        <p id="first">同じ文言です</p>
        <span>末尾A</span>
      </div>
      <div>
        <span>見出しB</span>
        <p id="second">同じ文言です</p>
        <span>末尾B</span>
      </div>
    `
    const second = document.getElementById('second')!
    const quote = createTextQuote(second)!
    expect(quote.prefix).toContain('見出しB')
    expect(quote.suffix).toContain('末尾B')

    const found = findByTextQuote(quote)
    expect(found?.id).toBe('second')
  })

  it('一致する要素が無ければ null を返す', () => {
    document.body.innerHTML = '<p>何か別のテキスト</p>'
    const found = findByTextQuote({ exact: '存在しない文言のexact一致テキスト' })
    expect(found).toBeNull()
  })
})
