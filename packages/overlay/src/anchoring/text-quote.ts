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
    tagName: el.tagName.toLowerCase(),
  }
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

function depthOf(el: Element): number {
  let depth = 0
  let current: Element | null = el.parentElement
  while (current) {
    depth += 1
    current = current.parentElement
  }
  return depth
}

/**
 * 要素の現在の状態が quote と一致するか（exact / tagName / prefix・suffix 文脈）を判定する。
 * tracker.ts がキャッシュ済み要素の再検証に使う。「同じノードだが中身だけ差し替わった」
 * ケースを検出するには selector 一致だけでは不十分で、textContent まで見る必要がある。
 */
export function textQuoteMatches(el: Element, quote: TextQuote): boolean {
  const text = normalizeText(el.textContent ?? '')
  if (!text.includes(quote.exact)) return false
  if (quote.tagName && el.tagName.toLowerCase() !== quote.tagName) return false
  return matchesContext(el, quote)
}

/**
 * ページ全体を1回だけ走査し、テキスト長で足切りしてから exact 一致を見る。
 * 候補が複数出た場合は prefix/suffix → tagName の順に絞り込む。
 *
 * 以前は最後まで残った複数候補から DOM 上もっとも深い要素を無条件に採用していたが、
 * 祖先と子孫の textContent が一致する構造（例: <article><p>同じ文言</p></article>）では
 * 元要素（article）ではなく常に子孫（p）を誤って選んでしまい、保存済み offsetX/offsetY を
 * 別要素の矩形に適用してピン位置がずれるバグがあった。
 *
 * quote.tagName がある（新形式）場合はそれで絞り込み、それでも絞りきれなければ、
 * 誤った要素を自信ありげに返すより null を返して呼び出し側（position.ts）の viewport
 * フォールバックに委ねる。tagName が無い（旧形式でエクスポートされた JSON）場合はその情報が
 * そもそも存在せず判断しようがないため、後方互換のために従来の「最も深い要素」ヒューリスティック
 * を維持する。
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

  let pool = candidates
  if (quote.prefix || quote.suffix) {
    const refined = pool.filter((el) => matchesContext(el, quote))
    if (refined.length > 0) pool = refined
  }
  if (pool.length === 1) return pool[0] ?? null

  if (quote.tagName) {
    const byTag = pool.filter((el) => el.tagName.toLowerCase() === quote.tagName)
    if (byTag.length === 1) return byTag[0] ?? null
    if (byTag.length > 0) pool = byTag
    if (pool.length === 1) return pool[0] ?? null
    return null
  }

  let deepest = pool[0]
  for (const el of pool) {
    if (!deepest || depthOf(el) > depthOf(deepest)) {
      deepest = el
    }
  }
  return deepest ?? null
}
