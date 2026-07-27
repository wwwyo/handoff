import type { TextQuote } from '../core/types'

/**
 * セレクタ（nth-of-type チェーン）は要素の追加・削除で容易にズレる。
 * テキスト内容そのものを同定情報として持たせることで、構造が変わっても
 * 「同じ場所」を復元できるようにするための層。参考実装（pindrop.js）には無い。
 */

const EXACT_LENGTH = 120
const CONTEXT_LENGTH = 30

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function siblingText(el: Element, direction: 'previous' | 'next'): string {
  const sibling = direction === 'previous' ? el.previousElementSibling : el.nextElementSibling
  return normalizeText(sibling?.textContent ?? '')
}

export function createTextQuote(el: Element): TextQuote | undefined {
  const text = normalizeText(el.textContent ?? '')
  if (!text) return undefined

  const exact = text.slice(0, EXACT_LENGTH)
  const prefix = siblingText(el, 'previous').slice(-CONTEXT_LENGTH)
  const suffix = siblingText(el, 'next').slice(0, CONTEXT_LENGTH)

  return {
    exact,
    prefix: prefix || undefined,
    suffix: suffix || undefined,
  }
}

function depthOf(el: Element): number {
  let depth = 0
  let current: Element | null = el.parentElement
  while (current) {
    depth += 1
    current = current.parentElement
  }
  return depth
}

function matchesContext(el: Element, quote: TextQuote): boolean {
  if (quote.prefix && !siblingText(el, 'previous').endsWith(quote.prefix)) {
    return false
  }
  if (quote.suffix && !siblingText(el, 'next').startsWith(quote.suffix)) {
    return false
  }
  return true
}

/**
 * ページ全体を1回だけ走査し、テキスト長で足切りしてから exact 一致を見る。
 * 候補が複数出た場合は prefix/suffix で絞り込み、それでも複数残るなら
 * DOM 上もっとも深い（＝もっとも具体的な）要素を採用する
 * ―― 祖先要素は子孫のテキストを包含するため、浅い要素ほど誤検出しやすい。
 */
export function findByTextQuote(quote: TextQuote): Element | null {
  const all = document.querySelectorAll('*')
  const candidates: Element[] = []

  for (const el of all) {
    const text = normalizeText(el.textContent ?? '')
    if (text.length < quote.exact.length) continue
    if (!text.includes(quote.exact)) continue
    candidates.push(el)
  }

  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0] ?? null

  const refined = quote.prefix || quote.suffix ? candidates.filter((el) => matchesContext(el, quote)) : candidates
  const pool = refined.length > 0 ? refined : candidates

  let deepest = pool[0]
  for (const el of pool) {
    if (!deepest || depthOf(el) > depthOf(deepest)) {
      deepest = el
    }
  }
  return deepest ?? null
}
