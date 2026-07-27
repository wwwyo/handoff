import type { Anchor, Comment, Resolution } from '../core/types'
import type { EventEmitter } from '../core/events'
import { resolveAnchorWithElement, resolveFromElement } from './position'
import { textQuoteMatches } from './text-quote'

export interface TrackedPosition {
  id: string
  x: number
  y: number
  resolution: Resolution
  visible: boolean
}

/** store.getComments() だけに依存させ、core/store への直接依存を避ける。 */
export interface CommentSource {
  getComments(): Comment[]
}

/**
 * scroll / resize のたびに全ピンの位置を追従させる。
 *
 * 参考実装（pindrop.js）は毎フレーム全コメント分の querySelectorAll +
 * getBoundingClientRect を回しており、強制レイアウトの発生源だった。ここでは
 * 1) rAF で 1 フレームに 1 回へ束ね、
 * 2) 解決済み要素を WeakRef でキャッシュして isConnected な限り再クエリせず、
 * 3) 全 rect 読み取りをまとめてから onUpdate（DOM 書き込み側）に渡す
 * ことで read/write を分離し、レイアウトスラッシングを避ける。
 */
export class AnchorTracker {
  private resizeObserver: ResizeObserver | null = null
  private rafId: number | null = null
  private scrollHandler: (() => void) | null = null
  private resizeHandler: (() => void) | null = null
  private resolvedElements = new Map<string, WeakRef<Element>>()
  private lastResolution = new Map<string, Resolution>()

  constructor(
    private source: CommentSource,
    private events: EventEmitter,
    private onUpdate: (positions: TrackedPosition[]) => void,
  ) {}

  start(): void {
    this.resizeObserver = new ResizeObserver(() => this.scheduleUpdate())
    this.resizeObserver.observe(document.body)

    this.scrollHandler = () => this.scheduleUpdate()
    window.addEventListener('scroll', this.scrollHandler, { passive: true, capture: true })

    this.resizeHandler = () => this.scheduleUpdate()
    window.addEventListener('resize', this.resizeHandler, { passive: true })

    this.update()
  }

  stop(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null

    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler, true)
      this.scrollHandler = null
    }
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler)
      this.resizeHandler = null
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  private scheduleUpdate(): void {
    if (this.rafId !== null) return
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      this.update()
    })
  }

  /**
   * テストや呼び出し側から即時再計算したいときのために公開しておく。
   *
   * `revalidate` は scroll/resize の追従（デフォルト false）と、ホストが
   * `refresh()` 経由で「DOM の意味が変わった」と明示的に伝えてきた場合を区別するための引数。
   * false のときはキャッシュ済み要素を isConnected である限りそのまま使い、
   * 毎フレーム querySelectorAll を回すレイアウトスラッシングを避ける。
   * true のときは isConnected に加えてキャッシュ要素が今も selector/textQuote に
   * 合致するかを確かめ、SPA が同じノードを使い回して中身だけ差し替えたケースを検出する。
   */
  update(revalidate = false): void {
    const comments = this.source.getComments()
    // 差分検出のため、解決前のスナップショットを取っておく（resolveOne が
    // this.lastResolution を書き換えるので、後で読むと「更新後」になってしまう）
    const previousResolutions = new Map(this.lastResolution)

    // read: rect 読み取りをここでまとめて行う
    const positions: TrackedPosition[] = comments.map((comment) => this.resolveOne(comment, revalidate))

    // write: DOM 反映は呼び出し側（UI 層）に任せる
    this.onUpdate(positions)

    comments.forEach((comment, i) => {
      const position = positions[i]
      if (!position) return
      this.emitResolutionChange(comment, previousResolutions.get(comment.id), position.resolution)
    })

    this.forgetStaleComments(comments)
  }

  private resolveOne(comment: Comment, revalidate: boolean): TrackedPosition {
    const cached = this.resolvedElements.get(comment.id)?.deref()

    if (cached?.isConnected && (!revalidate || this.stillValid(cached, comment.anchor))) {
      const resolution = this.lastResolution.get(comment.id) ?? 'selector'
      const result = resolveFromElement(cached, comment.anchor, resolution)
      return { id: comment.id, x: result.x, y: result.y, resolution: result.resolution, visible: result.visible }
    }

    const result = resolveAnchorWithElement(comment.anchor)
    if (result.element) {
      this.resolvedElements.set(comment.id, new WeakRef(result.element))
    } else {
      this.resolvedElements.delete(comment.id)
    }
    this.lastResolution.set(comment.id, result.resolution)

    return { id: comment.id, x: result.x, y: result.y, resolution: result.resolution, visible: result.visible }
  }

  /**
   * revalidate 時に、キャッシュ済み要素が今もそのアンカーの指す対象と言えるかを確かめる。
   * isConnected だけでは「ノードは残っているが SPA が中身を差し替えた」ケースを検出できない
   * ため、textQuote があれば textContent まで見る。textQuote が無い（selector のみの）
   * アンカーは selector 一致で代用する。
   */
  private stillValid(cached: Element, anchor: Anchor): boolean {
    if (anchor.textQuote) {
      return textQuoteMatches(cached, anchor.textQuote)
    }
    try {
      return Array.from(document.querySelectorAll(anchor.selector)).includes(cached)
    } catch {
      return false
    }
  }

  /**
   * 解決層が変わったコメントだけ degrade/recover を emit し、UI の余計な再描画を避ける。
   *
   * selector → text-quote も後退として扱う。要素を一意に指せなくなり
   * 「同じ文言の要素」を推測している状態であり、viewport 落ちほどではないにせよ
   * 位置がずれうることを呼び出し側が知る必要があるため。
   */
  private emitResolutionChange(comment: Comment, previous: Resolution | undefined, current: Resolution): void {
    if (previous === undefined || previous === current) return

    const rank: Record<Resolution, number> = { selector: 0, 'text-quote': 1, viewport: 2 }
    if (rank[current] > rank[previous]) {
      this.events.emit('anchor:degraded', { comment, resolution: current })
    } else {
      this.events.emit('anchor:recovered', { comment, resolution: current })
    }
  }

  private forgetStaleComments(comments: Comment[]): void {
    const currentIds = new Set(comments.map((c) => c.id))
    for (const id of this.resolvedElements.keys()) {
      if (!currentIds.has(id)) {
        this.resolvedElements.delete(id)
        this.lastResolution.delete(id)
      }
    }
  }
}
