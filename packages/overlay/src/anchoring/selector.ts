/**
 * DOM 要素から、再訪時に同じ要素を引けるセレクタを生成する。
 *
 * class 名は使わない（Tailwind / CSS Modules のビルド毎ハッシュ化で壊れるため）。
 * 優先順位は `#id` → `[data-handoff-id]` → `[data-testid]` → `[data-id]` →
 * `tag:nth-of-type(n)` で、各候補は採用前に `querySelectorAll` で一意性を検証する。
 * 一意な候補が見つかった祖先でチェーンを打ち切ることで、
 * ページ構造が変わってもセレクタが短く安定するようにする。
 */

/** jsdom など `CSS.escape` を持たない環境向けのフォールバック。 */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/([^\w-])/g, '\\$1')
}

function isUnique(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1
  } catch {
    return false
  }
}

/** id 属性が付与されていても、重複していれば信用せず構造パスへフォールバックする。 */
function idSelector(el: Element): string | undefined {
  if (!el.id) return undefined
  const selector = `#${cssEscape(el.id)}`
  return isUnique(selector) ? selector : undefined
}

function attrSelector(el: Element, attr: string): string | undefined {
  const value = el.getAttribute(attr)
  if (!value) return undefined
  const selector = `[${attr}="${cssEscape(value)}"]`
  return isUnique(selector) ? selector : undefined
}

function nthOfTypePart(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const parent = el.parentElement
  if (!parent) return tag

  const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === el.tagName)
  if (siblings.length <= 1) return tag

  const index = siblings.indexOf(el) + 1
  return `${tag}:nth-of-type(${index})`
}

export function generateSelector(el: Element): string {
  const parts: string[] = []
  let current: Element | null = el

  while (current && current !== document.documentElement) {
    if (current === document.body) {
      parts.unshift('body')
      break
    }

    const unique =
      idSelector(current) ??
      attrSelector(current, 'data-handoff-id') ??
      attrSelector(current, 'data-testid') ??
      attrSelector(current, 'data-id')

    if (unique) {
      parts.unshift(unique)
      break
    }

    parts.unshift(nthOfTypePart(current))
    current = current.parentElement
  }

  return parts.join(' > ')
}
