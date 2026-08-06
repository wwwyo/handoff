import type { Anchor, Resolution } from '../core/types'
import { isElementVisible } from '../core/visibility'
import { generateSelector } from './selector'
import { createTextQuote, findByTextQuote, verifyTextQuote } from './text-quote'

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
 * selector で複数要素にヒットしたとき、隣接情報の textQuote（exact + tagName のみ）で
 * 絞り込む。prefix/suffix は使わない — 兄弟要素の増減で容易に変わる周辺情報であり、
 * 「どの要素を指すか」の判定に使うと無関係な DOM 変更で正しい要素まで見失う
 * （text-quote.ts の検証/絞り込み分離と同じ理由。バグ3参照）。
 *
 * 絞り込んでも 1 件に決まらなければ selector 経路は失敗として扱い、呼び出し側
 * （locate）で findByTextQuote → viewport のフォールバックに委ねる。同じ構造の別要素を
 * 「ここだ」と自信ありげに誤指定するより、劣化を通知するほうを優先する。
 */
function queryBestElement(anchor: Anchor): LocatedElement | null {
  if (!anchor.selector) return null
  let all: Element[]
  try {
    all = Array.from(document.querySelectorAll(anchor.selector))
  } catch {
    return null
  }
  if (all.length === 0) return null
  // selector だけで一意に決まった場合のみ 'selector' を報告する。
  if (all.length === 1) return { element: all[0] as Element, resolution: 'selector' }

  if (!anchor.textQuote) return null

  const narrowed = all.filter((el) => verifyTextQuote(el, anchor.textQuote as NonNullable<Anchor['textQuote']>))
  if (narrowed.length !== 1) return null

  // textQuote の助けを借りて絞り込んだので、selector 単独の解決ではないことを正直に表す。
  return { element: narrowed[0] as Element, resolution: 'text-quote' }
}

/** selector → textQuote の順にフォールバックし、解決に使った要素と層を返す。 */
function locate(anchor: Anchor): LocatedElement | null {
  const bySelector = queryBestElement(anchor)
  if (bySelector) return bySelector

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
 * 要素を見失ったときの最終手段。
 *
 * scrollX/Y を足しているので、画面上では固定位置に留まりスクロールに追従しない。
 * 要素に紐付いたピンとは挙動が異なるが、行き先の要素が無い以上ドキュメント上の
 * 正しい位置は復元しようがなく、推測した座標に置いて見失わせるより、
 * 常に画面内に留めてユーザーが対処できるようにするほうを選んでいる。
 * この挙動の違いは、ピン側の「見失った」表示と合わせて意味を持つ。
 */
function viewportPosition(anchor: Anchor): ResolvedPosition {
  const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN)
  const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN)
  return {
    x: clamp(window.innerWidth * anchor.viewportX, VIEWPORT_MARGIN, maxX) + window.scrollX,
    y: clamp(window.innerHeight * anchor.viewportY, VIEWPORT_MARGIN, maxY) + window.scrollY,
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
