import type { Anchor, Comment, Resolution } from '../core/types'
import type { EventEmitter } from '../core/events'
import { resolveAnchorWithElement, resolveFromElement } from './position'
import { verifyTextQuote } from './text-quote'
import { matchesA11y } from './a11y'

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
      // revalidate=true（ホストが refresh() を呼んだ = 「DOM の意味が変わった」明示的な合図）
      // のときだけラベルを作り直す。selector 属性が剥がれるなど「要素の追跡自体は継続して
      // いるが、もう selector 経由では説明できない」ケースでも前回ラベルの 'confident' を
      // 名乗り続けると、UI の「見失った」表示や anchor:degraded が発火せず劣化がユーザーに
      // 伝わらない。revalidate=false（scroll/resize の追従）では前回ラベルをそのまま使い、
      // 毎フレームの再判定でキャッシュの意味（レイアウトスラッシング回避）を壊さない。
      const resolution = revalidate
        ? this.classifyResolution(cached, comment.anchor)
        : (this.lastResolution.get(comment.id) ?? 'uncertain')
      this.lastResolution.set(comment.id, resolution)
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
   * revalidate 時に、キャッシュ済み要素が今もそのアンカーの証拠のどれかと一致すると
   * 言えるかを確かめる。
   *
   * textQuote / a11y（内容に基づく証拠）が1つでもあれば、それらの一致だけで判定する。
   * selector（id 等）は DOM 構造が保たれているだけの弱い証拠でしかなく、SPA が同じ
   * ノードを使い回して中身だけ差し替えるケース（id は変わらないまま textContent だけ
   * 変わる）を selector 一致だけで「valid」と見なすと検出できなくなる
   * （このケースを検出することが revalidate の存在理由そのもの）。
   * textQuote も a11y も無い（selector しか証拠が無い）アンカーに限り、selector の
   * 一致を最後の手段として使う。
   */
  private stillValid(cached: Element, anchor: Anchor): boolean {
    if (anchor.textQuote || anchor.a11y) {
      if (anchor.textQuote && verifyTextQuote(cached, anchor.textQuote)) return true
      if (anchor.a11y && matchesA11y(cached, anchor.a11y)) return true
      return false
    }
    if (!anchor.selector) return false
    try {
      return cached.matches(anchor.selector)
    } catch {
      return false
    }
  }

  /**
   * revalidate 時に、キャッシュ済み要素が今いくつの証拠と一致するかを数えて
   * confident/uncertain のラベルを付け直す。
   *
   * `Element.matches` / 個別要素への `matchesA11y` / `verifyTextQuote` だけを使い
   * `document.querySelectorAll` は呼ばない — 全文書を再走査せず対象要素1つだけを
   * 見て済ませることで、revalidate のたびにレイアウトスラッシングの原因となる
   * 全文書クエリを発生させない（scroll/resize 追従用のキャッシュ戦略と整合させる）。
   * これは「他に同点の要素がいないか」までは見ないという意味でもあり、その分の精度は、
   * キャッシュ済み要素1つに対する軽量な再判定で済ませられることとのトレードオフとして
   * 許容する。
   */
  private classifyResolution(cached: Element, anchor: Anchor): Resolution {
    let score = 0
    if (anchor.selector) {
      try {
        if (cached.matches(anchor.selector)) score += 1
      } catch {
        // 壊れた selector はこの証拠を諦める
      }
    }
    if (anchor.a11y && matchesA11y(cached, anchor.a11y)) score += 1
    if (anchor.textQuote && verifyTextQuote(cached, anchor.textQuote)) score += 1

    if (score >= 2) return 'confident'
    if (score === 1) return 'uncertain'
    // stillValid が真である前提で呼ばれるため、ここには到達しないはずだが、
    // 型/防御的に uncertain 側へフォールバックしておく。
    return 'uncertain'
  }

  /**
   * 解決層が変わったコメントだけ degrade/recover を emit し、UI の余計な再描画を避ける。
   *
   * confident → uncertain も後退として扱う。要素を複数証拠で一意に指せなくなり
   * 「1つの証拠だけが同意している」状態であり、viewport 落ちほどではないにせよ
   * 位置がずれうることを呼び出し側が知る必要があるため。
   */
  private emitResolutionChange(comment: Comment, previous: Resolution | undefined, current: Resolution): void {
    if (previous === undefined || previous === current) return

    const rank: Record<Resolution, number> = { confident: 0, uncertain: 1, lost: 2 }
    if (rank[current] > rank[previous]) {
      this.events.emit('anchor:degraded', { comment, resolution: current })
    } else {
      this.events.emit('anchor:recovered', { comment, resolution: current })
    }
  }

  private forgetStaleComments(comments: Comment[]): void {
    const currentIds = new Set(comments.map((c) => c.id))
    // resolvedElements と lastResolution は別々に書き込まれる（viewport フォールバック時は
    // resolvedElements からは delete される一方 lastResolution には残る）ため、
    // 両方の key 集合を合わせて走査しないと viewport 落ちしたコメントの lastResolution が
    // 消えたコメント一覧から漏れて残り続ける。
    const staleIds = new Set([...this.resolvedElements.keys(), ...this.lastResolution.keys()])
    for (const id of staleIds) {
      if (!currentIds.has(id)) {
        this.resolvedElements.delete(id)
        this.lastResolution.delete(id)
      }
    }
  }
}
