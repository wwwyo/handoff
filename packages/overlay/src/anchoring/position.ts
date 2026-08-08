import type { Anchor, Resolution } from '../core/types'
import { isElementVisible } from '../core/visibility'
import { generateSelector } from './selector'
import { createTextQuote, findByTextQuote, verifyTextQuote } from './text-quote'
import { computeA11y, findByA11y, matchesA11y } from './a11y'

export interface ResolvedPosition {
  x: number
  y: number
  resolution: Resolution
  visible: boolean
}

interface LocatedElement {
  element: Element
  resolution: Resolution
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function matchesSelector(el: Element, selector: string): boolean {
  try {
    return el.matches(selector)
  } catch {
    return false
  }
}

/**
 * selector・a11y・textQuote の3証拠それぞれが「この要素を指している」と言っている
 * 候補を集める。集合を広げる役割（絞り込み込みの検索）はここに閉じ、後段の投票は
 * 「検証」関数（matches/matchesA11y/verifyTextQuote）だけで行う
 * （text-quote.ts の「絞り込みと検証は別の役割」の原則を投票全体にも適用する）。
 */
function collectCandidates(anchor: Anchor): Element[] {
  const candidates = new Set<Element>()

  if (anchor.selector) {
    try {
      for (const el of document.querySelectorAll(anchor.selector)) candidates.add(el)
    } catch {
      // 壊れた selector（構造が大きく変わった等）はこの証拠を諦め、他の証拠に委ねる。
    }
  }

  if (anchor.a11y) {
    for (const el of findByA11y(anchor.a11y)) candidates.add(el)
  }

  if (anchor.textQuote) {
    const byText = findByTextQuote(anchor.textQuote)
    if (byText) candidates.add(byText)
  }

  return Array.from(candidates)
}

/** 候補要素について、anchor の持つ証拠のうち何個が一致するかを数える。 */
function scoreCandidate(el: Element, anchor: Anchor): number {
  let score = 0
  if (anchor.selector && matchesSelector(el, anchor.selector)) score += 1
  if (anchor.a11y && matchesA11y(el, anchor.a11y)) score += 1
  if (anchor.textQuote && verifyTextQuote(el, anchor.textQuote)) score += 1
  return score
}

/**
 * 複数証拠の投票でアンカーを解決する。
 *
 * 直列フォールバック（selector → textQuote → viewport）だと「1個ヒットしたら成功」を
 * 各層が単独で判定するしかなく、それが本当に正しい要素かを問う手段が無かった
 * （複数一致時に最初の可視要素を自信ありげに誤指定したバグの根本原因）。ここでは
 * selector・a11y・textQuote を対等な証拠として集め、同じ要素をいくつの証拠が
 * 指しているかで確信度を決める。最高得点の候補が1つに決まらない（同点で複数、または
 * 候補ゼロ）ときは、誤った要素を選ぶより見失った扱いにするほうを選び null を返す。
 */
function locate(anchor: Anchor): LocatedElement | null {
  const candidates = collectCandidates(anchor)
  if (candidates.length === 0) return null

  let best: Element[] = []
  let bestScore = -1
  for (const el of candidates) {
    const score = scoreCandidate(el, anchor)
    if (score > bestScore) {
      bestScore = score
      best = [el]
    } else if (score === bestScore) {
      best.push(el)
    }
  }

  if (best.length !== 1) return null

  const resolution: Resolution = bestScore >= 2 ? 'confident' : 'uncertain'
  return { element: best[0] as Element, resolution }
}

function positionFromElement(element: Element, anchor: Anchor, resolution: Resolution): ResolvedPosition {
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left + window.scrollX + rect.width * anchor.offsetX,
    y: rect.top + window.scrollY + rect.height * anchor.offsetY,
    resolution,
    visible: isElementVisible(element),
  }
}

/**
 * ピンが画面の縁で切れないための余白。ピン本体と尻尾のオフセットを収める。
 * 端の割合（0 や 1）で保存されたアンカーが viewport に落ちたとき、
 * clamp が無いと画面外に描画されて操作できなくなる。
 */
const VIEWPORT_MARGIN = 40

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * 投票で候補を1つに決められなかったときの最終手段。
 *
 * scrollX/Y を足しているので、画面上では固定位置に留まりスクロールに追従しない。
 * 要素に紐付いたピンとは挙動が異なるが、行き先の要素が無い（または決められない）以上
 * ドキュメント上の正しい位置は復元しようがなく、推測した座標に置いて見失わせるより、
 * 常に画面内に留めてユーザーが対処できるようにするほうを選んでいる。
 * この挙動の違いは、ピン側の「見失った」表示と合わせて意味を持つ。
 */
function viewportPosition(anchor: Anchor): ResolvedPosition {
  const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN)
  const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN)
  return {
    x: clamp(window.innerWidth * anchor.viewportX, VIEWPORT_MARGIN, maxX) + window.scrollX,
    y: clamp(window.innerHeight * anchor.viewportY, VIEWPORT_MARGIN, maxY) + window.scrollY,
    resolution: 'lost',
    visible: true,
  }
}

export function createAnchor(el: Element, pageX: number, pageY: number): Anchor {
  const rect = el.getBoundingClientRect()
  const scrollX = window.scrollX
  const scrollY = window.scrollY

  const offsetX = rect.width > 0 ? (pageX - (rect.left + scrollX)) / rect.width : 0
  const offsetY = rect.height > 0 ? (pageY - (rect.top + scrollY)) / rect.height : 0

  return {
    selector: generateSelector(el),
    offsetX: clamp01(offsetX),
    offsetY: clamp01(offsetY),
    viewportX: clamp01((pageX - scrollX) / window.innerWidth),
    viewportY: clamp01((pageY - scrollY) / window.innerHeight),
    textQuote: createTextQuote(el),
    a11y: computeA11y(el),
  }
}

export function resolveAnchor(anchor: Anchor): ResolvedPosition {
  const found = locate(anchor)
  if (found) return positionFromElement(found.element, anchor, found.resolution)
  return viewportPosition(anchor)
}

/**
 * tracker.ts が解決済み要素を WeakRef キャッシュするための内部 API。
 * 公開契約の `resolveAnchor` はキャッシュ用途に要素を漏らさないよう `x/y/resolution/visible` のみを返す。
 */
export function resolveAnchorWithElement(anchor: Anchor): ResolvedPosition & { element: Element | null } {
  const found = locate(anchor)
  if (found) return { ...positionFromElement(found.element, anchor, found.resolution), element: found.element }
  return { ...viewportPosition(anchor), element: null }
}

/** tracker.ts がキャッシュ済み要素をそのまま使い回すための、DOM 再クエリ無しの位置計算。 */
export function resolveFromElement(element: Element, anchor: Anchor, resolution: Resolution): ResolvedPosition {
  return positionFromElement(element, anchor, resolution)
}
