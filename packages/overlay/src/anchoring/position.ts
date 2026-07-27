import type { Anchor, Resolution } from '../core/types'
import { isElementVisible } from '../core/visibility'
import { generateSelector } from './selector'
import { createTextQuote, findByTextQuote } from './text-quote'

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

/**
 * セレクタが複数要素にヒットしたときは、可視な要素を優先する
 * （同一構造が hidden な別タブ/バリアントに重複するケースへの対策）。
 */
function queryBestElement(selector: string): Element | null {
  if (!selector) return null
  try {
    const all = Array.from(document.querySelectorAll(selector))
    if (all.length === 0) return null
    if (all.length === 1) return all[0] ?? null
    return all.find((el) => isElementVisible(el)) ?? all[0] ?? null
  } catch {
    return null
  }
}

/** selector → textQuote の順にフォールバックし、解決に使った要素と層を返す。 */
function locate(anchor: Anchor): LocatedElement | null {
  const bySelector = queryBestElement(anchor.selector)
  if (bySelector) return { element: bySelector, resolution: 'selector' }

  if (anchor.textQuote) {
    const byText = findByTextQuote(anchor.textQuote)
    if (byText) return { element: byText, resolution: 'text-quote' }
  }

  return null
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

function viewportPosition(anchor: Anchor): ResolvedPosition {
  return {
    x: window.innerWidth * anchor.viewportX + window.scrollX,
    y: window.innerHeight * anchor.viewportY + window.scrollY,
    resolution: 'viewport',
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
