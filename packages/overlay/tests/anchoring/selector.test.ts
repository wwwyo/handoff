import { beforeEach, describe, expect, it } from 'vitest'
import { generateSelector } from '../../src/anchoring/selector'

describe('generateSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('id が一意なら #id を採用する', () => {
    document.body.innerHTML = '<div id="unique-target">a</div>'
    const el = document.getElementById('unique-target')!
    expect(generateSelector(el)).toBe('#unique-target')
  })

  it('重複した id は信用せず構造パスにフォールバックする', () => {
    document.body.innerHTML = '<div id="dup">a</div><div id="dup">b</div>'
    const [first, second] = document.querySelectorAll('#dup')
    expect(generateSelector(first!)).not.toContain('#dup')
    expect(generateSelector(second!)).not.toContain('#dup')
  })

  it('class 名をセレクタに含めない', () => {
    document.body.innerHTML = '<div class="css-abc123 flex gap-2"><span class="foo">x</span></div>'
    const span = document.querySelector('span')!
    const selector = generateSelector(span)
    expect(selector).not.toContain('.')
    expect(selector).not.toContain('css-abc123')
  })

  it('data-handoff-id > data-testid > data-id の優先順位で一意なら採用する', () => {
    document.body.innerHTML = '<div data-testid="card" data-id="card-2">x</div>'
    const el = document.querySelector('div')!
    expect(generateSelector(el)).toBe('[data-testid="card"]')
  })

  it('同型の兄弟が複数ある場合は nth-of-type を付与する', () => {
    document.body.innerHTML = '<ul><li>a</li><li>b</li><li>c</li></ul>'
    const items = document.querySelectorAll('li')
    const selector = generateSelector(items[1]!)
    expect(selector).toContain('li:nth-of-type(2)')
    expect(document.querySelectorAll(selector).length).toBe(1)
  })

  it('唯一の子要素には nth-of-type を付けない', () => {
    document.body.innerHTML = '<section><article>only</article></section>'
    const el = document.querySelector('article')!
    expect(generateSelector(el)).not.toContain('nth-of-type')
  })
})
