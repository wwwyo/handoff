import { beforeEach, describe, expect, it } from 'vitest'
import { computeA11y, findByA11y, matchesA11y } from '../../src/anchoring/a11y'

describe('computeA11y', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('role 属性が明示されていればそれを最優先する', () => {
    document.body.innerHTML = '<div role="button">クリック</div>'
    const el = document.querySelector('div')!
    expect(computeA11y(el)?.role).toBe('button')
  })

  it('role 属性が空白区切りの複数トークンなら最初の既知 role を採る', () => {
    document.body.innerHTML = '<div role="button link">クリック</div>'
    const el = document.querySelector('div')!
    // 属性値をそのまま使うと role 名が "button link" になり NAME_FROM_CONTENT を外れ、
    // name が取れず signature 自体を作れなくなる
    expect(computeA11y(el)).toEqual({ role: 'button', name: 'クリック', nameFrom: 'content' })
  })

  it('role 属性の未知トークンは飛ばし、最初の既知 role を採る', () => {
    document.body.innerHTML = '<div role="future-role button">クリック</div>'
    const el = document.querySelector('div')!
    // ARIA のフォールバックは「先頭トークン」ではなく「最初の認識できる role」。
    // 先頭を無条件に採ると未知 role になり、この要素は a11y 証拠を失う
    expect(computeA11y(el)?.role).toBe('button')
  })

  it('既知の role が1つも無ければ暗黙 role へ落ちる', () => {
    document.body.innerHTML = '<button role="future-role another-unknown">送信</button>'
    const el = document.querySelector('button')!
    expect(computeA11y(el)?.role).toBe('button')
  })

  it('role 属性の大文字小文字を畳んで比較を安定させる', () => {
    document.body.innerHTML = '<div role="BUTTON">クリック</div>'
    const el = document.querySelector('div')!
    expect(computeA11y(el)?.role).toBe('button')
  })

  it('button タグは暗黙 role button を持つ', () => {
    document.body.innerHTML = '<button>送信</button>'
    const el = document.querySelector('button')!
    expect(computeA11y(el)).toEqual({ role: 'button', name: '送信', nameFrom: 'content' })
  })

  it('href を持つ a は role link、持たない a は role が決まらず undefined になる', () => {
    document.body.innerHTML = '<a href="/x">リンク</a><a>アンカー無し</a>'
    const withHref = document.querySelectorAll('a')[0]!
    const withoutHref = document.querySelectorAll('a')[1]!
    expect(computeA11y(withHref)?.role).toBe('link')
    expect(computeA11y(withoutHref)).toBeUndefined()
  })

  it('input の type から role を推定する(text/email→textbox, checkbox, radio)', () => {
    document.body.innerHTML = `
      <input id="t" type="text" aria-label="タイトル" />
      <input id="e" type="email" aria-label="メール" />
      <input id="c" type="checkbox" aria-label="同意する" />
      <input id="r" type="radio" aria-label="選択肢A" />
    `
    expect(computeA11y(document.getElementById('t')!)?.role).toBe('textbox')
    expect(computeA11y(document.getElementById('e')!)?.role).toBe('textbox')
    expect(computeA11y(document.getElementById('c')!)?.role).toBe('checkbox')
    expect(computeA11y(document.getElementById('r')!)?.role).toBe('radio')
  })

  it('見出しタグ h1-h6 は role heading を持つ', () => {
    document.body.innerHTML = '<h2>セクション見出し</h2>'
    const el = document.querySelector('h2')!
    expect(computeA11y(el)?.role).toBe('heading')
  })

  it('role が明示も暗黙も決まらない要素(div/span)は generic ではなく undefined を返す', () => {
    document.body.innerHTML = '<div>ただの div</div>'
    const el = document.querySelector('div')!
    expect(computeA11y(el)).toBeUndefined()
  })

  it('accessible name は aria-labelledby > aria-label > ネイティブ > textContent の優先順で決まる', () => {
    document.body.innerHTML = `
      <span id="ref">参照ラベル</span>
      <button id="a" aria-labelledby="ref" aria-label="無視されるラベル">無視されるテキスト</button>
      <button id="b" aria-label="aria-labelを使う">無視されるテキスト</button>
      <button id="c">textContentを使う</button>
    `
    expect(computeA11y(document.getElementById('a')!)?.name).toBe('参照ラベル')
    expect(computeA11y(document.getElementById('b')!)?.name).toBe('aria-labelを使う')
    expect(computeA11y(document.getElementById('c')!)?.name).toBe('textContentを使う')
  })

  it('label[for] で関連付けられた input はラベルのテキストを name にする', () => {
    document.body.innerHTML = `
      <label for="email">メールアドレス</label>
      <input id="email" type="email" />
    `
    const input = document.getElementById('email')!
    expect(computeA11y(input)).toEqual({ role: 'textbox', name: 'メールアドレス', nameFrom: 'author' })
  })

  it('img は alt を name にする', () => {
    document.body.innerHTML = '<img alt="ロゴ画像" src="x.png" />'
    const el = document.querySelector('img')!
    expect(computeA11y(el)).toEqual({ role: 'img', name: 'ロゴ画像', nameFrom: 'author' })
  })

  it('name の正規化: 空白の連続を1つに畳み前後をtrimする', () => {
    document.body.innerHTML = '<button>  送信   する  </button>'
    const el = document.querySelector('button')!
    expect(computeA11y(el)?.name).toBe('送信 する')
  })

  it('role は決まるが name が空(textContent も属性も無い)場合は signature 自体を作らない', () => {
    document.body.innerHTML = '<button></button>'
    const el = document.querySelector('button')!
    expect(computeA11y(el)).toBeUndefined()
  })

  it('コンテナ系 role(nav/ul/main/form)は textContent を name にせず signature を作らない', () => {
    document.body.innerHTML = `
      <nav>ホーム 会社概要 お問い合わせ</nav>
      <ul><li>項目A</li><li>項目B</li></ul>
      <main>ページ本文がここに入る</main>
      <form>氏名 メール 送信</form>
    `
    expect(computeA11y(document.querySelector('nav')!)).toBeUndefined()
    expect(computeA11y(document.querySelector('ul')!)).toBeUndefined()
    expect(computeA11y(document.querySelector('main')!)).toBeUndefined()
    expect(computeA11y(document.querySelector('form')!)).toBeUndefined()
  })

  it('コンテナ系 role でも aria-label があれば name が決まる', () => {
    document.body.innerHTML = '<nav aria-label="メインナビ">ホーム 会社概要</nav>'
    const el = document.querySelector('nav')!
    expect(computeA11y(el)).toEqual({ role: 'navigation', name: 'メインナビ', nameFrom: 'author' })
  })

  it('listitem は name from content が許されるので textContent を name にする', () => {
    document.body.innerHTML = '<ul><li>項目A</li></ul>'
    const el = document.querySelector('li')!
    expect(computeA11y(el)).toEqual({ role: 'listitem', name: '項目A', nameFrom: 'content' })
  })
})

describe('matchesA11y / findByA11y', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('matchesA11y は role と name が両方一致するときだけ true を返す', () => {
    document.body.innerHTML = '<button>送信</button>'
    const el = document.querySelector('button')!
    expect(matchesA11y(el, { role: 'button', name: '送信', nameFrom: 'content' })).toBe(true)
    expect(matchesA11y(el, { role: 'button', name: '別の名前', nameFrom: 'content' })).toBe(false)
    expect(matchesA11y(el, { role: 'link', name: '送信', nameFrom: 'content' })).toBe(false)
  })

  it('findByA11y はページ全体から role+name が一致する要素をすべて返す', () => {
    document.body.innerHTML = `
      <button>送信</button>
      <button>キャンセル</button>
      <div><button>送信</button></div>
    `
    const found = findByA11y({ role: 'button', name: '送信', nameFrom: 'content' })
    expect(found).toHaveLength(2)
    expect(found.every((el) => el.tagName === 'BUTTON')).toBe(true)
  })

  it('findByA11y は一致が無ければ空配列を返す', () => {
    document.body.innerHTML = '<button>送信</button>'
    expect(findByA11y({ role: 'button', name: '存在しない名前', nameFrom: 'content' })).toEqual([])
  })
})
