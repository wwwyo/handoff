import { describe, expect, it } from 'vitest'
import { pinPlaceholderSvgHtml, pinSvgHtml } from '../../src/styles/tokens'

describe('pinSvgHtml', () => {
  it('number をそのままラベルとして描画する', () => {
    const html = pinSvgHtml('#0d99ff', 3)
    expect(html).toContain('>3<')
  })

  it('非数値(NaN/Infinity)は例外を投げる — 型で number に限定した上での二重防御', () => {
    expect(() => pinSvgHtml('#0d99ff', Number.NaN)).toThrow(TypeError)
    expect(() => pinSvgHtml('#0d99ff', Number.POSITIVE_INFINITY)).toThrow(TypeError)
  })

  it('小数は整数に丸められる(表示上ラベルは常に整数連番のため)', () => {
    const html = pinSvgHtml('#0d99ff', 2.9)
    expect(html).toContain('>2<')
  })

  it('label に文字列を渡すコードは型検査で弾かれ、型を迂回されても実行時に例外で止まる', () => {
    expect(() =>
      // @ts-expect-error label は number に限定されているため string は渡せない(型で防いだ上での実行時の保険を確認する)
      pinSvgHtml('#0d99ff', '<img src=x onerror=alert(1)>'),
    ).toThrow(TypeError)
  })
})

describe('pinPlaceholderSvgHtml', () => {
  it('番号を持たない仮ピンの見た目を返す(確定前と確定後を見分けるため)', () => {
    const html = pinPlaceholderSvgHtml('#0d99ff')
    expect(html).toContain('<svg')
    // 通常ピンと違い、テキストラベルの div を持たない。
    expect(html).not.toMatch(/font-weight:600/)
  })
})
