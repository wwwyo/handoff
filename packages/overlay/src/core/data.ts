/**
 * handoff のデータ契約。ここにあるのはすべてシリアライズ可能な型で、DOM に依存しない。
 * bridge など overlay の外側からも `@wwwyo/handoff/types` として import される。
 */

/** コメントの永続化先。localStorage も HTTP bridge もこの形に畳む。 */
export interface StorageAdapter {
  load(): Promise<Comment[]> | Comment[]
  /**
   * 変更を保存する。`changes` には今回変わった分だけが入る。
   * 全件しか受け付けられない保存先のために `all` も渡す。
   */
  save(changes: StoreChange[], all: Comment[]): Promise<void> | void
}

export type StoreChange =
  | { op: 'upsert'; comment: Comment }
  | { op: 'delete'; id: string }

/** コメントがどの画面状態に属するか。SPA のルートやタブを識別するために使う。 */
export type CommentScope = Record<string, unknown>


/**
 * ページ上の位置を復元するための情報。解決は selector → textQuote → viewport の順に
 * フォールバックし、どの層で解決できたかを `Resolution` として呼び出し側に返す。
 */
export interface Anchor {
  /** 構造パス。class 名は含めない（ビルド毎のハッシュ化で壊れるため）。 */
  selector: string
  /** 対象要素の矩形に対する相対位置 (0-1)。 */
  offsetX: number
  offsetY: number
  /** viewport に対する相対位置 (0-1)。要素が消えたときの最終手段。 */
  viewportX: number
  viewportY: number
  /** 要素のテキストによる同定。DOM 構造が変わっても内容が同じなら復元できる。 */
  textQuote?: TextQuote
}

export interface TextQuote {
  /** 対象要素のテキスト（先頭を切り詰めたもの）。 */
  exact: string
  /** 同じ exact が複数ある場合に絞り込むための、直前・直後の兄弟テキスト。 */
  prefix?: string
  suffix?: string
  /**
   * 対象要素の tag 名（小文字）。祖先・子孫が同じ textContent を持つ場合に
   * 「元要素と同じ素性」の候補へ絞り込むための追加ヒント。旧バージョンが書き出した
   * JSON には存在しないため optional にし、無ければ従来どおりの絞り込みで解決する。
   */
  tagName?: string
}

/** アンカーがどの層で解決されたか。UI とイベントで「見失った」ことを明示するために使う。 */
export type Resolution = 'selector' | 'text-quote' | 'viewport'

export interface Reply {
  id: string
  author: string
  text: string
  createdAt: string
  updatedAt: string
}

export interface CommentableElement {
  selector: string
  label: string
  rect: { x: number; y: number; width: number; height: number }
}

export interface CommentMeta {
  source?: 'agent' | 'human'
  model?: string
  [key: string]: unknown
}

export interface Comment {
  id: string
  anchor: Anchor
  scope?: CommentScope
  author: string
  text: string
  createdAt: string
  updatedAt: string
  resolved: boolean
  resolvedBy?: string
  resolvedAt?: string
  unread: boolean
  replies: Reply[]
  meta?: CommentMeta
}

export interface HandoffData {
  version: 1
  url: string
  createdAt: string
  comments: Comment[]
}

export interface ImportResult {
  added: number
  merged: number
  /** selector でも textQuote でも解決できず viewport 座標に落ちた件数。 */
  unanchored: number
}

export type HandoffMode = 'view' | 'comment' | 'review'

export type HandoffEventMap = {
  'comment:add': Comment
  'comment:delete': Comment
  'comment:resolve': Comment
  'comment:reopen': Comment
  'comment:read': Comment
  'comment:unread': Comment
  'reply:add': { comment: Comment; reply: Reply }
  /** selector で引けなくなった。`resolution` が後退先を示す。 */
  'anchor:degraded': { comment: Comment; resolution: Resolution }
  'anchor:recovered': { comment: Comment; resolution: Resolution }
  'mode:change': { mode: HandoffMode }
  'import:complete': ImportResult
  'export:complete': { commentCount: number }
  /** adapter の load / save が失敗した。UI に出す責務は呼び出し側。 */
  'storage:error': { phase: 'load' | 'save'; error: unknown }
}

export type HandoffEvent = keyof HandoffEventMap
