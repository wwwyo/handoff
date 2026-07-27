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

  it('親子で textContent が一致していても、元要素と同じ tagName の候補を選ぶ（article に刺したアンカーが p にズレない）', () => {
    document.body.innerHTML = '<article id="target">まったく同じ文言</article>'
    const target = document.getElementById('target')!
    const quote = createTextQuote(target)!
    expect(quote.tagName).toBe('article')

    // p だけを子として持つ article に差し替える。textContent は article/p で完全一致する
    document.body.innerHTML = '<article id="target-2"><p>まったく同じ文言</p></article>'

    const found = findByTextQuote(quote)
    expect(found?.tagName.toLowerCase()).toBe('article')
    expect(found?.id).toBe('target-2')
  })

  it('tagName で絞り込んでも複数残る場合は、誤って選ばず null を返す（viewport フォールバックに委ねる）', () => {
    document.body.innerHTML = `
      <div>
        <p id="p1">曖昧な文言</p>
      </div>
      <div>
        <p id="p2">曖昧な文言</p>
      </div>
    `
    // prefix/suffix も tagName も同一で絞り込みきれないケースを想定する
    const found = findByTextQuote({ exact: '曖昧な文言', tagName: 'p' })
    expect(found).toBeNull()
  })

  it('tagName フィールドを持たない旧フォーマットの TextQuote でも、一意に決まる場合は従来どおり解決できる', () => {
    document.body.innerHTML = '<div><p id="target">送信ボタンの色を変えてほしい</p></div>'
    const target = document.getElementById('target')!
    const text = target.textContent!
    // 旧バージョンが書き出した JSON を模して tagName を持たせない
    const legacyQuote = { exact: text }

    document.body.innerHTML = '<section><article><p id="target-2">送信ボタンの色を変えてほしい</p></article></section>'

    const found = findByTextQuote(legacyQuote)
    expect(found?.id).toBe('target-2')
  })
})
