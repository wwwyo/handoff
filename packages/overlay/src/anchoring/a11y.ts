import type { A11ySignature } from '../core/types'
import { normalizeText } from './text-quote'

/**
 * DOM から role + accessible name を計算する自前実装。
 *
 * overlay パッケージは runtime 依存ゼロが設計上の制約のため、`dom-accessibility-api` 等の
 * ライブラリは使わない。ARIA の仕様全体を再実装するのではなく、投票の第3証拠として
 * 使うのに十分な主要パターン（明示 role・主要タグの暗黙 role・代表的な name 計算経路）
 * だけをカバーする。
 */

const NAME_MAX_LENGTH = 120

const IMPLICIT_ROLES: Record<string, string> = {
  button: 'button',
  nav: 'navigation',
  main: 'main',
  img: 'img',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  table: 'table',
  form: 'form',
  textarea: 'textbox',
  select: 'combobox',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
}

const INPUT_TEXT_TYPES = new Set(['text', 'email', 'search', 'tel', 'url', 'password'])

/**
 * 自身の textContent を name にしてよい role（ARIA の "name from content" 相当）。
 *
 * Why not 全 role: main / nav / form / list / table のようなコンテナ系まで textContent を
 * name にすると、name が「その領域の中身全部」になる。中身が少しでも変われば一致しなくなり、
 * 誤認はしないものの証拠として脆く、confident から不必要に降格する原因になる。
 */
const NAME_FROM_CONTENT = new Set([
  'button',
  'link',
  'heading',
  'listitem',
  'checkbox',
  'radio',
  'option',
  'tab',
  'menuitem',
])

function inputRole(el: Element): string | undefined {
  const type = (el.getAttribute('type') || 'text').toLowerCase()
  if (type === 'checkbox') return 'checkbox'
  if (type === 'radio') return 'radio'
  if (INPUT_TEXT_TYPES.has(type)) return 'textbox'
  return undefined
}

function implicitRole(el: Element): string | undefined {
  const tag = el.tagName.toLowerCase()
  if (tag === 'a') return el.hasAttribute('href') ? 'link' : undefined
  if (tag === 'input') return inputRole(el)
  return IMPLICIT_ROLES[tag]
}

/**
 * role が明示も暗黙も決まらない要素（div/span など汎用要素）は 'generic' にせず
 * undefined を返す。'generic' を割り当てると、無関係などうしの div 同士が role 一致で
 * 候補に紛れ込み、「誤認より見失いのほうがマシ」という原則に反する曖昧な証拠になる。
 */
function computeRole(el: Element): string | undefined {
  return el.getAttribute('role') || implicitRole(el)
}

function truncate(text: string): string {
  return text.length > NAME_MAX_LENGTH ? text.slice(0, NAME_MAX_LENGTH) : text
}

function normalizedOrUndefined(value: string | null): string | undefined {
  if (!value) return undefined
  const normalized = normalizeText(value)
  return normalized ? truncate(normalized) : undefined
}

function nameFromLabelledBy(el: Element): string | undefined {
  const ids = el.getAttribute('aria-labelledby')
  if (!ids) return undefined
  const text = ids
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
  return normalizedOrUndefined(text)
}

/**
 * `<label for>` は CSS.escape を介した属性セレクタではなく、label を全走査して
 * for 属性を文字列比較する。id に CSS セレクタとして特殊な文字が入っていても
 * エスケープ抜けで壊れないようにするため。
 */
function nameFromLabelFor(el: Element): string | undefined {
  if (!el.id) return undefined
  for (const label of document.querySelectorAll('label')) {
    if (label.getAttribute('for') === el.id) {
      const name = normalizedOrUndefined(label.textContent)
      if (name) return name
    }
  }
  return undefined
}

function nameFromNative(el: Element): string | undefined {
  return (
    nameFromLabelFor(el) ??
    normalizedOrUndefined(el.getAttribute('alt')) ??
    normalizedOrUndefined(el.getAttribute('title'))
  )
}

function computeName(el: Element, role: string): string | undefined {
  return (
    nameFromLabelledBy(el) ??
    normalizedOrUndefined(el.getAttribute('aria-label')) ??
    nameFromNative(el) ??
    (NAME_FROM_CONTENT.has(role) ? normalizedOrUndefined(el.textContent) : undefined)
  )
}

/**
 * role と accessible name の両方が決まる要素だけを証拠にする。片方でも欠けたら
 * undefined を返し、そもそも signature を作らない。中途半端な証拠を投票に混ぜない。
 */
export function computeA11y(el: Element): A11ySignature | undefined {
  const role = computeRole(el)
  if (!role) return undefined
  const name = computeName(el, role)
  if (!name) return undefined
  return { role, name }
}

export function matchesA11y(el: Element, sig: A11ySignature): boolean {
  const current = computeA11y(el)
  return current !== undefined && current.role === sig.role && current.name === sig.name
}

/** ページ全体を1回走査し、role + name が一致する要素をすべて返す。 */
export function findByA11y(sig: A11ySignature): Element[] {
  const matches: Element[] = []
  for (const el of document.querySelectorAll('*')) {
    if (matchesA11y(el, sig)) matches.push(el)
  }
  return matches
}
